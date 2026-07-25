export const STUDIO_SCHEMA_VERSION = 1 as const
export type StudioSchemaVersion = typeof STUDIO_SCHEMA_VERSION

export type EntityId = string
export type IsoTimestamp = string
export type QueryScalar = string | number | boolean

export type FieldDataTypeV1 =
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'workWeek'

export interface EntityV1 {
  schemaVersion: StudioSchemaVersion
  id: EntityId
  name: string
  description?: string
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

export interface LibraryFolderV1 extends EntityV1 {
  kind: 'libraryFolder'
  parentFolderId: EntityId | null
  childFolderIds: EntityId[]
  projectIds: EntityId[]
  order: number
}

export interface ProjectV1 extends EntityV1 {
  kind: 'project'
  folderId: EntityId | null
  dashboardIds: EntityId[]
  sourceIds: EntityId[]
  datasetIds: EntityId[]
  filterIds: EntityId[]
  themeIds: EntityId[]
  exportProfileIds: EntityId[]
  defaultThemeId: EntityId | null
}

export interface DashboardV1 extends EntityV1 {
  kind: 'dashboard'
  projectId: EntityId
  pageIds: EntityId[]
  filterIds: EntityId[]
  themeId: EntityId | null
  defaultExportProfileId: EntityId | null
  featured: boolean
  template?: {
    id: string
    version: string
    detached: boolean
  }
}

export interface DashboardPageV1 extends EntityV1 {
  kind: 'dashboardPage'
  dashboardId: EntityId
  order: number
  widgetIds: EntityId[]
  filterIds: EntityId[]
  layoutIds: EntityId[]
  presentationTitle?: string
}

export type BuiltInChartTypeV1 =
  | 'bar'
  | 'stackedBar'
  | 'line'
  | 'area'
  | 'combo'
  | 'donut'
  | 'pie'
  | 'scatter'
  | 'histogram'
  | 'heatmap'
  | 'waterfall'
  | 'funnel'
  | 'gauge'
  | 'progress'

export type WidgetVisualV1 =
  | {
      kind: 'kpi'
      valueAggregationId: EntityId
      comparisonAggregationId?: EntityId
      sparklineAggregationId?: EntityId
      tone: 'neutral' | 'positive' | 'warning' | 'negative'
    }
  | {
      kind: 'table'
      fieldIds: EntityId[]
      showRowNumbers: boolean
      pageSize: number
    }
  | {
      kind: 'chart'
      chartType: BuiltInChartTypeV1
      categoryFieldIds: EntityId[]
      seriesAggregationIds: EntityId[]
      secondaryAxisAggregationIds: EntityId[]
      stacked: boolean
      showLegend: boolean
      showDataLabels: boolean
    }
  | {
      kind: 'text'
      markdown: string
    }
  | {
      kind: 'image'
      assetId: EntityId
      fit: 'contain' | 'cover'
      altText: string
    }
  | {
      kind: 'filterControl'
      filterId: EntityId
    }

export interface DashboardWidgetV1 extends EntityV1 {
  kind: 'dashboardWidget'
  pageId: EntityId
  rendererSpecVersion: 1
  query: QuerySpecV1 | null
  visual: WidgetVisualV1
  title: string
  subtitle?: string
  showTitle: boolean
  showSourceFreshness: boolean
}

export type LayoutProfileV1 =
  | 'desktop'
  | 'tablet'
  | 'mobile'
  | 'presentation'
  | 'export'

export interface LayoutItemV1 {
  widgetId: EntityId
  x: number
  y: number
  width: number
  height: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  locked?: boolean
  hidden?: boolean
}

export interface DashboardLayoutV1 extends EntityV1 {
  kind: 'dashboardLayout'
  pageId: EntityId
  profile: LayoutProfileV1
  columns: number
  rowHeight: number
  gap: number
  items: LayoutItemV1[]
}

export interface ExportProfileV1 extends EntityV1 {
  kind: 'exportProfile'
  projectId: EntityId
  format: 'pdf' | 'pptx' | 'png'
  pageSize: {
    widthInches: number
    heightInches: number
    orientation: 'portrait' | 'landscape'
  }
  margins: {
    top: number
    right: number
    bottom: number
    left: number
  }
  layoutProfile: Extract<LayoutProfileV1, 'presentation' | 'export'>
  pageIds: EntityId[]
  includePageTitles: boolean
  includeGeneratedAt: boolean
  chartOutput: 'vectorPreferred' | 'highResolutionRaster'
  tableOverflow: 'paginate' | 'shrink'
  header?: {
    enabled: boolean
    text: string
    heightInches: number
  }
  footer?: {
    enabled: boolean
    text: string
    heightInches: number
  }
}

export interface SpreadsheetSourceV1 extends EntityV1 {
  kind: 'spreadsheetSource'
  projectId: EntityId
  bindingKey: string
  fileSelector: {
    fileNamePattern: string
    archiveMemberPattern?: string
    worksheet: 'auto' | string | number
  }
  refresh: {
    mode: 'manual' | 'watch'
    settleMilliseconds: number
    consistencyGroup?: string
  }
}

export type SourceV1 = SpreadsheetSourceV1

export interface DatasetV1 extends EntityV1 {
  kind: 'dataset'
  projectId: EntityId
  sourceId: EntityId
  headerRow: 'auto' | number
  dataStartRow?: number
  fieldIds: EntityId[]
  rowIdentityFieldIds: EntityId[]
  includeRowNumbers: boolean
}

export interface FieldV1 extends EntityV1 {
  kind: 'field'
  datasetId: EntityId
  sourceColumn: string
  aliases: string[]
  dataType: FieldDataTypeV1
  nullable: boolean
  coercion: {
    trimText: boolean
    emptyTextIsBlank: boolean
  }
  format?: {
    numberStyle?: 'decimal' | 'integer' | 'percent' | 'currency'
    decimalPlaces?: number
    currencyCode?: string
    dateStyle?: 'short' | 'medium' | 'long'
  }
}

export type FilterControlV1 =
  | 'singleSelect'
  | 'multiSelect'
  | 'numberRange'
  | 'dateRange'
  | 'relativeDate'
  | 'toggle'
  | 'search'

export interface DashboardFilterV1 extends EntityV1 {
  kind: 'dashboardFilter'
  projectId: EntityId
  semanticKey: string
  fieldIds: EntityId[]
  control: FilterControlV1
  predicate: PredicateV1 | null
  scope: {
    dashboardIds: EntityId[]
    pageIds: EntityId[]
    widgetIds: EntityId[]
  }
  defaultValue: QueryScalar | QueryScalar[] | null
}

export interface ThemeV1 extends EntityV1 {
  kind: 'theme'
  projectId: EntityId
  fonts: {
    body: string
    heading: string
    mono: string
  }
  colors: {
    canvas: string
    surface: string
    surfaceMuted: string
    text: string
    textMuted: string
    border: string
    positive: string
    warning: string
    negative: string
    accent: string
  }
  chartPalette: string[]
  radii: {
    small: number
    medium: number
    large: number
  }
  shadows: {
    card: string
    elevated: string
  }
  spacing: {
    compact: number
    normal: number
    spacious: number
  }
}

export type ScalarLiteralV1 =
  | { dataType: 'text'; value: string }
  | { dataType: 'number'; value: number }
  | { dataType: 'boolean'; value: boolean }
  | { dataType: 'date'; value: string }
  | { dataType: 'datetime'; value: string }
  | { dataType: 'workWeek'; value: string }

export type PredicateValueOperatorV1 =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'

export interface PredicateGroupV1 {
  kind: 'group'
  mode: 'all' | 'any'
  predicates: PredicateV1[]
}

export interface PredicateBlankV1 {
  kind: 'condition'
  fieldId: EntityId
  operator: 'isBlank' | 'isNotBlank'
}

export interface PredicateValueV1 {
  kind: 'condition'
  fieldId: EntityId
  operator: PredicateValueOperatorV1
  value: ScalarLiteralV1
  caseSensitive?: boolean
}

export interface PredicateSetV1 {
  kind: 'condition'
  fieldId: EntityId
  operator: 'oneOf' | 'notOneOf'
  values: ScalarLiteralV1[]
  caseSensitive?: boolean
}

export interface PredicateBetweenV1 {
  kind: 'condition'
  fieldId: EntityId
  operator: 'between'
  lower: ScalarLiteralV1
  upper: ScalarLiteralV1
  inclusive: boolean
}

export type PredicateConditionV1 =
  | PredicateBlankV1
  | PredicateValueV1
  | PredicateSetV1
  | PredicateBetweenV1

export type PredicateV1 = PredicateGroupV1 | PredicateConditionV1

export type AggregationOperationV1 =
  | 'countRows'
  | 'countNonEmpty'
  | 'distinctCount'
  | 'sum'
  | 'average'
  | 'min'
  | 'max'
  | 'first'
  | 'last'

export interface AggregationV1 {
  schemaVersion: StudioSchemaVersion
  id: EntityId
  label: string
  operation: AggregationOperationV1
  fieldId?: EntityId
  where?: PredicateV1
  orderBy?: {
    fieldId: EntityId
    direction: 'ascending' | 'descending'
  }
}

export interface QueryGroupByV1 {
  fieldId: EntityId
}

export type QueryOrderV1 =
  | {
      by: 'group'
      fieldId: EntityId
      direction: 'ascending' | 'descending'
    }
  | {
      by: 'aggregation'
      aggregationId: EntityId
      direction: 'ascending' | 'descending'
    }

export interface QuerySpecV1 {
  schemaVersion: StudioSchemaVersion
  id: EntityId
  datasetId: EntityId
  where?: PredicateV1
  groupBy: QueryGroupByV1[]
  aggregations: AggregationV1[]
  orderBy?: QueryOrderV1[]
  limit?: number
}

export interface LibraryDocumentV1 {
  kind: 'kpintelligence.library'
  schemaVersion: StudioSchemaVersion
  revision: number
  id: EntityId
  name: string
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
  folders: LibraryFolderV1[]
  projects: ProjectV1[]
  dashboards: DashboardV1[]
  pages: DashboardPageV1[]
  widgets: DashboardWidgetV1[]
  layouts: DashboardLayoutV1[]
  exportProfiles: ExportProfileV1[]
  sources: SourceV1[]
  datasets: DatasetV1[]
  fields: FieldV1[]
  filters: DashboardFilterV1[]
  themes: ThemeV1[]
}

export type LibraryDocument = LibraryDocumentV1
