import type {
  DashboardSourceDatasetRequirement,
  DashboardSourceFieldRequirement,
  DashboardRecord,
  ExportProfileRecord,
} from '../library/model'

export const DASHBOARD_PACKAGE_SCHEMA_VERSION = 1 as const
export const DASHBOARD_PACKAGE_KIND = 'kpintelligence.dashboard' as const
export const DASHBOARD_PACKAGE_EXTENSION = 'kpidashboard' as const

export type DashboardPackageFieldRequirementV1 = DashboardSourceFieldRequirement

export type DashboardPackageDatasetRequirementV1 = DashboardSourceDatasetRequirement

export interface DashboardPackageManifestV1 {
  schemaVersion: typeof DASHBOARD_PACKAGE_SCHEMA_VERSION
  kind: typeof DASHBOARD_PACKAGE_KIND
  templateId: string
  templateVersion: string
  name: string
  description: string
  author: string
  category: string
  createdAt: string
  minAppVersion: string
  dashboardKind: DashboardRecord['kind']
  sourceRequirements: DashboardPackageDatasetRequirementV1[]
  capabilities: string[]
  privacy: {
    includesSpreadsheetRows: false
    includesCredentials: false
    includesAbsolutePaths: false
    configuredLiteralCount: number
  }
  contentSha256: string
}

export interface DashboardPackageContentV1 {
  dashboard: DashboardRecord
  exportProfile: ExportProfileRecord | null
}

export interface DashboardPackageDocument {
  manifest: DashboardPackageManifestV1
  content: DashboardPackageContentV1
  authenticity: {
    status: 'unsigned'
  } | {
    status: 'verified'
    publisherKeyId: string
  }
}

export interface DashboardPackageFile {
  path: string
  name: string
  size: number
  modifiedAt: number
  document: DashboardPackageDocument
}

export interface InstalledDashboardPackage {
  dashboard: DashboardRecord
  exportProfile: ExportProfileRecord | null
  unresolvedVisualCount: number
  unresolvedCalculationCount: number
  unresolvedSlicerCount: number
}
