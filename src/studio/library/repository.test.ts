import { describe, expect, it } from 'vitest'
import type { PlatformBridge } from '@/platform/types'
import {
  createEmptyLibrary,
  LibraryCompatibilityError,
  loadLibrary,
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

  it('leaves a newer schema untouched instead of replacing it', async () => {
    const future = { schemaVersion: 99, projects: ['important'] }
    const memory = memoryPlatform({ 'studio-library': future })

    await expect(loadLibrary(memory.platform)).rejects.toBeInstanceOf(LibraryCompatibilityError)
    expect(memory.values.get('studio-library')).toBe(future)
    expect(memory.saves).toEqual([])
  })

  it('leaves malformed current data untouched', async () => {
    const malformed = { schemaVersion: 1, dashboards: 'not-an-array' }
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
})
