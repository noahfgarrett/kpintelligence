import type { LucideIcon } from 'lucide-react'

export type SheetRole = 'bimIssues' | 'mechanical' | 'electrical' | 'welding'

export interface SheetRecord {
  id: number | string
  name: string
  rows: Record<string, unknown>[]
}

export interface SheetBundle {
  source: 'empty' | 'demo' | 'files'
  sheets: Record<SheetRole, SheetRecord>
}

export interface ImportedSheetFile {
  role: SheetRole
  fileName: string
  worksheetName: string
  rowCount: number
  sheet: SheetRecord
}

export interface RoleConfig {
  role: SheetRole
  label: string
  expectedName: string
  icon: LucideIcon
}

export interface WorkWeek {
  week: number
  year: number
  label: string
  key: number
}

export interface ReportFilters {
  oac: boolean
  workWeeks: string[]
  disciplines: string[]
  contractors: string[]
  subtypes: string[]
  statuses: string[]
}

export interface FilterOptions {
  workWeeks: string[]
  disciplines: string[]
  contractors: string[]
  subtypes: string[]
  statuses: string[]
}

export interface KpiMetric {
  id: string
  label: string
  value: string
  rawValue: number
  delta: number
  deltaLabel: string
  tone: 'neutral' | 'good' | 'warn' | 'bad'
  icon: LucideIcon
  spark?: number[]
}

export interface WeeklyIssuePoint {
  workWeek: string
  opened: number
  closed: number
  remainingOpen: number
}

export interface MonthlyIssuePoint {
  month: string
  opened: number
  closed: number
  gap: number
}

export interface AgingBucket {
  label: string
  count: number
  color: string
}

export interface IssueDetailRow {
  id: string
  subtype: string
  status: string
  title: string
  contractor: string
  workWeek: string
  createdOn: string
  workWeekClosed: string
  dueDate: string
  group: 'Open Carryover' | 'Opened in Report Week' | 'Closed in Report Week' | 'Opened + Closed in Report Week' | 'Closed This Week'
}

export interface ElectricalPoint {
  workWeek: string
  finals: number
  issuesFound: number
}

export interface WeldingPoint {
  workWeek: string
  signed: number
  total: number
  signoffRate: number
  issuesCreated: number
}

export interface ReportModel {
  generatedAt: Date
  currentWeek: WorkWeek
  reportWeek: WorkWeek
  previousReportWeek: WorkWeek
  cutoffDate: Date
  source: 'empty' | 'demo' | 'files'
  sheetHealth: Record<SheetRole, boolean>
  filterOptions: FilterOptions
  activeFilters: ReportFilters
  kpis: KpiMetric[]
  issueTrend: WeeklyIssuePoint[]
  monthlyTrend: MonthlyIssuePoint[]
  aging: AgingBucket[]
  issueTable: IssueDetailRow[]
  electrical: ElectricalPoint[]
  welding: WeldingPoint[]
  summary: {
    electricalFinals: number
    electricalIssuesFound: number
    weldsChecked: number
    weldsSigned: number
    overallSignoffRate: number
    reportWeekSignoffRate: number
    deltas: Record<string, number>
  }
}

export interface UpdateInfo {
  version: string
  releaseNotes: string
  releaseDate?: string
}
