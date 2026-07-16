import { describe, expect, it } from 'vitest'
import { emptyWorkspaceStore, migrateWorkspaceStore } from './repository'

describe('workspace repository', () => {
  it('returns an empty current store for invalid data', () => {
    expect(migrateWorkspaceStore(null)).toEqual(emptyWorkspaceStore())
  })

  it('repairs saved filters and selects the first valid workspace', () => {
    const migrated = migrateWorkspaceStore({
      schemaVersion: 0,
      activeWorkspaceId: 'missing',
      workspaces: [{
        id: 'project-1',
        name: 'North Plant',
        templateId: 'weekly-qaqc',
        templateVersion: 1,
        sourceFolder: '/reports',
        filters: { oac: false, contractors: ['Bechtel'] },
        createdAt: '2026-07-16T00:00:00.000Z',
        updatedAt: '2026-07-16T00:00:00.000Z',
        lastOpenedAt: '2026-07-16T00:00:00.000Z',
      }],
    })

    expect(migrated.activeWorkspaceId).toBe('project-1')
    expect(migrated.workspaces[0].filters).toEqual({
      oac: false,
      workWeeks: [],
      disciplines: [],
      contractors: ['Bechtel'],
      subtypes: [],
      statuses: [],
    })
  })
})
