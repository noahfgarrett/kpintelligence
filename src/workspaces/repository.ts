import { mergeFilters } from '@/calculations/report'
import type { PlatformBridge } from '@/platform'
import {
  WEEKLY_QAQC_TEMPLATE_ID,
  WORKSPACE_SCHEMA_VERSION,
  type WorkspaceRecord,
  type WorkspaceStoreData,
} from './types'

const STORE_KEY = 'workspaces'

export function emptyWorkspaceStore(): WorkspaceStoreData {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    activeWorkspaceId: null,
    workspaces: [],
  }
}

export function createWorkspace(name: string): WorkspaceRecord {
  const now = new Date().toISOString()
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    name: name.trim() || 'Untitled Project',
    templateId: WEEKLY_QAQC_TEMPLATE_ID,
    templateVersion: 1,
    sourceFolder: null,
    filters: mergeFilters({}),
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  }
}

function isWorkspace(value: unknown): value is WorkspaceRecord {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WorkspaceRecord>
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && candidate.templateId === WEEKLY_QAQC_TEMPLATE_ID
}

export function migrateWorkspaceStore(value: unknown): WorkspaceStoreData {
  if (!value || typeof value !== 'object') return emptyWorkspaceStore()
  const candidate = value as Partial<WorkspaceStoreData>
  const workspaces = Array.isArray(candidate.workspaces)
    ? candidate.workspaces.filter(isWorkspace).map((workspace): WorkspaceRecord => ({
      ...workspace,
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      templateVersion: Number.isFinite(workspace.templateVersion) ? workspace.templateVersion : 1,
      sourceFolder: typeof workspace.sourceFolder === 'string' ? workspace.sourceFolder : null,
      filters: mergeFilters(workspace.filters ?? {}),
    }))
    : []
  const activeWorkspaceId = workspaces.some((workspace) => workspace.id === candidate.activeWorkspaceId)
    ? candidate.activeWorkspaceId ?? null
    : workspaces[0]?.id ?? null
  return { schemaVersion: WORKSPACE_SCHEMA_VERSION, activeWorkspaceId, workspaces }
}

export async function loadWorkspaceStore(platform: PlatformBridge): Promise<WorkspaceStoreData> {
  return migrateWorkspaceStore(await platform.loadState<WorkspaceStoreData>(STORE_KEY))
}

export async function saveWorkspaceStore(platform: PlatformBridge, value: WorkspaceStoreData): Promise<void> {
  await platform.saveState(STORE_KEY, value)
}
