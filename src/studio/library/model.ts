import type { AggregationOperationV1, PredicateConditionV1 } from '../domain/model'
import type { InferredFieldType } from '../data/types'
import type { StudioVisualType } from '../renderers/catalog'
import type { ReportFilters } from '@/types'

export const LIBRARY_SCHEMA_VERSION = 4 as const

export type LibrarySelection =
  | { kind: 'home'; id: 'home' }
  | { kind: 'folder'; id: string }
  | { kind: 'project'; id: string }
  | { kind: 'dashboard'; id: string }
  | { kind: 'teamLibrary'; id: string }

export interface LibraryFolderRecord {
  id: string
  name: string
  parentId: string | null
  order: number
  createdAt: string
  updatedAt: string
}

export interface ProjectRecord {
  id: string
  name: string
  description: string
  folderId: string | null
  sourceFolder: string | null
  sourceWebUrl?: string | null
  sourceFileCount: number
  sourceDatasetCount: number
  sourceRefreshedAt: string | null
  sourceRepairs?: ProjectSourceRepairs
  reportFilters?: ReportFilters
  createdAt: string
  updatedAt: string
}

export interface SourceFieldRepairRecord {
  id: string
  datasetId: string
  fieldId: string
  workbookFileName?: string
  datasetName?: string
  worksheetName?: string
  fieldKey?: string
  sourceHeader?: string
  sourceColumnIndex?: number
  displayName: string | null
  dataType: InferredFieldType | null
  updatedAt: string
}

export interface ProjectSourceRepairs {
  fieldRepairs: SourceFieldRepairRecord[]
  reviewedDatasetIds: string[]
}

