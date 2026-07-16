import type { ReportFilters } from '@/types'

export const WORKSPACE_SCHEMA_VERSION = 1
export const WEEKLY_QAQC_TEMPLATE_ID = 'weekly-qaqc'

export interface WorkspaceRecord {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION
  id: string
  name: string
  templateId: typeof WEEKLY_QAQC_TEMPLATE_ID
  templateVersion: number
  sourceFolder: string | null
  filters: ReportFilters
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
}

export interface WorkspaceStoreData {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION
  activeWorkspaceId: string | null
  workspaces: WorkspaceRecord[]
}

export type SourceStatus = 'idle' | 'scanning' | 'ready' | 'watching' | 'warning' | 'error'

export interface WorkspaceSourceSnapshot {
  files: File[]
  fingerprint: string
  displayNames: string[]
  loadedAt: string
}
