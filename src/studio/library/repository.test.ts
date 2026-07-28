import { describe, expect, it } from 'vitest'
import type { PlatformBridge } from '@/platform/types'
import {
  createEmptyLibrary,
  LibraryCompatibilityError,
  loadLibrary,
  loadLibraryBackup,
  restoreLibraryBackup,
  saveLibrary,
} from './repository'

function memoryPlatform(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial))
  const saves: Array<{ key: string; value: unknown }> = []
  const platform: PlatformBridge = {
    kind: 'browser',
    supportsPersistentFolders: false,
    async chooseDirectory() { return null },
    async listFiles() { return [] },
    async readFile() { return new Uint8Array() },
    async watchDirectory() { return () => undefined },
    async loadState<T>(key: string) { return (values.get(key) as T | undefined) ?? null },
    async saveState<T>(key: string, value: T) {
      values.set(key, value)
      saves.push({ key, value })
    },
    async saveFile() { return null },
    async checkForUpdate() { return null },
    async installUpdate() { return undefined },
  }
  return { platform, values, saves }
}

describe('library persistence', () => {
  it('opens a complete current library document', async () => {
    const current = createEmptyLibrary()
    const memory = memoryPlatform({ 'studio-library': current })

    await expect(loadLibrary(memory.platform)).resolves.toBe(current)
    expect(memory.saves).toEqual([])
  })

  it('normalizes partial legacy filters while migrating QCx workspaces', async () => {
    const memory = memoryPlatform({
      workspaces: {
        schemaVersion: 1,
        activeWorkspaceId: 'legacy-project',
        workspaces: [{
          id: 'legacy-project',
          name: 'Legacy Project',
          templateId: 'weekly-qaqc',
          templateVersion: 1,
          sourceFolder: '/reports',
          filters: { oac: false, contractors: ['Bechtel'] },
          createdAt: '2026-07-16T00:00:00.000Z',
          updatedAt: '2026-07-16T00:00:00.000Z',
          lastOpenedAt: '2026-07-16T00:00:00.000Z',
        }],
      },
    })

    const migrated = await loadLibrary(memory.platform)

    expect(migrated.projects[0].reportFilters).toEqual({
      oac: false,
      workWeeks: [],
      disciplines: [],
      contractors: ['Bechtel'],
      subtypes: [],
      statuses: [],
    })
    expect(memory.saves.map((save) => save.key)).toEqual(['studio-library'])
  })

  it('migrates the released schema v1 library to the current schema', async () => {
    const current = createEmptyLibrary()
    const legacy = structuredClone(current) as unknown as {
      schemaVersion: number
      teamLibraries?: unknown
    }
    legacy.schemaVersion = 1
    delete legacy.teamLibraries
    const memory = memoryPlatform({ 'studio-library': legacy })

    const migrated = await loadLibrary(memory.platform)

    expect(migrated.schemaVersion).toBe(4)
    expect(migrated.teamLibraries).toEqual([])
    expect(migrated.dashboards).toHaveLength(current.dashboards.length)
    expect(memory.saves.map((save) => save.key)).toEqual([
      'studio-library-backup',
      'studio-library',
    ])
    expect(memory.values.get('studio-library-backup')).toBe(legacy)
  })

  it('migrates schema v2 without dropping Team Libraries or dashboards', async () => {
    const current = createEmptyLibrary()
    const legacy = structuredClone(current) as unknown as {
      schemaVersion: number
      dashboards: Array<{ calculations?: unknown }>
    }
    legacy.schemaVersion = 2
    legacy.dashboards.forEach((dashboard) => delete dashboard.calculations)
    const memory = memoryPlatform({ 'studio-library': legacy })

    const migrated = await loadLibrary(memory.platform)

    expect(migrated.schemaVersion).toBe(4)
    expect(migrated.teamLibraries).toEqual(current.teamLibraries)
    expect(migrated.dashboards).toHaveLength(current.dashboards.length)
    expect(memory.values.get('studio-library-backup')).toBe(legacy)
  })

  it('migrates schema v3 calculation recipes with a stable result transform', async () => {
    const current = createEmptyLibrary()
    const timestamp = new Date().toISOString()
    const legacy = structuredClone(current) as unknown as {
      schemaVersion: number
      dashboards: Array<{ calculations: Array<Record<string, unknown>> }>
    }
    legacy.schemaVersion = 3
    legacy.dashboards[0].calculations = [{
      id: 'calculation-v3',
      name: 'Legacy calculation',
      datasetId: 'dataset',
      aggregation: 'countRows',
      measureFieldId: null,
      secondaryAggregation: null,
      secondaryMeasureFieldId: null,
      metricCalculation: 'none',
      secondaryRuleMode: 'same',
      secondaryMatch: 'all',
      secondaryConditions: [],
      match: 'all',
      conditions: [],
      valueFormat: 'number',
      currencyCode: 'USD',
      createdAt: timestamp,
      updatedAt: timestamp,
    }]
    const memory = memoryPlatform({ 'studio-library': legacy })

    const migrated = await loadLibrary(memory.platform)

    expect(migrated.schemaVersion).toBe(4)
    expect(migrated.dashboards[0].calculations?.[0].resultTransform).toBe('none')
    expect(memory.values.get('studio-library-backup')).toBe(legacy)
  })

  it('leaves a newer schema untouched instead of replacing it', async () => {
    const future = { schemaVersion: 99, projects: ['important'] }
    const memory = memoryPlatform({ 'studio-library': future })

    await expect(loadLibrary(memory.platform)).rejects.toBeInstanceOf(LibraryCompatibilityError)
    expect(memory.values.get('studio-library')).toBe(future)
    expect(memory.saves).toEqual([])
  })

  it('leaves malformed current data untouched', async () => {
    const malformed = { schemaVersion: 2, dashboards: 'not-an-array' }
    const memory = memoryPlatform({ 'studio-library': malformed })

    await expect(loadLibrary(memory.platform)).rejects.toThrow(/left untouched/i)
    expect(memory.values.get('studio-library')).toBe(malformed)
    expect(memory.saves).toEqual([])
  })

  it('rejects broken entity references instead of opening a partially corrupt library', async () => {
    const malformed = createEmptyLibrary()
    malformed.dashboards[0].projectId = 'missing-project'
    const memory = memoryPlatform({ 'studio-library': malformed })

    await expect(loadLibrary(memory.platform)).rejects.toThrow(/left untouched/i)
    expect(memory.values.get('studio-library')).toBe(malformed)
    expect(memory.saves).toEqual([])
  })

  it('rejects page slicers that point to a missing dashboard page', async () => {
    const malformed = createEmptyLibrary()
    malformed.dashboards[0].filters = [{
      id: 'page-filter',
      name: 'Status',
      fieldName: 'Status',
      value: 'Open',
      values: ['Open'],
      scope: 'page',
      pageId: 'missing-page',
      enabled: true,
    }]
    const memory = memoryPlatform({ 'studio-library': malformed })

    await expect(loadLibrary(memory.platform)).rejects.toThrow(/left untouched/i)
    expect(memory.saves).toEqual([])
  })

  it('rejects recursive folder relationships', async () => {
    const malformed = createEmptyLibrary()
    const timestamp = new Date().toISOString()
    malformed.folders = [
      {
        id: 'folder-a',
        name: 'Folder A',
        parentId: 'folder-b',
        order: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 'folder-b',
        name: 'Folder B',
        parentId: 'folder-a',
        order: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]
    const memory = memoryPlatform({ 'studio-library': malformed })

    await expect(loadLibrary(memory.platform)).rejects.toThrow(/left untouched/i)
    expect(memory.saves).toEqual([])
  })

  it('writes the prior valid revision to a rollback key before saving', async () => {
    const previous = createEmptyLibrary()
    const next = { ...previous, revision: previous.revision + 1 }
    const memory = memoryPlatform({ 'studio-library': previous })

    await saveLibrary(memory.platform, next)

    expect(memory.saves.map((save) => save.key)).toEqual([
      'studio-library-backup',
      'studio-library',
    ])
    expect(memory.values.get('studio-library-backup')).toBe(previous)
    expect(memory.values.get('studio-library')).toBe(next)
  })

  it('refuses to overwrite a valid library with malformed references', async () => {
    const previous = createEmptyLibrary()
    const invalid = structuredClone(previous)
    invalid.revision += 1
    invalid.dashboards[0].filters = [{
      id: 'invalid-page-filter',
      name: 'Status',
      fieldName: 'Status',
      value: 'Open',
      scope: 'page',
      pageId: 'missing-page',
      enabled: true,
    }]
    const memory = memoryPlatform({ 'studio-library': previous })

    await expect(saveLibrary(memory.platform, invalid)).rejects.toThrow(/refused to save/i)
    expect(memory.values.get('studio-library')).toBe(previous)
    expect(memory.saves).toEqual([])
  })

  it('restores a valid backup without discarding the damaged primary document', async () => {
    const damaged = { schemaVersion: 2, dashboards: 'broken' }
    const backup = createEmptyLibrary()
    const memory = memoryPlatform({
      'studio-library': damaged,
      'studio-library-backup': backup,
    })

    await expect(loadLibraryBackup(memory.platform)).resolves.toBe(backup)
    await expect(restoreLibraryBackup(memory.platform)).resolves.toBe(backup)

    expect(memory.values.get('studio-library')).toBe(backup)
    expect(memory.values.get('studio-library-recovery')).toBe(damaged)
  })
})