export interface TeamLibraryRecord {
  id: string
  name: string
  folderPath: string
  enabled: boolean
  packageCount: number
  lastScannedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface StudioCondition {
  id: string
  fieldId: string
  operator: PredicateConditionV1['operator']
  value: string
  values?: string[]
}

export interface StudioWidgetQuery {
  datasetId: string | null
  aggregation: AggregationOperationV1
  measureFieldId: string | null
  secondaryAggregation: AggregationOperationV1 | null
  secondaryMeasureFieldId: string | null
  metricCalculation?: 'none' | 'difference' | 'ratioPercent'
  secondaryRuleMode?: 'same' | 'custom'
  secondaryMatch?: 'all' | 'any'
  secondaryConditions?: StudioCondition[]
  groupByFieldId: string | null
  seriesFieldId: string | null
  tableFieldIds: string[]
  resultTransform: 'none' | 'percentOfTotal' | 'runningTotal'
  match: 'all' | 'any'
  conditions: StudioCondition[]
  sort: 'categoryAscending' | 'categoryDescending' | 'valueAscending' | 'valueDescending'
  limit: number
}

export interface StudioWidgetAppearance {
  palette: string[]
  showLegend: boolean
  showDataLabels: boolean
  smooth: boolean
  stacked: boolean
  valueFormat: 'number' | 'percent' | 'currency'
  currencyCode: string
  target: number
  xAxisTitle: string
  yAxisTitle: string
  secondaryYAxisTitle?: string
  axisLabelRotation: 0 | 30 | 45 | 90
  showGrid: boolean
  primaryLabel?: string
  secondaryLabel?: string
  showReferenceLine?: boolean
  referenceLineValue?: number
  referenceLineLabel?: string
  referenceLineColor?: string
}

export interface StudioWidgetLayout {
  x: number
  y: number
  w: number
  h: number
  minW: number
  minH: number
}

export interface StudioWidgetRecord {
  id: string
  title: string
  subtitle: string
  visualType: StudioVisualType
  query: StudioWidgetQuery
  appearance: StudioWidgetAppearance
  layout: StudioWidgetLayout
  locked: boolean
  createdAt: string
  updatedAt: string
}

export interface StudioPageRecord {
  id: string
  name: string
  order: number
  widgets: StudioWidgetRecord[]
  createdAt: string
  updatedAt: string
}

export interface DashboardFilterBindingRecord {
  datasetId: string
  fieldId: string
  fieldKey: string
  fieldName: string
  fieldType: InferredFieldType
}

export interface DashboardFilterRecord {
  id: string
  name: string
  fieldName: string
  fieldType?: InferredFieldType
  bindings?: DashboardFilterBindingRecord[]
  value: string
  values?: string[]
  selectionMode?: 'single' | 'multiple'
  operator?: 'include' | 'exclude'
  scope?: 'dashboard' | 'page'
  pageId?: string | null
  sourceWidgetId?: string | null
  enabled: boolean
}

export interface SavedCalculationRecord {
  id: string
  name: string
  datasetId: string
  aggregation: AggregationOperationV1
  measureFieldId: string | null
  secondaryAggregation: AggregationOperationV1 | null
  secondaryMeasureFieldId: string | null
  metricCalculation: 'none' | 'difference' | 'ratioPercent'
  secondaryRuleMode: 'same' | 'custom'
  secondaryMatch: 'all' | 'any'
  secondaryConditions: StudioCondition[]
  resultTransform: StudioWidgetQuery['resultTransform']
  match: 'all' | 'any'
  conditions: StudioCondition[]
  valueFormat: StudioWidgetAppearance['valueFormat']
  currencyCode: string
  createdAt: string
  updatedAt: string
}

export interface DashboardSourceFieldRequirement {
  sourceFieldId: string
  key: string
  name: string
  inferredType: InferredFieldType
  sourceHeader?: string
  sourceColumnIndex?: number
  repair?: {
    displayName: string | null
    dataType: InferredFieldType | null
  }
}

export interface DashboardSourceDatasetRequirement {
  sourceDatasetId: string
  datasetName: string
  worksheetName: string
  workbookFileName: string
  fields: DashboardSourceFieldRequirement[]
}

export interface DashboardRecord {
  id: string
  projectId: string
  name: string
  description: string
  kind: 'oacWeekly' | 'custom'
  featured: boolean
  favorite: boolean
  pages: StudioPageRecord[]
  filters: DashboardFilterRecord[]
  calculations?: SavedCalculationRecord[]
  template?: {
    id: string
    version: string
    author: string
    source: 'builtIn' | 'package' | 'teamLibrary'
    installedAt: string
    detached: boolean
    sourceRequirements?: DashboardSourceDatasetRequirement[]
  }
  createdAt: string
  updatedAt: string
}

export interface ExportProfileRecord {
  id: string
  projectId: string
  dashboardId: string | null
  name: string
  format: 'pdf' | 'pptx' | 'png'
  pageSize: 'widescreen' | 'standard' | 'letter' | 'a4'
  orientation: 'landscape' | 'portrait'
  margin: number
  includeTitle: boolean
  includeGeneratedAt: boolean
  includePageNumbers: boolean
  tableOverflow: 'paginate' | 'shrink'
  scale: 1 | 2 | 3 | 4
  headerText: string
  footerText: string
  createdAt: string
  updatedAt: string
}

export interface LibraryStore {
  schemaVersion: typeof LIBRARY_SCHEMA_VERSION
  revision: number
  folders: LibraryFolderRecord[]
  projects: ProjectRecord[]
  dashboards: DashboardRecord[]
  teamLibraries: TeamLibraryRecord[]
  exportProfiles: ExportProfileRecord[]
  expandedFolderIds: string[]
  expandedProjectIds: string[]
  recentDashboardIds: string[]
  selection: LibrarySelection
}

export function createId(prefix: string): string {
  const value = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${value}`
}

export function createWidget(
  visualType: StudioVisualType,
  position: Pick<StudioWidgetLayout, 'x' | 'y'> = { x: 0, y: 0 },
): StudioWidgetRecord {
  const now = new Date().toISOString()
  const isKpi = visualType === 'kpi' || visualType === 'splitKpi'
  const isSplitKpi = visualType === 'splitKpi'
  const isTable = visualType === 'table'
  return {
    id: createId('widget'),
    title: isKpi ? 'Key metric' : isTable ? 'Detail table' : 'Untitled visual',
    subtitle: '',
    visualType,
    query: {
      datasetId: null,
      aggregation: 'countRows',
      measureFieldId: null,
      secondaryAggregation: visualType === 'combo' || visualType === 'scatter' || isSplitKpi
        ? 'countRows'
        : null,
      secondaryMeasureFieldId: null,
      metricCalculation: 'none',
      secondaryRuleMode: 'same',
      secondaryMatch: 'all',
      secondaryConditions: [],
      groupByFieldId: null,
      seriesFieldId: null,
      tableFieldIds: [],
      resultTransform: 'none',
      match: 'all',
      conditions: [],
      sort: 'categoryAscending',
      limit: 50,
    },
    appearance: {
      palette: ['#155eef', '#12b76a', '#f79009', '#f04438', '#7a5af8', '#06aed4'],
      showLegend: true,
      showDataLabels: true,
      smooth: true,
      stacked: visualType === 'stackedBar',
      valueFormat: 'number',
      currencyCode: 'USD',
      target: 100,
      xAxisTitle: '',
      yAxisTitle: '',
      secondaryYAxisTitle: '',
      axisLabelRotation: 0,
      showGrid: true,
      primaryLabel: isSplitKpi ? 'Overall' : 'Value',
      secondaryLabel: isSplitKpi ? 'Current period' : 'Secondary',
      showReferenceLine: false,
      referenceLineValue: 0,
      referenceLineLabel: 'Target',
      referenceLineColor: '#d92d20',
    },
    layout: {
      x: position.x,
      y: position.y,
      w: isSplitKpi ? 5 : isKpi ? 3 : isTable ? 12 : 6,
      h: isKpi ? 3 : isTable ? 8 : 7,
      minW: isSplitKpi ? 4 : isKpi ? 2 : 4,
      minH: isKpi ? 2 : 4,
    },
    locked: false,
    createdAt: now,
    updatedAt: now,
  }
}
