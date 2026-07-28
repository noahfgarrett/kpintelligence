import {
  AlertTriangle,
  ArrowDownAZ,
  ArrowLeft,
  ArrowRight,
  AreaChart,
  BarChart3,
  Binary,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  Check,
  ChevronDown,
  ClipboardCheck,
  CircleHelp,
  Copy,
  Database,
  Download,
  Eye,
  FileSpreadsheet,
  Filter,
  Funnel,
  Gauge,
  GitCompareArrows,
  GripVertical,
  Grid3X3,
  Hash,
  LayoutGrid,
  Layers3,
  LineChart,
  Lock,
  MoreHorizontal,
  Paintbrush,
  PanelRightClose,
  PanelRightOpen,
  PieChart,
  Plus,
  Redo2,
  RefreshCw,
  RotateCcw,
  Rows3,
  Search,
  Settings2,
  Share2,
  ScatterChart,
  SlidersHorizontal,
  Sparkles,
  Radar,
  Table2,
  TextCursorInput,
  Text as TextIcon,
  Trash2,
  Undo2,
  Unlock,
  WandSparkles,
  X,
} from 'lucide-react'
import {
  ReactGridLayout,
  useContainerWidth,
  verticalCompactor,
  type Layout,
  type LayoutItem,
} from 'react-grid-layout'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { platform } from '@/platform'
import { useModalFocus } from '@/hooks/useModalFocus'
import {
  emptySourceRepairs,
  findSourceFieldRepair,
  inspectSourceHealth,
  type DatasetProfile,
  type InferredFieldType,
  type ProfiledRawValue,
  type SpreadsheetCatalogProfile,
} from '../data'
import {
  createId,
  createWidget,
  type DashboardFilterRecord,
  type DashboardRecord,
  type ExportProfileRecord,
  type ProjectRecord,
  type ProjectSourceRepairs,
  type SavedCalculationRecord,
  type SourceFieldRepairRecord,
  type StudioCondition,
  type StudioWidgetQuery,
  type StudioWidgetRecord,
} from '../library/model'
import { VISUAL_CATALOG, visualCatalogItem, type StudioVisualType } from '../renderers/catalog'
import DashboardExportStage from '../export/DashboardExportStage'
import { exportRenderedDashboard } from '../export/customDashboard'
import {
  runExportPreflight,
  type ExportPreflightIssue,
  type ExportPreflightReport,
} from '../export/preflight'
import {
  dashboardFilterConditions,
  displayCell,
  resolveDashboardFilterField,
  runStudioQuery,
  sentenceForQuery,
} from './queryAdapter'
import { suggestQuickCharts, type QuickChartSuggestion } from './quickChart'
import { isWorkWeekPreset, WORK_WEEK_PRESETS, workWeekPresetLabel } from './relativePeriods'
import WidgetView from './WidgetView'

interface DashboardStudioProps {
  dashboard: DashboardRecord
  project: ProjectRecord
  catalog: SpreadsheetCatalogProfile | null
  sourceStatus: 'idle' | 'loading' | 'ready' | 'warning' | 'error'
  sourceMessage: string
  exportProfile: ExportProfileRecord | null
  onChange: (dashboard: DashboardRecord) => void
  onChooseSource: () => void
  onImportFiles: (files: File[]) => void
  onRefreshSource: () => void
  onOpenExport: () => void
  onShare: () => void
  onSourceRepairsChange: (repairs: ProjectSourceRepairs) => void
  onBack: () => void
  persistenceStatus: 'saved' | 'saving' | 'error'
  persistenceMessage: string
}

interface DashboardHistory {
  past: DashboardRecord[]
  present: DashboardRecord
  future: DashboardRecord[]
}

type DashboardHistoryAction =
  | { type: 'commit'; value: DashboardRecord }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'syncExternal'; value: DashboardRecord }

function historyReducer(state: DashboardHistory, action: DashboardHistoryAction): DashboardHistory {
  if (action.type === 'syncExternal') {
    return {
      past: [],
      present: action.value,
      future: [],
    }
  }
  if (action.type === 'undo') {
    const previous = state.past[state.past.length - 1]
    if (!previous) return state
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future].slice(0, 60),
    }
  }
  if (action.type === 'redo') {
    const next = state.future[0]
    if (!next) return state
    return {
      past: [...state.past, state.present].slice(-60),
      present: next,
      future: state.future.slice(1),
    }
  }
  if (action.value === state.present) return state
  return {
    past: [...state.past, state.present].slice(-60),
    present: action.value,
    future: [],
  }
}

function updateTimestamp<T extends { updatedAt: string }>(value: T): T {
  return { ...value, updatedAt: new Date().toISOString() }
}

function createPage(name: string, order: number) {
  const now = new Date().toISOString()
  return {
    id: createId('page'),
    name,
    order,
    widgets: [],
    createdAt: now,
    updatedAt: now,
  }
}

const AGGREGATIONS = [
  { value: 'countRows', label: 'Count rows', needsField: false },
  { value: 'countNonEmpty', label: 'Count filled cells', needsField: true },
  { value: 'distinctCount', label: 'Count unique values', needsField: true },
  { value: 'sum', label: 'Sum', needsField: true },
  { value: 'average', label: 'Average', needsField: true },
  { value: 'min', label: 'Minimum', needsField: true },
  { value: 'max', label: 'Maximum', needsField: true },
] as const

type ConditionOperatorOption = {
  value: StudioCondition['operator']
  label: string
  takesValue: boolean
}

const CONDITION_OPERATORS: ConditionOperatorOption[] = [
  { value: 'equals', label: 'is', takesValue: true },
  { value: 'notEquals', label: 'is not', takesValue: true },
  { value: 'contains', label: 'contains', takesValue: true },
  { value: 'notContains', label: 'does not contain', takesValue: true },
  { value: 'startsWith', label: 'starts with', takesValue: true },
  { value: 'endsWith', label: 'ends with', takesValue: true },
  { value: 'greaterThan', label: 'is greater than', takesValue: true },
  { value: 'greaterThanOrEqual', label: 'is at least', takesValue: true },
  { value: 'lessThan', label: 'is less than', takesValue: true },
  { value: 'lessThanOrEqual', label: 'is at most', takesValue: true },
  { value: 'oneOf', label: 'is one of', takesValue: true },
  { value: 'notOneOf', label: 'is none of', takesValue: true },
  { value: 'between', label: 'is between', takesValue: true },
  { value: 'isBlank', label: 'is blank', takesValue: false },
  { value: 'isNotBlank', label: 'is not blank', takesValue: false },
]

function conditionOperatorsFor(
  field: DatasetProfile['fields'][number] | undefined,
): ConditionOperatorOption[] {
  if (!field) return CONDITION_OPERATORS
  const valid = field.inferredType === 'text'
    ? new Set<StudioCondition['operator']>([
        'equals',
        'notEquals',
        'contains',
        'notContains',
        'startsWith',
        'endsWith',
        'oneOf',
        'notOneOf',
        'isBlank',
        'isNotBlank',
      ])
    : field.inferredType === 'boolean'
      ? new Set<StudioCondition['operator']>([
          'equals',
          'notEquals',
          'oneOf',
          'notOneOf',
          'isBlank',
          'isNotBlank',
        ])
      : new Set<StudioCondition['operator']>([
          'equals',
          'notEquals',
          'greaterThan',
          'greaterThanOrEqual',
          'lessThan',
          'lessThanOrEqual',
          'oneOf',
          'notOneOf',
          'between',
          'isBlank',
          'isNotBlank',
        ])
  return CONDITION_OPERATORS.filter((candidate) => valid.has(candidate.value))
}

const PALETTES = [
  ['#155eef', '#12b76a', '#f79009', '#f04438', '#7a5af8', '#06aed4'],
  ['#0b4f6c', '#01baef', '#20bf55', '#f7b32b', '#f45b69', '#8f5bd7'],
  ['#111827', '#2563eb', '#0d9488', '#ca8a04', '#dc2626', '#9333ea'],
  ['#334155', '#0ea5e9', '#22c55e', '#eab308', '#f97316', '#ef4444'],
]

function visualGlyph(type: StudioVisualType) {
  if (type === 'kpi') return <Sparkles size={16} />
  if (type === 'splitKpi') return <LayoutGrid size={16} />
  if (type === 'table') return <Table2 size={16} />
  if (type === 'text') return <TextIcon size={16} />
  if (type === 'column') return <ChartNoAxesColumnIncreasing size={16} />
  if (type === 'bar') return <BarChart3 size={16} />
  if (type === 'stackedBar') return <Layers3 size={16} />
  if (type === 'line') return <LineChart size={16} />
  if (type === 'area') return <AreaChart size={16} />
  if (type === 'combo') return <GitCompareArrows size={16} />
  if (type === 'donut' || type === 'pie') return <PieChart size={16} />
  if (type === 'treemap' || type === 'heatmap') return <Grid3X3 size={16} />
  if (type === 'scatter') return <ScatterChart size={16} />
  if (type === 'radar') return <Radar size={16} />
  if (type === 'gauge') return <Gauge size={16} />
  if (type === 'funnel') return <Funnel size={16} />
  if (type === 'progress') return <SlidersHorizontal size={16} />
  return <BarChart3 size={16} />
}

function fieldGlyph(field: DatasetProfile['fields'][number]) {
  if (field.inferredType === 'number') return <Hash size={13} />
  if (field.inferredType === 'date' || field.inferredType === 'datetime' || field.inferredType === 'workWeek') {
    return <CalendarDays size={13} />
  }
  if (field.inferredType === 'boolean') return <Binary size={13} />
  return <TextCursorInput size={13} />
}

function datasetLabel(dataset: DatasetProfile, catalog: SpreadsheetCatalogProfile | null): string {
  const workbook = catalog?.workbooks.find((candidate) => candidate.id === dataset.workbookId)
  return workbook ? `${workbook.fileName} / ${dataset.worksheetName}` : dataset.name
}

function layoutForWidgets(widgets: StudioWidgetRecord[]): Layout {
  return widgets.map((widget) => ({
    i: widget.id,
    x: widget.layout.x,
    y: widget.layout.y,
    w: widget.layout.w,
    h: widget.layout.h,
    minW: widget.layout.minW,
    minH: widget.layout.minH,
    static: widget.locked,
  }))
}

function nextCanvasPosition(widgets: StudioWidgetRecord[]): { x: number; y: number } {
  const y = widgets.reduce((bottom, widget) => Math.max(bottom, widget.layout.y + widget.layout.h), 0)
  return { x: 0, y }
}

function visualSupportsSeries(type: StudioVisualType): boolean {
  return ['column', 'bar', 'stackedBar', 'line', 'area', 'scatter', 'heatmap'].includes(type)
}

function queryForVisualType(
  query: StudioWidgetQuery,
  type: StudioVisualType,
): StudioWidgetQuery {
  const supportsGrouping = !['kpi', 'splitKpi', 'progress', 'gauge', 'table', 'text'].includes(type)
  const supportsSecondary = type === 'combo' || type === 'scatter' || type === 'splitKpi' || type === 'kpi'
  return {
    ...query,
    groupByFieldId: supportsGrouping ? query.groupByFieldId : null,
    seriesFieldId: visualSupportsSeries(type) ? query.seriesFieldId : null,
    secondaryAggregation: supportsSecondary
      ? query.secondaryAggregation ?? 'countRows'
      : null,
    secondaryMeasureFieldId: supportsSecondary ? query.secondaryMeasureFieldId : null,
    metricCalculation: type === 'kpi' ? query.metricCalculation ?? 'none' : 'none',
  }
}

function queryForDataset(
  query: StudioWidgetQuery,
  datasetId: string | null,
  visualType: StudioVisualType,
  tableFieldIds: string[] = [],
): StudioWidgetQuery {
  return {
    ...query,
    datasetId,
    aggregation: 'countRows',
    measureFieldId: null,
    secondaryAggregation: null,
    secondaryMeasureFieldId: null,
    metricCalculation: 'none',
    secondaryRuleMode: 'same',
    secondaryMatch: 'all',
    secondaryConditions: [],
    groupByFieldId: null,
    seriesFieldId: null,
    tableFieldIds: visualType === 'table' ? tableFieldIds : [],
    resultTransform: 'none',
    match: 'all',
    conditions: [],
  }
}

interface FilterOption {
  value: string
  label: string
}

function filterOption(value: ProfiledRawValue): FilterOption | null {
  if (value === null) return null
  if (value instanceof Date) {
    return { value: value.toISOString(), label: value.toLocaleDateString() }
  }
  return {
    value: String(value),
    label: displayCell(value),
  }
}

function FieldSelect({
  label,
  value,
  fields,
  onChange,
  allowNone = true,
}: {
  label: string
  value: string | null
  fields: DatasetProfile['fields']
  onChange: (value: string | null) => void
  allowNone?: boolean
}) {
  return (
    <label className="studio-field">
      <span>{label}</span>
      <select value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
        {allowNone && <option value="">None</option>}
        {fields.map((field) => (
          <option value={field.id} key={field.id}>{field.name}</option>
        ))}
      </select>
    </label>
  )
}

type FieldRole = 'measure' | 'category' | 'series' | 'secondary' | 'table'

function FieldRoleWell({
  label,
  hint,
  dataset,
  fieldIds,
  multiple = false,
  onAssign,
  onRemove,
}: {
  label: string
  hint: string
  dataset: DatasetProfile
  fieldIds: string[]
  multiple?: boolean
  onAssign: (datasetId: string, fieldId: string) => void
  onRemove: (fieldId: string) => void
}) {
  const selectedFields = fieldIds
    .map((fieldId) => dataset.fields.find((field) => field.id === fieldId))
    .filter((field): field is DatasetProfile['fields'][number] => Boolean(field))
  return (
    <div
      className={`field-role-well ${selectedFields.length > 0 ? 'filled' : ''}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/kpintelligence-field')) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(event) => {
        const payload = event.dataTransfer.getData('application/kpintelligence-field')
        if (!payload) return
        event.preventDefault()
        try {
          const parsed = JSON.parse(payload) as { datasetId?: string; fieldId?: string }
          if (parsed.datasetId && parsed.fieldId) onAssign(parsed.datasetId, parsed.fieldId)
        } catch {
          return
        }
      }}
    >
      <div className="field-role-label">
        <strong>{label}</strong>
        <small>{hint}</small>
      </div>
      <div className="field-role-values">
        {selectedFields.map((field) => (
          <span key={field.id}>
            {field.name}
            <button
              type="button"
              aria-label={`Remove ${field.name} from ${label}`}
              onClick={() => onRemove(field.id)}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        {selectedFields.length === 0 && <em>Drop a column here</em>}
      </div>
      <select
        aria-label={`Choose ${label}`}
        value={!multiple && selectedFields[0] ? selectedFields[0].id : ''}
        onChange={(event) => {
          if (event.target.value) onAssign(dataset.id, event.target.value)
        }}
      >
        <option value="">{multiple ? 'Add column' : 'Choose column'}</option>
        {dataset.fields
          .filter((field) => !multiple || !selectedFields.some((selected) => selected.id === field.id))
          .map((field) => <option value={field.id} key={field.id}>{field.name}</option>)}
      </select>
    </div>
  )
}

function RuleBuilder({
  title,
  fields,
  conditions,
  match,
  onAdd,
  onMatchChange,
  onUpdate,
  onRemove,
}: {
  title: string
  fields: DatasetProfile['fields']
  conditions: StudioCondition[]
  match: 'all' | 'any'
  onAdd: () => void
  onMatchChange: (match: 'all' | 'any') => void
  onUpdate: (id: string, updates: Partial<StudioCondition>) => void
  onRemove: (id: string) => void
}) {
  return (
    <section className="inspector-section">
      <div className="inspector-section-title">
        <h3>{title}</h3>
        <button type="button" onClick={onAdd}><Plus size={14} /> Add</button>
      </div>
      {conditions.length > 1 && (
        <div className="match-mode">
          <span>Keep rows when</span>
          <select value={match} onChange={(event) => onMatchChange(event.target.value as 'all' | 'any')}>
            <option value="all">all rules match</option>
            <option value="any">any rule matches</option>
          </select>
        </div>
      )}
      {conditions.length === 0 ? (
        <button className="empty-rule" type="button" onClick={onAdd}>
          <Filter size={16} />
          Only include the rows you need
        </button>
      ) : (
        <div className="condition-list">
          {conditions.map((condition) => {
            const field = fields.find((candidate) => candidate.id === condition.fieldId)
            const conditionOperators = conditionOperatorsFor(field)
            const operator = conditionOperators.find((candidate) => candidate.value === condition.operator)
            const valueListId = `condition-values-${condition.id}`
            const [lowerValue = '', upperValue = ''] = condition.value.split('..', 2)
            const relativeWorkWeek = field?.inferredType === 'workWeek' && isWorkWeekPreset(condition.value)
            return (
              <div className={`condition-row ${relativeWorkWeek ? 'relative-period' : ''}`} key={condition.id}>
                <select
                  value={condition.fieldId}
                  aria-label="Rule column"
                  onChange={(event) => onUpdate(condition.id, {
                    fieldId: event.target.value,
                    operator: 'equals',
                    value: '',
                  })}
                >
                  {fields.map((candidate) => (
                    <option value={candidate.id} key={candidate.id}>{candidate.name}</option>
                  ))}
                </select>
                {field?.inferredType === 'workWeek' && (
                  <select
                    value={relativeWorkWeek ? condition.value : 'custom'}
                    aria-label="Rule reporting period"
                    title={relativeWorkWeek ? workWeekPresetLabel(condition.value) ?? undefined : 'Specific work week'}
                    onChange={(event) => {
                      const value = event.target.value
                      if (value === 'custom') {
                        onUpdate(condition.id, { operator: 'equals', value: '' })
                        return
                      }
                      const operatorForPreset: StudioCondition['operator'] = value.includes('through')
                        ? 'lessThanOrEqual'
                        : value.includes('last-')
                          ? 'between'
                          : 'equals'
                      onUpdate(condition.id, { operator: operatorForPreset, value })
                    }}
                  >
                    <option value="custom">Specific work week</option>
                    {WORK_WEEK_PRESETS.map((preset) => (
                      <option value={preset.value} key={preset.value}>{preset.label}</option>
                    ))}
                  </select>
                )}
                {!relativeWorkWeek && (
                  <select
                    value={condition.operator}
                    aria-label="Rule operator"
                    onChange={(event) => onUpdate(condition.id, {
                      operator: event.target.value as StudioCondition['operator'],
                    })}
                  >
                    {conditionOperators.map((candidate) => (
                      <option value={candidate.value} key={candidate.value}>{candidate.label}</option>
                    ))}
                  </select>
                )}
                {!relativeWorkWeek && operator?.takesValue && condition.operator === 'between' && (
                  <div className="condition-range">
                    <input
                      value={lowerValue}
                      aria-label="Rule lower value"
                      placeholder="From"
                      onChange={(event) => onUpdate(condition.id, {
                        value: `${event.target.value}..${upperValue}`,
                      })}
                    />
                    <span>to</span>
                    <input
                      value={upperValue}
                      aria-label="Rule upper value"
                      placeholder="Through"
                      onChange={(event) => onUpdate(condition.id, {
                        value: `${lowerValue}..${event.target.value}`,
                      })}
                    />
                  </div>
                )}
                {!relativeWorkWeek && operator?.takesValue && condition.operator !== 'between' && field?.inferredType === 'boolean' ? (
                  <select
                    className="condition-value"
                    value={condition.value}
                    aria-label="Rule value"
                    onChange={(event) => onUpdate(condition.id, { value: event.target.value })}
                  >
                    <option value="">Choose a value</option>
                    <option value="true">True</option>
                    <option value="false">False</option>
                  </select>
                ) : !relativeWorkWeek && operator?.takesValue && condition.operator !== 'between' && (
                  <input
                    value={condition.value}
                    list={valueListId}
                    type={field?.inferredType === 'number' && !['oneOf', 'notOneOf'].includes(condition.operator) ? 'number' : 'text'}
                    aria-label="Rule value"
                    placeholder={['oneOf', 'notOneOf'].includes(condition.operator) ? 'A, B, C' : 'Choose or enter a value'}
                    onChange={(event) => onUpdate(condition.id, { value: event.target.value })}
                  />
                )}
                {field && field.sampleValues.length > 0 && !relativeWorkWeek && (
                  <datalist id={valueListId}>
                    {field.sampleValues.slice(0, 20).map((sample) => (
                      <option value={sample.display} key={`${sample.display}-${sample.count}`} />
                    ))}
                  </datalist>
                )}
                <button type="button" aria-label="Remove rule" onClick={() => onRemove(condition.id)}>
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

const REPAIR_FIELD_TYPES: Array<{ value: InferredFieldType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Date and time' },
  { value: 'workWeek', label: 'Work week' },
]

function SourceRepairCenter({
  open,
  catalog,
  repairs,
  onChange,
  onClose,
}: {
  open: boolean
  catalog: SpreadsheetCatalogProfile | null
  repairs: ProjectSourceRepairs
  onChange: (repairs: ProjectSourceRepairs) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const [activeDatasetId, setActiveDatasetId] = useState('')
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  useModalFocus(open, dialogRef, onClose)

  useEffect(() => {
    if (!open || !catalog?.datasets.length) return
    if (!catalog.datasets.some((dataset) => dataset.id === activeDatasetId)) {
      setActiveDatasetId(catalog.datasets[0].id)
    }
  }, [activeDatasetId, catalog, open])

  const health = useMemo(
    () => catalog ? inspectSourceHealth(catalog, repairs) : null,
    [catalog, repairs],
  )
  const dataset = catalog?.datasets.find((candidate) => candidate.id === activeDatasetId)
    ?? catalog?.datasets[0]
  const reviewed = Boolean(dataset && repairs.reviewedDatasetIds.includes(dataset.id))
  const visibleFields = dataset?.fields.filter((field) => {
    const normalized = search.trim().toLowerCase()
    return !normalized
      || field.name.toLowerCase().includes(normalized)
      || field.headerDisplay.toLowerCase().includes(normalized)
      || field.sampleValues.some((sample) => sample.display.toLowerCase().includes(normalized))
  }) ?? []

  function fieldRepair(fieldId: string): SourceFieldRepairRecord | undefined {
    const field = dataset?.fields.find((candidate) => candidate.id === fieldId)
    return dataset && field && catalog
      ? findSourceFieldRepair(catalog, dataset, field, repairs)
      : undefined
  }

  function updateField(
    field: DatasetProfile['fields'][number],
    updates: Pick<SourceFieldRepairRecord, 'displayName' | 'dataType'>,
  ): void {
    if (!dataset) return
    const existing = fieldRepair(field.id)
    const sourceName = field.headerDisplay.trim() || `Column ${field.sourceColumnLabel}`
    const workbook = catalog?.workbooks.find((candidate) => candidate.id === dataset.workbookId)
    const displayName = updates.displayName?.trim() === sourceName
      ? null
      : updates.displayName?.trim() || null
    const next: SourceFieldRepairRecord = {
      id: existing?.id ?? createId('field-repair'),
      datasetId: dataset.id,
      fieldId: field.id,
      workbookFileName: workbook?.fileName,
      datasetName: dataset.name,
      worksheetName: dataset.worksheetName,
      fieldKey: field.key,
      sourceHeader: field.headerDisplay,
      sourceColumnIndex: field.sourceColumnIndex,
      displayName,
      dataType: updates.dataType,
      updatedAt: new Date().toISOString(),
    }
    const duplicateName = displayName
      ? dataset.fields.some((candidate) =>
          candidate.id !== field.id
          && candidate.name.trim().toLowerCase() === displayName.toLowerCase())
      : false
    if (duplicateName) {
      setMessage('Column display names must be unique within a worksheet.')
      return
    }
    const fieldRepairs = displayName === null && next.dataType === null
      ? repairs.fieldRepairs.filter((repair) => repair.id !== existing?.id)
      : existing
        ? repairs.fieldRepairs.map((repair) => repair.id === existing.id ? next : repair)
        : [...repairs.fieldRepairs, next]
    setMessage(displayName === null && next.dataType === null
      ? `${sourceName} restored to automatic settings.`
      : `${displayName || sourceName} updated.`)
    onChange({ ...repairs, fieldRepairs })
  }

  if (!open) return null
  return (
    <div className="studio-row-drawer-backdrop source-repair-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        ref={dialogRef}
        className="source-repair-center"
        role="dialog"
        aria-modal="true"
        aria-label="Review spreadsheet data"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="source-repair-header">
          <div>
            <span>Intake and repair</span>
            <strong>Review spreadsheet data</strong>
            <small>{catalog
              ? `${catalog.workbooks.length} files · ${catalog.datasets.length} worksheets`
              : 'Connect a spreadsheet source to begin.'}</small>
          </div>
          <button type="button" onClick={onClose} aria-label="Close data review"><X size={17} /></button>
        </header>
        {!catalog?.datasets.length ? (
          <div className="source-repair-empty">
            <Database size={24} />
            <strong>No spreadsheet data loaded</strong>
          </div>
        ) : (
          <>
            <div className={`source-health-strip ${health?.status ?? 'ready'}`}>
              <span><ClipboardCheck size={18} /></span>
              <div>
                <strong>{health?.status === 'ready' ? 'Data is ready' : 'Review suggested'}</strong>
                <small>
                  {health?.warningCount ?? 0} warnings · {health?.noteCount ?? 0} notes ·{' '}
                  {health?.reviewedDatasetCount ?? 0} reviewed
                </small>
              </div>
            </div>
            <div className="source-repair-layout">
              <nav className="source-dataset-list" aria-label="Worksheets">
                {catalog.datasets.map((candidate) => {
                  const issueCount = health?.issues.filter((issue) => issue.datasetId === candidate.id).length ?? 0
                  const isReviewed = repairs.reviewedDatasetIds.includes(candidate.id)
                  return (
                    <button
                      type="button"
                      className={candidate.id === dataset?.id ? 'active' : ''}
                      key={candidate.id}
                      onClick={() => {
                        setActiveDatasetId(candidate.id)
                        setSearch('')
                        setMessage('')
                      }}
                    >
                      <span><Database size={15} /></span>
                      <div>
                        <strong>{candidate.name}</strong>
                        <small>{candidate.rowCount.toLocaleString()} rows · {candidate.fields.length} columns</small>
                      </div>
                      {isReviewed
                        ? <Check size={14} />
                        : issueCount > 0
                          ? <em>{issueCount}</em>
                          : null}
                    </button>
                  )
                })}
              </nav>
              {dataset && (
                <section className="source-repair-workspace">
                  <div className="source-repair-toolbar">
                    <div>
                      <strong>{dataset.name}</strong>
                      <small>
                        Header row {dataset.headerRowNumber} · {Math.round(dataset.headerConfidence * 100)}% confidence
                      </small>
                    </div>
                    <button
                      type="button"
                      className={reviewed ? 'reviewed' : ''}
                      onClick={() => onChange({
                        ...repairs,
                        reviewedDatasetIds: reviewed
                          ? repairs.reviewedDatasetIds.filter((id) => id !== dataset.id)
                          : [...repairs.reviewedDatasetIds, dataset.id],
                      })}
                    >
                      <Check size={14} /> {reviewed ? 'Reviewed' : 'Mark reviewed'}
                    </button>
                  </div>
                  <label className="studio-search source-repair-search">
                    <Search size={14} />
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Find a column or sample value"
                    />
                  </label>
                  <div className="source-repair-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Column</th>
                          <th>Display name</th>
                          <th>Type</th>
                          <th>Examples</th>
                          <th><span className="studio-sr-only">Reset</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleFields.map((field) => {
                          const repair = fieldRepair(field.id)
                          return (
                            <tr key={`${field.id}:${field.name}`}>
                              <td>
                                <strong>{field.sourceColumnLabel}</strong>
                                <small>{Math.round(field.typeConfidence * 100)}% confidence</small>
                              </td>
                              <td>
                                <input
                                  defaultValue={field.name}
                                  aria-label={`${field.name} display name`}
                                  onBlur={(event) => updateField(field, {
                                    displayName: event.target.value,
                                    dataType: repair?.dataType ?? null,
                                  })}
                                />
                              </td>
                              <td>
                                <select
                                  value={repair?.dataType ?? 'auto'}
                                  aria-label={`${field.name} data type`}
                                  onChange={(event) => updateField(field, {
                                    displayName: repair?.displayName ?? null,
                                    dataType: event.target.value === 'auto'
                                      ? null
                                      : event.target.value as InferredFieldType,
                                  })}
                                >
                                  <option value="auto">Automatic ({field.inferredType})</option>
                                  {REPAIR_FIELD_TYPES.map((type) => (
                                    <option value={type.value} key={type.value}>{type.label}</option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <span>{field.sampleValues.slice(0, 3).map((sample) => sample.display).join(' · ') || 'No values'}</span>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="studio-icon-button"
                                  disabled={!repair}
                                  aria-label={`Reset ${field.name}`}
                                  title={`Reset ${field.name}`}
                                  onClick={() => updateField(field, { displayName: null, dataType: null })}
                                >
                                  <RotateCcw size={14} />
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <footer>
                    <span role="status">{message}</span>
                    <small>{visibleFields.length} of {dataset.fields.length} columns</small>
                  </footer>
                </section>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  )
}

export default function DashboardStudio({
  dashboard,
  project,
  catalog,
  sourceStatus,
  sourceMessage,
  exportProfile,
  onChange,
  onChooseSource,
  onImportFiles,
  onRefreshSource,
  onOpenExport,
  onShare,
  onSourceRepairsChange,
  onBack,
  persistenceStatus,
  persistenceMessage,
}: DashboardStudioProps) {
  const seeded = useMemo<DashboardRecord>(() => {
    if (dashboard.pages.length > 0) return dashboard
    return {
      ...dashboard,
      pages: [createPage('Overview', 0)],
    }
  }, [dashboard.id])
  const [history, dispatch] = useReducer(historyReducer, {
    past: [],
    present: seeded,
    future: [],
  })
  const draft = history.present
  const [activePageId, setActivePageId] = useState(draft.pages[0]?.id ?? '')
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null)
  const [leftTab, setLeftTab] = useState<'visuals' | 'data'>('visuals')
  const [inspectorTab, setInspectorTab] = useState<'data' | 'appearance' | 'settings'>('data')
  const [preview, setPreview] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [paletteSearch, setPaletteSearch] = useState('')
  const [dataSearch, setDataSearch] = useState('')
  const [previewDatasetId, setPreviewDatasetId] = useState<string | null>(null)
  const [sourceRepairOpen, setSourceRepairOpen] = useState(false)
  const [pageMenuOpen, setPageMenuOpen] = useState(false)
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [filterDatasetId, setFilterDatasetId] = useState('')
  const [filterFieldId, setFilterFieldId] = useState('')
  const [filterScope, setFilterScope] = useState<'dashboard' | 'page'>('dashboard')
  const [calculationName, setCalculationName] = useState('')
  const [selectedCalculationId, setSelectedCalculationId] = useState('')
  const [openSlicerId, setOpenSlicerId] = useState<string | null>(null)
  const [slicerAlignRight, setSlicerAlignRight] = useState(false)
  const [slicerSearch, setSlicerSearch] = useState('')
  const [runtimeFilterValues, setRuntimeFilterValues] = useState<Record<string, string[]>>(
    () => Object.fromEntries(draft.filters.map((filter) => [
      filter.id,
      filter.values === undefined
        ? filter.value ? [filter.value] : []
        : filter.values,
    ])),
  )
  const [crossFilter, setCrossFilter] = useState<DashboardFilterRecord | null>(null)
  const [crossFilterSourceWidgetId, setCrossFilterSourceWidgetId] = useState<string | null>(null)
  const [quickSelection, setQuickSelection] = useState<{
    datasetId: string
    fieldIds: string[]
  }>({ datasetId: '', fieldIds: [] })
  const [quickChartMessage, setQuickChartMessage] = useState('')
  const [widgetMenuId, setWidgetMenuId] = useState<string | null>(null)
  const [activeExportProfile, setActiveExportProfile] = useState<ExportProfileRecord | null>(null)
  const [activeExportDashboard, setActiveExportDashboard] = useState<DashboardRecord | null>(null)
  const [exportPreflight, setExportPreflight] = useState<ExportPreflightReport | null>(null)
  const [pendingExportProfile, setPendingExportProfile] = useState<ExportProfileRecord | null>(null)
  const [pendingExportDashboard, setPendingExportDashboard] = useState<DashboardRecord | null>(null)
  const [exportMessage, setExportMessage] = useState<{
    text: string
    kind: 'progress' | 'success' | 'error'
  } | null>(null)
  const [rowDrawerOpen, setRowDrawerOpen] = useState(false)
  const [drillCategory, setDrillCategory] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const rowDrawerRef = useRef<HTMLElement>(null)
  const preflightRef = useRef<HTMLElement>(null)
  const quickMessageTimerRef = useRef<number | null>(null)
  const keyboardActionRef = useRef<(event: KeyboardEvent) => void>(() => {})
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 1120 })
  const previewDataset = catalog?.datasets.find((dataset) => dataset.id === previewDatasetId) ?? null
  useModalFocus(rowDrawerOpen || Boolean(previewDataset), rowDrawerRef, () => {
    setRowDrawerOpen(false)
    setPreviewDatasetId(null)
  })
  useModalFocus(Boolean(exportPreflight), preflightRef, closeExportPreflight)

  const activePage = draft.pages.find((page) => page.id === activePageId) ?? draft.pages[0]
  const selectedWidget = activePage?.widgets.find((widget) => widget.id === selectedWidgetId) ?? null
  const selectedDataset = catalog?.datasets.find((dataset) => dataset.id === selectedWidget?.query.datasetId)
  const filterDataset = catalog?.datasets.find((dataset) => dataset.id === filterDatasetId)
    ?? catalog?.datasets[0]
  const filterField = filterDataset?.fields.find((field) => field.id === filterFieldId)
    ?? filterDataset?.fields[0]
  const quickDataset = catalog?.datasets.find((dataset) => dataset.id === quickSelection.datasetId)
  const quickSuggestions = useMemo(
    () => quickDataset ? suggestQuickCharts(quickDataset, quickSelection.fieldIds) : [],
    [quickDataset, quickSelection.fieldIds],
  )
  const sourceHealth = useMemo(
    () => catalog ? inspectSourceHealth(catalog, project.sourceRepairs) : null,
    [catalog, project.sourceRepairs],
  )
  const calculationNameExists = Boolean(calculationName.trim()
    && draft.calculations?.some((calculation) =>
      calculation.name.trim().toLowerCase() === calculationName.trim().toLowerCase()))
  const runtimeFilters = useMemo(() => draft.filters.map((filter) => {
    const values = runtimeFilterValues[filter.id]
      ?? (filter.values === undefined
        ? filter.value ? [filter.value] : []
        : filter.values)
    return {
      ...filter,
      value: values[0] ?? '',
      values,
      enabled: filter.enabled && values.length > 0,
    }
  }), [draft.filters, runtimeFilterValues])
  const viewFilters = useMemo(
    () => crossFilter ? [...runtimeFilters, crossFilter] : runtimeFilters,
    [crossFilter, runtimeFilters],
  )
  const exportDashboardRef = useRef<DashboardRecord>(draft)
  exportDashboardRef.current = { ...draft, filters: viewFilters }
  const filterValueMap = useMemo(() => {
    const values = new Map<string, Map<string, string>>()
    draft.filters.forEach((filter) => {
      const key = filter.fieldName.trim().toLowerCase()
      catalog?.datasets.forEach((dataset) => {
        const field = resolveDashboardFilterField(filter, dataset)
        if (!field) return
        const fieldValues = values.get(key) ?? new Map<string, string>()
        for (const row of dataset.rows) {
          const option = filterOption(row.cells[field.id]?.raw ?? null)
          if (option?.value.trim()) fieldValues.set(option.value, option.label)
        }
        values.set(key, fieldValues)
      })
    })
    return values
  }, [catalog, draft.filters])
  const queryPreview = useMemo(() => {
    if (!selectedWidget || !selectedDataset || selectedWidget.visualType === 'text') return null
    try {
      return runStudioQuery(
        selectedWidget.query,
        selectedDataset,
        dashboardFilterConditions(viewFilters, selectedDataset, activePage?.id),
      )
    } catch {
      return null
    }
  }, [activePage?.id, selectedWidget, selectedDataset, viewFilters])
  const drillRowIndices = useMemo(() => {
    const indices = queryPreview?.result.diagnostics.matchedRowIndices ?? []
    const fieldId = selectedWidget?.query.groupByFieldId
    if (!drillCategory || !fieldId || !selectedDataset) return indices
    return indices.filter((rowIndex) =>
      displayCell(selectedDataset.rows[rowIndex]?.cells[fieldId]?.raw ?? null) === drillCategory)
  }, [drillCategory, queryPreview, selectedDataset, selectedWidget?.query.groupByFieldId])

  useEffect(() => {
    if (dashboard.pages.length === 0) onChangeRef.current(seeded)
  }, [])

  useEffect(() => {
    if (dashboard.updatedAt === draft.updatedAt) return
    dispatch({ type: 'syncExternal', value: dashboard })
  }, [dashboard.updatedAt, draft.updatedAt])

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ profileId?: string }>).detail
      if (!exportProfile || detail?.profileId !== exportProfile.id) return
      const snapshot = exportDashboardRef.current
      const report = runExportPreflight(snapshot, catalog, exportProfile)
      if (report.status !== 'ready') {
        setExportPreflight(report)
        setPendingExportProfile(exportProfile)
        setPendingExportDashboard(snapshot)
        return
      }
      beginExport(exportProfile, snapshot)
    }
    window.addEventListener('kpintelligence:export-dashboard', listener)
    return () => window.removeEventListener('kpintelligence:export-dashboard', listener)
  }, [catalog, exportProfile])

  useEffect(() => {
    if (!activePage && draft.pages[0]) setActivePageId(draft.pages[0].id)
  }, [activePage, draft.pages])

  useEffect(() => {
    if (!quickSelection.datasetId) return
    if (!catalog?.datasets.some((dataset) => dataset.id === quickSelection.datasetId)) {
      setQuickSelection({ datasetId: '', fieldIds: [] })
    }
  }, [catalog, quickSelection.datasetId])

  useEffect(() => {
    setRuntimeFilterValues((current) => Object.fromEntries(
      draft.filters.map((filter) => [
        filter.id,
        current[filter.id] ?? (filter.values === undefined
          ? filter.value ? [filter.value] : []
          : filter.values),
      ]),
    ))
  }, [draft.filters])

  useEffect(() => () => {
    if (quickMessageTimerRef.current !== null) {
      window.clearTimeout(quickMessageTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!openSlicerId) return
    const triggerFor = (filterId: string) => [...document.querySelectorAll<HTMLElement>('[data-slicer-id]')]
      .find((element) => element.dataset.slicerId === filterId)
      ?.querySelector<HTMLButtonElement>('.global-filter-trigger')
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      const chip = target?.closest<HTMLElement>('[data-slicer-id]')
      if (chip?.dataset.slicerId === openSlicerId) return
      setOpenSlicerId(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      const filterId = openSlicerId
      setOpenSlicerId(null)
      window.requestAnimationFrame(() => triggerFor(filterId)?.focus())
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openSlicerId])

  keyboardActionRef.current = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    const editing = target?.matches('input, textarea, select, [contenteditable="true"]')
    const overlayOpen = Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'))
    const inMenu = Boolean(target?.closest('[role="dialog"], [role="menu"], .slicer-popover'))
    if (event.defaultPrevented || editing || overlayOpen || inMenu) return
    const command = event.metaKey || event.ctrlKey
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
      return
    }
    if (command && event.key.toLowerCase() === 'd' && selectedWidgetId) {
      event.preventDefault()
      duplicateWidget(selectedWidgetId)
      return
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && selectedWidgetId) {
      event.preventDefault()
      deleteWidget(selectedWidgetId)
      return
    }
    if (event.altKey && selectedWidget && event.key.startsWith('Arrow')) {
      event.preventDefault()
      updateWidget(selectedWidget.id, (widget) => {
        if (widget.locked) return widget
        const horizontal = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
        const vertical = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
        return {
          ...widget,
          layout: {
            ...widget.layout,
            x: Math.max(0, Math.min(12 - widget.layout.w, widget.layout.x + horizontal)),
            y: Math.max(0, widget.layout.y + vertical),
          },
        }
      })
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keyboardActionRef.current(event)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function commit(value: DashboardRecord): void {
    const updated = updateTimestamp(value)
    dispatch({ type: 'commit', value: updated })
    onChangeRef.current(updated)
  }

  function undo(): void {
    const previous = history.past[history.past.length - 1]
    if (!previous) return
    dispatch({ type: 'undo' })
    onChangeRef.current(previous)
  }

  function redo(): void {
    const next = history.future[0]
    if (!next) return
    dispatch({ type: 'redo' })
    onChangeRef.current(next)
  }

  function updateCurrentPage(updater: (page: NonNullable<typeof activePage>) => NonNullable<typeof activePage>): void {
    if (!activePage) return
    commit({
      ...draft,
      pages: draft.pages.map((page) => page.id === activePage.id ? updateTimestamp(updater(page)) : page),
    })
  }

  function updateWidget(widgetId: string, updater: (widget: StudioWidgetRecord) => StudioWidgetRecord): void {
    updateCurrentPage((page) => ({
      ...page,
      widgets: page.widgets.map((widget) =>
        widget.id === widgetId ? updateTimestamp(updater(widget)) : widget),
    }))
  }

  function addWidget(type: StudioVisualType, dropPosition?: Pick<LayoutItem, 'x' | 'y'>): void {
    if (!activePage) return
    const widget = createWidget(type, dropPosition ?? nextCanvasPosition(activePage.widgets))
    if (catalog?.datasets[0]) {
      widget.query.datasetId = catalog.datasets[0].id
      widget.query.tableFieldIds = catalog.datasets[0].fields.slice(0, 6).map((field) => field.id)
      if (!['kpi', 'splitKpi', 'progress', 'gauge', 'text', 'table'].includes(type)) {
        widget.query.groupByFieldId = catalog.datasets[0].fields[0]?.id ?? null
      }
    }
    widget.title = visualCatalogItem(type).name
    updateCurrentPage((page) => ({ ...page, widgets: [...page.widgets, widget] }))
    setSelectedWidgetId(widget.id)
    setInspectorOpen(true)
    setInspectorTab('data')
  }

  function addSuggestedWidget(suggestion: QuickChartSuggestion): void {
    if (!activePage) return
    const widget = createWidget(suggestion.visualType, nextCanvasPosition(activePage.widgets))
    widget.title = suggestion.title
    widget.query = {
      ...widget.query,
      ...suggestion.query,
    }
    widget.appearance = {
      ...widget.appearance,
      ...suggestion.appearance,
    }
    updateCurrentPage((page) => ({ ...page, widgets: [...page.widgets, widget] }))
    setSelectedWidgetId(widget.id)
    setInspectorOpen(true)
    setInspectorTab('data')
    if (quickMessageTimerRef.current !== null) {
      window.clearTimeout(quickMessageTimerRef.current)
    }
    setQuickChartMessage(`${suggestion.title} added to ${activePage.name}.`)
    quickMessageTimerRef.current = window.setTimeout(() => {
      setQuickChartMessage('')
      quickMessageTimerRef.current = null
    }, 3500)
  }

  function toggleQuickField(datasetId: string, fieldId: string): void {
    setQuickSelection((current) => {
      if (current.datasetId !== datasetId) {
        return { datasetId, fieldIds: [fieldId] }
      }
      return {
        datasetId,
        fieldIds: current.fieldIds.includes(fieldId)
          ? current.fieldIds.filter((candidate) => candidate !== fieldId)
          : [...current.fieldIds, fieldId],
      }
    })
  }

  function applyFieldToSelectedWidget(
    dataset: DatasetProfile,
    field: DatasetProfile['fields'][number],
  ): void {
    if (!selectedWidget) return
    updateWidget(selectedWidget.id, (widget) => {
      if (widget.visualType === 'text') return widget
      const query: StudioWidgetQuery = widget.query.datasetId === dataset.id
        ? { ...widget.query }
        : {
            ...widget.query,
            datasetId: dataset.id,
            measureFieldId: null,
            secondaryMeasureFieldId: null,
            groupByFieldId: null,
            seriesFieldId: null,
            tableFieldIds: [],
            conditions: [],
            secondaryConditions: [],
          }
      query.datasetId = dataset.id

      if (widget.visualType === 'table') {
        query.tableFieldIds = query.tableFieldIds.includes(field.id)
          ? query.tableFieldIds
          : [...query.tableFieldIds, field.id]
      } else if (field.inferredType === 'number') {
        if (
          ['combo', 'scatter', 'splitKpi'].includes(widget.visualType)
          && query.measureFieldId
          && query.measureFieldId !== field.id
        ) {
          query.secondaryAggregation = 'sum'
          query.secondaryMeasureFieldId = field.id
        } else {
          query.aggregation = 'sum'
          query.measureFieldId = field.id
        }
      } else if (['kpi', 'splitKpi', 'progress', 'gauge'].includes(widget.visualType)) {
        if (widget.visualType === 'splitKpi' && query.measureFieldId && query.measureFieldId !== field.id) {
          query.secondaryAggregation = 'countNonEmpty'
          query.secondaryMeasureFieldId = field.id
        } else {
          query.aggregation = 'countNonEmpty'
          query.measureFieldId = field.id
        }
      } else if (
        visualSupportsSeries(widget.visualType)
        && query.groupByFieldId
        && query.groupByFieldId !== field.id
      ) {
        query.seriesFieldId = field.id
      } else {
        query.groupByFieldId = field.id
      }
      return { ...widget, query }
    })
  }

  function assignFieldRole(role: FieldRole, datasetId: string, fieldId: string): void {
    if (!selectedWidget) return
    const dataset = catalog?.datasets.find((candidate) => candidate.id === datasetId)
    const field = dataset?.fields.find((candidate) => candidate.id === fieldId)
    if (!dataset || !field) return
    updateWidget(selectedWidget.id, (widget) => {
      const query: StudioWidgetQuery = widget.query.datasetId === dataset.id
        ? { ...widget.query }
        : queryForDataset(widget.query, dataset.id, widget.visualType)
      query.datasetId = dataset.id
      if (role === 'measure') {
        query.aggregation = field.inferredType === 'number' ? 'sum' : 'countNonEmpty'
        query.measureFieldId = field.id
      } else if (role === 'category') {
        query.groupByFieldId = field.id
      } else if (role === 'series') {
        query.seriesFieldId = field.id
      } else if (role === 'secondary') {
        query.secondaryAggregation = field.inferredType === 'number' ? 'sum' : 'countNonEmpty'
        query.secondaryMeasureFieldId = field.id
      } else if (!query.tableFieldIds.includes(field.id)) {
        query.tableFieldIds = [...query.tableFieldIds, field.id]
      }
      return { ...widget, query }
    })
  }

  function removeFieldRole(role: FieldRole, fieldId: string): void {
    if (!selectedWidget) return
    updateWidget(selectedWidget.id, (widget) => {
      const query = { ...widget.query }
      if (role === 'measure' && query.measureFieldId === fieldId) {
        query.measureFieldId = null
        query.aggregation = 'countRows'
      }
      if (role === 'category' && query.groupByFieldId === fieldId) query.groupByFieldId = null
      if (role === 'series' && query.seriesFieldId === fieldId) query.seriesFieldId = null
      if (role === 'secondary' && query.secondaryMeasureFieldId === fieldId) {
        query.secondaryMeasureFieldId = null
        query.secondaryAggregation = null
      }
      if (role === 'table') {
        query.tableFieldIds = query.tableFieldIds.filter((candidate) => candidate !== fieldId)
      }
      return { ...widget, query }
    })
  }

  function saveCalculation(): void {
    if (!selectedWidget?.query.datasetId) return
    const name = calculationName.trim()
    if (!name) return
    const timestamp = new Date().toISOString()
    const existing = (draft.calculations ?? []).find((candidate) =>
      candidate.name.trim().toLowerCase() === name.toLowerCase())
    const calculation: SavedCalculationRecord = {
      id: existing?.id ?? createId('calculation'),
      name,
      datasetId: selectedWidget.query.datasetId,
      aggregation: selectedWidget.query.aggregation,
      measureFieldId: selectedWidget.query.measureFieldId,
      secondaryAggregation: selectedWidget.query.secondaryAggregation,
      secondaryMeasureFieldId: selectedWidget.query.secondaryMeasureFieldId,
      metricCalculation: selectedWidget.query.metricCalculation ?? 'none',
      secondaryRuleMode: selectedWidget.query.secondaryRuleMode ?? 'same',
      secondaryMatch: selectedWidget.query.secondaryMatch ?? 'all',
      secondaryConditions: structuredClone(selectedWidget.query.secondaryConditions ?? []),
      resultTransform: selectedWidget.query.resultTransform ?? 'none',
      match: selectedWidget.query.match,
      conditions: structuredClone(selectedWidget.query.conditions),
      valueFormat: selectedWidget.appearance.valueFormat,
      currencyCode: selectedWidget.appearance.currencyCode,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    commit({
      ...draft,
      calculations: existing
        ? (draft.calculations ?? []).map((candidate) =>
            candidate.id === existing.id ? calculation : candidate)
        : [...(draft.calculations ?? []), calculation],
    })
    setCalculationName('')
    setSelectedCalculationId(calculation.id)
  }

  function applyCalculation(calculationId: string): void {
    if (!selectedWidget) return
    const calculation = draft.calculations?.find((candidate) => candidate.id === calculationId)
    if (!calculation) return
    updateWidget(selectedWidget.id, (widget) => {
      const switchingDataset = widget.query.datasetId !== calculation.datasetId
      return {
        ...widget,
        query: {
          ...widget.query,
          datasetId: calculation.datasetId,
          aggregation: calculation.aggregation,
          measureFieldId: calculation.measureFieldId,
          secondaryAggregation: calculation.secondaryAggregation,
          secondaryMeasureFieldId: calculation.secondaryMeasureFieldId,
          metricCalculation: calculation.metricCalculation,
          secondaryRuleMode: calculation.secondaryRuleMode,
          secondaryMatch: calculation.secondaryMatch,
          secondaryConditions: structuredClone(calculation.secondaryConditions),
          resultTransform: calculation.resultTransform ?? 'none',
          match: calculation.match,
          conditions: structuredClone(calculation.conditions),
          groupByFieldId: switchingDataset ? null : widget.query.groupByFieldId,
          seriesFieldId: switchingDataset ? null : widget.query.seriesFieldId,
          tableFieldIds: switchingDataset ? [] : widget.query.tableFieldIds,
        },
        appearance: {
          ...widget.appearance,
          valueFormat: calculation.valueFormat,
          currencyCode: calculation.currencyCode,
        },
      }
    })
  }

  function deleteCalculation(calculationId: string): void {
    commit({
      ...draft,
      calculations: (draft.calculations ?? []).filter((calculation) =>
        calculation.id !== calculationId),
    })
    setSelectedCalculationId('')
  }

  function duplicateWidget(widgetId: string): void {
    const source = activePage?.widgets.find((widget) => widget.id === widgetId)
    if (!source) return
    const now = new Date().toISOString()
    const duplicate: StudioWidgetRecord = {
      ...structuredClone(source),
      id: createId('widget'),
      title: `${source.title} copy`,
      layout: {
        ...source.layout,
        x: Math.min(11 - source.layout.w + 1, source.layout.x + 1),
        y: source.layout.y + 1,
      },
      createdAt: now,
      updatedAt: now,
    }
    updateCurrentPage((page) => ({ ...page, widgets: [...page.widgets, duplicate] }))
    setSelectedWidgetId(duplicate.id)
    setWidgetMenuId(null)
  }

  function deleteWidget(widgetId: string): void {
    updateCurrentPage((page) => ({
      ...page,
      widgets: page.widgets.filter((widget) => widget.id !== widgetId),
    }))
    if (selectedWidgetId === widgetId) setSelectedWidgetId(null)
    setWidgetMenuId(null)
  }

  function commitLayout(layout: Layout): void {
    if (!activePage) return
    const byId = new Map(layout.map((item) => [item.i, item]))
    updateCurrentPage((page) => ({
      ...page,
      widgets: page.widgets.map((widget) => {
        const item = byId.get(widget.id)
        return item
          ? {
              ...widget,
              layout: {
                ...widget.layout,
                x: item.x,
                y: item.y,
                w: item.w,
                h: item.h,
              },
            }
          : widget
      }),
    }))
  }

  function addCondition(target: 'primary' | 'secondary' = 'primary'): void {
    if (!selectedWidget || !selectedDataset?.fields[0]) return
    updateWidget(selectedWidget.id, (widget) => ({
      ...widget,
      query: {
        ...widget.query,
        ...(target === 'primary'
          ? {
              conditions: [
                ...widget.query.conditions,
                {
                  id: createId('condition'),
                  fieldId: selectedDataset.fields[0].id,
                  operator: 'equals' as const,
                  value: '',
                },
              ],
            }
          : {
              secondaryConditions: [
                ...(widget.query.secondaryConditions ?? []),
                {
                  id: createId('condition'),
                  fieldId: selectedDataset.fields[0].id,
                  operator: 'equals' as const,
                  value: '',
                },
              ],
            }),
      },
    }))
  }

  function updateCondition(
    id: string,
    updates: Partial<StudioCondition>,
    target: 'primary' | 'secondary' = 'primary',
  ): void {
    if (!selectedWidget) return
    updateWidget(selectedWidget.id, (widget) => ({
      ...widget,
      query: {
        ...widget.query,
        ...(target === 'primary'
          ? {
              conditions: widget.query.conditions.map((condition) =>
                condition.id === id ? { ...condition, ...updates } : condition),
            }
          : {
              secondaryConditions: (widget.query.secondaryConditions ?? []).map((condition) =>
                condition.id === id ? { ...condition, ...updates } : condition),
            }),
      },
    }))
  }

  function removeCondition(id: string, target: 'primary' | 'secondary' = 'primary'): void {
    if (!selectedWidget) return
    updateWidget(selectedWidget.id, (widget) => ({
      ...widget,
      query: {
        ...widget.query,
        ...(target === 'primary'
          ? { conditions: widget.query.conditions.filter((condition) => condition.id !== id) }
          : {
              secondaryConditions: (widget.query.secondaryConditions ?? [])
                .filter((condition) => condition.id !== id),
            }),
      },
    }))
  }

  function addPage(): void {
    const page = createPage(`Page ${draft.pages.length + 1}`, draft.pages.length)
    commit({ ...draft, pages: [...draft.pages, page] })
    setActivePageId(page.id)
    setSelectedWidgetId(null)
    setPageMenuOpen(false)
  }

  function deletePage(): void {
    if (!activePage || draft.pages.length <= 1) return
    const pages = draft.pages.filter((page) => page.id !== activePage.id)
    commit({
      ...draft,
      pages: pages.map((page, index) => ({ ...page, order: index })),
      filters: draft.filters.filter((filter) =>
        (filter.scope ?? 'dashboard') !== 'page' || filter.pageId !== activePage.id),
    })
    setActivePageId(pages[0]?.id ?? '')
    setSelectedWidgetId(null)
    setPageMenuOpen(false)
  }

  function addDashboardFilter(): void {
    if (!filterField) return
    commit({
      ...draft,
      filters: [
        ...draft.filters,
        {
          id: createId('filter'),
          name: filterField.name,
          fieldName: filterField.name,
          fieldType: filterField.inferredType,
          bindings: filterDataset ? [{
            datasetId: filterDataset.id,
            fieldId: filterField.id,
            fieldKey: filterField.key,
            fieldName: filterField.name,
            fieldType: filterField.inferredType,
          }] : [],
          value: '',
          values: [],
          selectionMode: 'multiple',
          operator: 'include',
          scope: filterScope,
          pageId: filterScope === 'page' ? activePage?.id ?? null : null,
          enabled: true,
        },
      ],
    })
    setFilterMenuOpen(false)
  }

  function updateFilterDefinition(
    filterId: string,
    updates: Partial<DashboardFilterRecord>,
  ): void {
    commit({
      ...draft,
      filters: draft.filters.map((filter) =>
        filter.id === filterId ? { ...filter, ...updates } : filter),
    })
  }

  function setRuntimeFilterSelection(filterId: string, values: string[]): void {
    setRuntimeFilterValues((current) => ({ ...current, [filterId]: values }))
  }

  function toggleRuntimeFilterValue(filter: DashboardFilterRecord, value: string): void {
    const selected = runtimeFilterValues[filter.id]
      ?? (filter.values === undefined
        ? filter.value ? [filter.value] : []
        : filter.values)
    if ((filter.selectionMode ?? 'multiple') === 'single') {
      setRuntimeFilterSelection(filter.id, selected.includes(value) ? [] : [value])
      return
    }
    setRuntimeFilterSelection(
      filter.id,
      selected.includes(value)
        ? selected.filter((candidate) => candidate !== value)
        : [...selected, value],
    )
  }

  function removeDashboardFilter(filterId: string): void {
    commit({
      ...draft,
      filters: draft.filters.filter((filter) => filter.id !== filterId),
    })
    setRuntimeFilterValues((current) => {
      const next = { ...current }
      delete next[filterId]
      return next
    })
    if (openSlicerId === filterId) setOpenSlicerId(null)
  }

  function clearRuntimeFilters(): void {
    setRuntimeFilterValues(Object.fromEntries(draft.filters.map((filter) => [filter.id, []])))
    setCrossFilter(null)
    setCrossFilterSourceWidgetId(null)
  }

  function filterValues(fieldName: string): FilterOption[] {
    const values = filterValueMap.get(fieldName.trim().toLowerCase()) ?? new Map<string, string>()
    return [...values].map(([value, label]) => ({ value, label })).sort((left, right) =>
      left.label.localeCompare(right.label, undefined, { numeric: true }))
  }

  const filteredCatalog = VISUAL_CATALOG.filter((item) => {
    const search = paletteSearch.trim().toLowerCase()
    return !search || `${item.name} ${item.description} ${item.family}`.toLowerCase().includes(search)
  })
  const families = [...new Set(filteredCatalog.map((item) => item.family))]

  function beginExport(profile: ExportProfileRecord, snapshot: DashboardRecord): void {
    setExportPreflight(null)
    setPendingExportProfile(null)
    setPendingExportDashboard(null)
    setExportMessage({ text: 'Rendering every dashboard page…', kind: 'progress' })
    setActiveExportProfile(profile)
    setActiveExportDashboard(snapshot)
  }

  function closeExportPreflight(): void {
    setExportPreflight(null)
    setPendingExportProfile(null)
    setPendingExportDashboard(null)
  }

  function locatePreflightIssue(issue: ExportPreflightIssue): void {
    if (issue.pageId) setActivePageId(issue.pageId)
    if (issue.widgetId) {
      setSelectedWidgetId(issue.widgetId)
      setInspectorOpen(true)
      setInspectorTab('data')
    }
    setPreview(false)
    closeExportPreflight()
  }

  async function finishExport(): Promise<void> {
    if (!activeExportProfile) return
    try {
      setExportMessage({
        text: `Building ${activeExportProfile.format.toUpperCase()}…`,
        kind: 'progress',
      })
      const generated = await exportRenderedDashboard(
        activeExportDashboard ?? draft,
        activeExportProfile,
      )
      const destination = await platform.saveFile(generated.data, generated.fileName, generated.filters)
      setExportMessage(destination
        ? { text: `${generated.fileName} saved`, kind: 'success' }
        : { text: 'Export canceled', kind: 'success' })
      window.setTimeout(() => setExportMessage(null), 3500)
    } catch (error) {
      setExportMessage({
        text: error instanceof Error ? error.message : 'The dashboard could not be exported.',
        kind: 'error',
      })
      window.setTimeout(() => setExportMessage(null), 7000)
    } finally {
      setActiveExportProfile(null)
      setActiveExportDashboard(null)
    }
  }

  function failExport(message: string): void {
    setActiveExportProfile(null)
    setActiveExportDashboard(null)
    setExportMessage({ text: message, kind: 'error' })
    window.setTimeout(() => setExportMessage(null), 7000)
  }

  return (
    <div className={`dashboard-studio ${preview ? 'preview-mode' : ''} ${inspectorOpen ? '' : 'inspector-collapsed'}`}>
      <div className="studio-sr-status" role="status" aria-live="polite">{quickChartMessage}</div>
      <header className="studio-topbar">
        <div className="studio-breadcrumbs">
          <button className="studio-icon-button" type="button" onClick={onBack} aria-label="Back to project">
            <ArrowLeft size={17} />
          </button>
          <span>{project.name}</span>
          <span className="studio-beta-badge">Studio beta</span>
          <ArrowRight size={14} />
          <input
            value={draft.name}
            aria-label="Dashboard name"
            onChange={(event) => commit({ ...draft, name: event.target.value })}
          />
        </div>
        <div className={`studio-save-state ${persistenceStatus}`}>
          {persistenceStatus === 'error'
            ? <AlertTriangle size={14} />
            : persistenceStatus === 'saving'
              ? <RefreshCw className="spin" size={14} />
              : <Check size={14} />}
          {persistenceStatus === 'error'
            ? persistenceMessage
            : persistenceStatus === 'saving'
              ? 'Saving locally…'
              : 'Saved locally'}
        </div>
        <div className="studio-topbar-actions">
          <button
            className="studio-icon-button"
            type="button"
            onClick={undo}
            disabled={history.past.length === 0}
            aria-label="Undo"
            title="Undo"
          >
            <Undo2 size={16} />
          </button>
          <button
            className="studio-icon-button"
            type="button"
            onClick={redo}
            disabled={history.future.length === 0}
            aria-label="Redo"
            title="Redo"
          >
            <Redo2 size={16} />
          </button>
          <div className="studio-mode-toggle" role="group" aria-label="Dashboard mode">
            <button type="button" className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>
              <LayoutGrid size={15} /> Edit
            </button>
            <button type="button" className={preview ? 'active' : ''} onClick={() => setPreview(true)}>
              <Eye size={15} /> Preview
            </button>
          </div>
          <button
            className="studio-button secondary"
            type="button"
            onClick={onShare}
            title="Share dashboard package"
          >
            <Share2 size={16} />
            Share
          </button>
          <button
            className="studio-button secondary"
            type="button"
            onClick={onOpenExport}
            disabled={!catalog || (sourceStatus !== 'ready' && sourceStatus !== 'warning')}
            title={!catalog || (sourceStatus !== 'ready' && sourceStatus !== 'warning')
              ? 'Connect and finish loading a spreadsheet source before exporting.'
              : 'Export dashboard'}
          >
            <Download size={16} />
            Export
          </button>
          <button
            className="studio-icon-button"
            type="button"
            onClick={() => setInspectorOpen((open) => !open)}
            aria-label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
            title={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
          >
            {inspectorOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
          </button>
        </div>
      </header>

      <aside className="studio-palette">
        <div className="studio-panel-tabs" role="tablist" aria-label="Builder palette">
          <button
            id="studio-visuals-tab"
            role="tab"
            aria-selected={leftTab === 'visuals'}
            aria-controls="studio-visuals-panel"
            className={leftTab === 'visuals' ? 'active' : ''}
            type="button"
            onClick={() => setLeftTab('visuals')}
          >
            <BarChart3 size={15} /> Visuals
          </button>
          <button
            id="studio-data-tab"
            role="tab"
            aria-selected={leftTab === 'data'}
            aria-controls="studio-data-panel"
            className={leftTab === 'data' ? 'active' : ''}
            type="button"
            onClick={() => setLeftTab('data')}
          >
            <Database size={15} /> Data
          </button>
        </div>

        {leftTab === 'visuals' ? (
          <div
            id="studio-visuals-panel"
            className="studio-palette-body"
            role="tabpanel"
            aria-labelledby="studio-visuals-tab"
          >
            <label className="studio-search">
              <Search size={15} />
              <input value={paletteSearch} onChange={(event) => setPaletteSearch(event.target.value)} placeholder="Find a visual" />
            </label>
            <p className="studio-palette-hint">Drag onto the canvas or click to add.</p>
            {families.map((family) => (
              <section className="studio-palette-group" key={family}>
                <h3>{family}</h3>
                <div className="studio-visual-grid">
                  {filteredCatalog.filter((item) => item.family === family).map((item) => (
                    <button
                      type="button"
                      key={item.type}
                      draggable
                      className="studio-visual-option"
                      title={item.description}
                      onDragStart={(event) => {
                        event.dataTransfer.setData('application/kpintelligence-visual', item.type)
                        event.dataTransfer.effectAllowed = 'copy'
                      }}
                      onClick={() => addWidget(item.type)}
                    >
                      <span>{visualGlyph(item.type)}</span>
                      <strong>{item.name}</strong>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div
            id="studio-data-panel"
            className="studio-palette-body data-palette"
            role="tabpanel"
            aria-labelledby="studio-data-tab"
          >
            <div className={`studio-source-state ${sourceStatus}`}>
              <span><FileSpreadsheet size={17} /></span>
              <div>
                <strong>{project.sourceFolder ? 'Project source' : 'Connect project data'}</strong>
                <p>{sourceMessage}</p>
              </div>
            </div>
            <div className="studio-source-actions">
              <button className="studio-button secondary" type="button" onClick={onChooseSource}>
                <Database size={15} />
                {project.sourceFolder ? 'Change folder' : 'Choose folder'}
              </button>
              <button
                className="studio-icon-button"
                type="button"
                onClick={onRefreshSource}
                disabled={sourceStatus === 'loading'}
                aria-label="Refresh project data"
                title="Refresh project data"
              >
                <RefreshCw className={sourceStatus === 'loading' ? 'spin' : ''} size={16} />
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              multiple
              accept=".xls,.xlsx,.csv,.zip"
              onChange={(event) => {
                onImportFiles(Array.from(event.target.files ?? []))
                event.currentTarget.value = ''
              }}
            />
            <button className="studio-drop-link" type="button" onClick={() => fileInputRef.current?.click()}>
              Import files for this session
            </button>
            {catalog?.datasets.length ? (
              <button
                className={`source-review-button ${sourceHealth?.status ?? 'ready'}`}
                type="button"
                onClick={() => setSourceRepairOpen(true)}
              >
                <ClipboardCheck size={15} />
                <span>
                  <strong>Review data</strong>
                  <small>{sourceHealth?.status === 'ready'
                    ? 'All worksheets ready'
                    : `${(sourceHealth?.warningCount ?? 0) + (sourceHealth?.noteCount ?? 0)} items to review`}</small>
                </span>
                {(sourceHealth?.warningCount ?? 0) + (sourceHealth?.noteCount ?? 0) > 0 && (
                  <em>{(sourceHealth?.warningCount ?? 0) + (sourceHealth?.noteCount ?? 0)}</em>
                )}
              </button>
            ) : null}
            {catalog?.datasets.length ? (
              <label className="studio-search data-search">
                <Search size={15} />
                <input
                  value={dataSearch}
                  onChange={(event) => setDataSearch(event.target.value)}
                  placeholder="Find a worksheet or column"
                />
                {dataSearch && (
                  <button type="button" onClick={() => setDataSearch('')} aria-label="Clear data search">
                    <X size={13} />
                  </button>
                )}
              </label>
            ) : null}
            {catalog?.datasets.length ? (
              quickDataset && quickSelection.fieldIds.length > 0 ? (
                <section className="quick-chart-builder" aria-label="Quick chart suggestions">
                  <header>
                    <span><WandSparkles size={15} /></span>
                    <div>
                      <strong>Build from {quickDataset.name}</strong>
                      <small aria-live="polite">
                        {quickSelection.fieldIds.length} column{quickSelection.fieldIds.length === 1 ? '' : 's'} selected
                        {' · '}
                        {quickSuggestions.length} suggestion{quickSuggestions.length === 1 ? '' : 's'}
                      </small>
                    </div>
                    <button
                      type="button"
                      aria-label="Clear selected columns"
                      title="Clear selected columns"
                      onClick={() => setQuickSelection({ datasetId: '', fieldIds: [] })}
                    >
                      <X size={14} />
                    </button>
                  </header>
                  <div className="quick-field-chips">
                    {quickSelection.fieldIds.map((fieldId) => {
                      const field = quickDataset.fields.find((candidate) => candidate.id === fieldId)
                      if (!field) return null
                      return (
                        <button
                          type="button"
                          key={field.id}
                          onClick={() => toggleQuickField(quickDataset.id, field.id)}
                          title={`Remove ${field.name}`}
                        >
                          {field.name}
                          <X size={11} />
                        </button>
                      )
                    })}
                  </div>
                  <div className="quick-suggestion-list">
                    {quickSuggestions.map((suggestion, index) => (
                      <button
                        type="button"
                        className={index === 0 ? 'recommended' : ''}
                        key={suggestion.id}
                        title={suggestion.reason}
                        onClick={() => addSuggestedWidget(suggestion)}
                      >
                        <span>{visualGlyph(suggestion.visualType)}</span>
                        <div>
                          <strong>{suggestion.title}</strong>
                          <small>{suggestion.reason}</small>
                        </div>
                        <em>{index === 0 ? 'Best fit' : visualCatalogItem(suggestion.visualType).name}</em>
                      </button>
                    ))}
                  </div>
                </section>
              ) : (
                <div className="quick-chart-empty">
                  <span><WandSparkles size={16} /></span>
                  <div>
                    <strong>Build from columns</strong>
                    <small>Select one or more columns below to get a ready-to-use visual.</small>
                  </div>
                </div>
              )
            ) : null}
            {catalog?.datasets.map((dataset) => (
              <details
                className="studio-dataset"
                key={dataset.id}
                open={catalog.datasets.length === 1 || quickSelection.datasetId === dataset.id || Boolean(dataSearch)}
              >
                <summary>
                  <span><Database size={15} /></span>
                  <div>
                    <strong>{dataset.name}</strong>
                    <small>{dataset.rowCount.toLocaleString()} rows · {dataset.fields.length} columns</small>
                  </div>
                  <ChevronDown size={14} />
                </summary>
                <div className="studio-dataset-toolbar">
                  <button type="button" onClick={() => setPreviewDatasetId(dataset.id)}>
                    <Rows3 size={13} /> Preview rows
                  </button>
                </div>
                <div className="studio-field-list">
                  {dataset.fields
                    .filter((field) => {
                      const search = dataSearch.trim().toLowerCase()
                      return !search
                        || dataset.name.toLowerCase().includes(search)
                        || field.name.toLowerCase().includes(search)
                        || field.sampleValues.some((sample) => sample.display.toLowerCase().includes(search))
                    })
                    .map((field) => {
                    const selected = quickSelection.datasetId === dataset.id
                      && quickSelection.fieldIds.includes(field.id)
                    return (
                      <div
                        className={`studio-field-row ${selected ? 'selected' : ''}`}
                        key={field.id}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData('application/kpintelligence-field', JSON.stringify({
                            datasetId: dataset.id,
                            fieldId: field.id,
                          }))
                          event.dataTransfer.setData('text/plain', field.name)
                          event.dataTransfer.effectAllowed = 'copy'
                        }}
                      >
                        <button
                          className="studio-field-select"
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggleQuickField(dataset.id, field.id)}
                        >
                          <span className="studio-field-kind">
                            {selected ? <Check size={13} /> : fieldGlyph(field)}
                          </span>
                          <strong>{field.name}</strong>
                          <small>
                            {field.inferredType === 'workWeek' ? 'work week' : field.inferredType}
                            {' · '}
                            {field.distinctCount.toLocaleString()} unique
                            {field.blankCount > 0 ? ` · ${field.blankCount.toLocaleString()} blank` : ''}
                          </small>
                        </button>
                        {selectedWidget && (
                          <button
                            className="studio-field-apply"
                            type="button"
                            aria-label={`Use ${field.name} in ${selectedWidget.title}`}
                            title={`Use in ${selectedWidget.title}`}
                            onClick={() => applyFieldToSelectedWidget(dataset, field)}
                          >
                            <ArrowRight size={13} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {dataset.fields.filter((field) => {
                    const search = dataSearch.trim().toLowerCase()
                    return !search
                      || dataset.name.toLowerCase().includes(search)
                      || field.name.toLowerCase().includes(search)
                      || field.sampleValues.some((sample) => sample.display.toLowerCase().includes(search))
                  }).length === 0 && (
                    <div className="studio-field-empty">No columns match this search.</div>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </aside>

      <main className="studio-workspace">
        <div className="studio-pagebar">
          <div className="studio-page-tabs">
            {draft.pages.map((page) => (
              <button
                type="button"
                className={page.id === activePage?.id ? 'active' : ''}
                key={page.id}
                onClick={() => {
                  setActivePageId(page.id)
                  setSelectedWidgetId(null)
                }}
              >
                {page.name}
              </button>
            ))}
            {!preview && <button className="add-page" type="button" onClick={addPage} aria-label="Add page"><Plus size={15} /></button>}
          </div>
          {!preview && (
            <div className="studio-page-actions">
              <div className="studio-filter-menu">
                <button
                  className={`studio-filter-button ${draft.filters.length > 0 ? 'active' : ''}`}
                  type="button"
                  onClick={() => {
                    setFilterMenuOpen((open) => !open)
                    setPageMenuOpen(false)
                  }}
                >
                  <Filter size={14} />
                  Filters
                  {draft.filters.length > 0 && <span>{draft.filters.length}</span>}
                </button>
                {filterMenuOpen && (
                  <div className="studio-popover filter-popover">
                    <div className="filter-popover-head">
                      <strong>Add dashboard filter</strong>
                      <small>Applied to matching columns on every visual.</small>
                    </div>
                    <label>
                      <span>Spreadsheet / worksheet</span>
                      <select
                        value={filterDataset?.id ?? ''}
                        onChange={(event) => {
                          setFilterDatasetId(event.target.value)
                          setFilterFieldId('')
                        }}
                      >
                        {catalog?.datasets.map((dataset) => (
                          <option value={dataset.id} key={dataset.id}>{datasetLabel(dataset, catalog)}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Column</span>
                      <select value={filterField?.id ?? ''} onChange={(event) => setFilterFieldId(event.target.value)}>
                        {filterDataset?.fields.map((field) => (
                          <option value={field.id} key={field.id}>{field.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Apply to</span>
                      <select
                        value={filterScope}
                        onChange={(event) => setFilterScope(event.target.value as 'dashboard' | 'page')}
                      >
                        <option value="dashboard">Every page</option>
                        <option value="page">This page only</option>
                      </select>
                    </label>
                    <button type="button" className="primary-popover-action" disabled={!filterField} onClick={addDashboardFilter}>
                      <Plus size={14} /> Add filter
                    </button>
                  </div>
                )}
              </div>
              <div className="studio-page-menu">
              <button className="studio-icon-button" type="button" onClick={() => setPageMenuOpen((open) => !open)} aria-label="Page options">
                <MoreHorizontal size={16} />
              </button>
              {pageMenuOpen && activePage && (
                <div className="studio-popover page-popover">
                  <label>
                    <span>Page name</span>
                    <input
                      value={activePage.name}
                      onChange={(event) => updateCurrentPage((page) => ({ ...page, name: event.target.value }))}
                    />
                  </label>
                  <button type="button" onClick={addPage}><Plus size={14} /> Add page</button>
                  <button type="button" className="danger" disabled={draft.pages.length <= 1} onClick={deletePage}>
                    <Trash2 size={14} /> Delete page
                  </button>
                </div>
              )}
              </div>
            </div>
          )}
        </div>

        {(draft.filters.length > 0 || crossFilter) && (
          <div className="studio-global-filters">
            <span className="global-filter-label"><SlidersHorizontal size={14} /> Slicers</span>
            {draft.filters.map((filter) => {
              const selected = runtimeFilterValues[filter.id]
                ?? (filter.values === undefined
                  ? filter.value ? [filter.value] : []
                  : filter.values)
              const available = filterValues(filter.fieldName)
              const search = openSlicerId === filter.id ? slicerSearch.trim().toLowerCase() : ''
              const matchingValues = available.filter((option) =>
                !search || option.label.toLowerCase().includes(search))
              const visibleValues = matchingValues.slice(0, 500)
              const selectedLabel = selected.length === 1
                ? available.find((option) => option.value === selected[0])?.label ?? selected[0]
                : ''
              const summary = selected.length === 0
                ? 'All'
                : selected.length === 1
                  ? selectedLabel
                  : `${selected.length} selected`
              return (
                <div
                  className={`global-filter-chip ${selected.length > 0 ? 'active' : ''}`}
                  data-slicer-id={filter.id}
                  key={filter.id}
                >
                  <button
                    className="global-filter-trigger"
                    type="button"
                    aria-haspopup="dialog"
                    aria-controls={`slicer-${filter.id}`}
                    aria-expanded={openSlicerId === filter.id}
                    onClick={(event) => {
                      const willOpen = openSlicerId !== filter.id
                      if (willOpen) {
                        const bounds = event.currentTarget.getBoundingClientRect()
                        setSlicerAlignRight(bounds.left + 280 > window.innerWidth - 12)
                      }
                      setOpenSlicerId((current) => current === filter.id ? null : filter.id)
                      setSlicerSearch('')
                    }}
                  >
                    <span>
                      <strong>{filter.name}</strong>
                      <small>
                        {(filter.operator ?? 'include') === 'exclude' ? 'Excluding' : summary}
                        {(filter.scope ?? 'dashboard') === 'page' ? ` · ${draft.pages.find((page) => page.id === filter.pageId)?.name ?? 'Page'}` : ''}
                      </small>
                    </span>
                    <ChevronDown size={13} />
                  </button>
                  {!preview && (
                    <button
                      className="global-filter-remove"
                      type="button"
                      aria-label={`Remove ${filter.name} filter`}
                      onClick={() => removeDashboardFilter(filter.id)}
                    >
                      <X size={12} />
                    </button>
                  )}
                  {openSlicerId === filter.id && (
                    <div
                      className={`slicer-popover ${slicerAlignRight ? 'align-right' : ''}`}
                      id={`slicer-${filter.id}`}
                      role="dialog"
                      aria-label={`${filter.name} slicer options`}
                    >
                      <header>
                        <div>
                          <strong>{filter.name}</strong>
                          <small>{available.length.toLocaleString()} available values</small>
                        </div>
                        <button
                          type="button"
                          onClick={() => setRuntimeFilterSelection(filter.id, [])}
                          disabled={selected.length === 0}
                        >
                          Reset
                        </button>
                      </header>
                      <label className="slicer-search">
                        <Search size={14} />
                        <input
                          autoFocus
                          value={slicerSearch}
                          placeholder="Find a value"
                          onChange={(event) => setSlicerSearch(event.target.value)}
                        />
                      </label>
                      <div className="slicer-value-list">
                        {visibleValues.length > 0 ? visibleValues.map((option) => (
                          <label key={option.value}>
                            <input
                              type={(filter.selectionMode ?? 'multiple') === 'single' ? 'radio' : 'checkbox'}
                              name={(filter.selectionMode ?? 'multiple') === 'single' ? filter.id : undefined}
                              checked={selected.includes(option.value)}
                              onChange={() => toggleRuntimeFilterValue(filter, option.value)}
                            />
                            <span title={option.label}>{option.label}</span>
                          </label>
                        )) : (
                          <p>No values match this search.</p>
                        )}
                      </div>
                      {matchingValues.length > visibleValues.length && (
                        <p className="slicer-result-limit">
                          Showing the first {visibleValues.length.toLocaleString()} matches. Refine the search to find another value.
                        </p>
                      )}
                      {!preview && (
                        <footer>
                          <select
                            aria-label={`${filter.name} include or exclude`}
                            value={filter.operator ?? 'include'}
                            onChange={(event) => updateFilterDefinition(filter.id, {
                              operator: event.target.value as 'include' | 'exclude',
                            })}
                          >
                            <option value="include">Include selected</option>
                            <option value="exclude">Exclude selected</option>
                          </select>
                          <select
                            aria-label={`${filter.name} scope`}
                            value={filter.scope ?? 'dashboard'}
                            onChange={(event) => updateFilterDefinition(filter.id, {
                              scope: event.target.value as 'dashboard' | 'page',
                              pageId: event.target.value === 'page' ? activePage?.id ?? null : null,
                            })}
                          >
                            <option value="dashboard">Every page</option>
                            <option value="page">This page</option>
                          </select>
                        </footer>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {crossFilter && (
              <button
                type="button"
                className="cross-filter-chip"
                title="Clear chart selection"
                onClick={() => {
                  setCrossFilter(null)
                  setCrossFilterSourceWidgetId(null)
                }}
              >
                <span>Chart selection</span>
                <strong>{crossFilter.name}: {crossFilter.value}</strong>
                <X size={12} />
              </button>
            )}
            <button
              className="clear-dashboard-filters"
              type="button"
              onClick={clearRuntimeFilters}
            >
              Reset view
            </button>
          </div>
        )}

        <div
          className="studio-canvas-scroll"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('application/kpintelligence-visual')) event.preventDefault()
          }}
          onDrop={(event) => {
            if ((activePage?.widgets.length ?? 0) > 0) return
            const type = event.dataTransfer.getData('application/kpintelligence-visual') as StudioVisualType
            if (!VISUAL_CATALOG.some((item) => item.type === type)) return
            event.preventDefault()
            addWidget(type)
          }}
        >
          <div className="studio-canvas" ref={containerRef} onMouseDown={() => setWidgetMenuId(null)}>
            {activePage && activePage.widgets.length === 0 ? (
              <div className="studio-canvas-empty">
                <span><Sparkles size={25} /></span>
                <h2>Build the first page</h2>
                <p>Connect a spreadsheet, then drag in a visual. Every chart starts with a readable data sentence.</p>
                <div>
                  <button type="button" onClick={() => addWidget('kpi')}><Sparkles size={16} /> Metric</button>
                  <button type="button" onClick={() => addWidget('column')}><BarChart3 size={16} /> Column chart</button>
                  <button type="button" onClick={() => addWidget('table')}><Rows3 size={16} /> Table</button>
                </div>
              </div>
            ) : mounted && activePage ? (
              <ReactGridLayout
                width={width}
                layout={layoutForWidgets(activePage.widgets)}
                gridConfig={{
                  cols: 12,
                  rowHeight: 38,
                  margin: [14, 14],
                  containerPadding: [18, 18],
                }}
                dragConfig={{
                  enabled: !preview,
                  bounded: false,
                  handle: '.widget-drag-handle',
                  cancel: 'button,input,select,textarea,.studio-echart,.studio-table-wrap',
                  threshold: 3,
                }}
                resizeConfig={{ enabled: !preview, handles: ['se'] }}
                dropConfig={{ enabled: !preview, defaultItem: { w: 6, h: 7 } }}
                compactor={verticalCompactor}
                onDragStop={(layout) => commitLayout(layout)}
                onResizeStop={(layout) => commitLayout(layout)}
                onDrop={(_layout, item, event) => {
                  const type = (event as DragEvent).dataTransfer?.getData('application/kpintelligence-visual') as StudioVisualType
                  if (item && VISUAL_CATALOG.some((candidate) => candidate.type === type)) addWidget(type, item)
                }}
              >
                {activePage.widgets.map((widget) => (
                  <div key={widget.id}>
                    <WidgetView
                      widget={widget}
                      dataset={catalog?.datasets.find((dataset) => dataset.id === widget.query.datasetId)}
                      selected={!preview && widget.id === selectedWidgetId}
                      editable={!preview}
                      dashboardFilters={crossFilterSourceWidgetId === widget.id ? runtimeFilters : viewFilters}
                      pageId={activePage.id}
                      onSelect={() => {
                        if (preview) return
                        setSelectedWidgetId(widget.id)
                        setInspectorOpen(true)
                      }}
                      onMenu={() => setWidgetMenuId((id) => id === widget.id ? null : widget.id)}
                      onPointClick={(category) => {
                        if (preview && category && widget.query.groupByFieldId) {
                          const dataset = catalog?.datasets.find((candidate) => candidate.id === widget.query.datasetId)
                          const field = dataset?.fields.find((candidate) => candidate.id === widget.query.groupByFieldId)
                          if (!dataset || !field) return
                          const matchesCurrent = crossFilterSourceWidgetId === widget.id
                            && crossFilter?.fieldName === field.name
                            && crossFilter.value === category
                          if (matchesCurrent) {
                            setCrossFilter(null)
                            setCrossFilterSourceWidgetId(null)
                            return
                          }
                          setCrossFilter({
                            id: 'runtime-chart-selection',
                            name: field.name,
                            fieldName: field.name,
                            fieldType: field.inferredType,
                            bindings: [{
                              datasetId: dataset.id,
                              fieldId: field.id,
                              fieldKey: field.key,
                              fieldName: field.name,
                              fieldType: field.inferredType,
                            }],
                            value: category,
                            values: [category],
                            selectionMode: 'single',
                            operator: 'include',
                            scope: 'page',
                            pageId: activePage.id,
                            sourceWidgetId: widget.id,
                            enabled: true,
                          })
                          setCrossFilterSourceWidgetId(widget.id)
                          return
                        }
                        setSelectedWidgetId(widget.id)
                        setDrillCategory(category || null)
                        setRowDrawerOpen(true)
                      }}
                    />
                    {widgetMenuId === widget.id && (
                      <div className="studio-popover widget-popover" onMouseDown={(event) => event.stopPropagation()}>
                        <button type="button" onClick={() => duplicateWidget(widget.id)}><Copy size={14} /> Duplicate</button>
                        <button type="button" onClick={() => updateWidget(widget.id, (current) => ({ ...current, locked: !current.locked }))}>
                          {widget.locked ? <Unlock size={14} /> : <Lock size={14} />}
                          {widget.locked ? 'Unlock' : 'Lock'}
                        </button>
                        <button type="button" className="danger" onClick={() => deleteWidget(widget.id)}><Trash2 size={14} /> Delete</button>
                      </div>
                    )}
                  </div>
                ))}
              </ReactGridLayout>
            ) : null}
          </div>
        </div>
      </main>

      {inspectorOpen && (
        <aside className="studio-inspector">
          <div className="studio-inspector-head">
            <div>
              <span>{selectedWidget ? 'Visual inspector' : 'Dashboard settings'}</span>
              <strong>{selectedWidget?.title ?? draft.name}</strong>
            </div>
            <button className="studio-icon-button" type="button" onClick={() => setInspectorOpen(false)} aria-label="Close inspector">
              <X size={16} />
            </button>
          </div>

          {selectedWidget ? (
            <>
              <div className="studio-inspector-tabs" role="tablist" aria-label="Visual settings">
                <button id="inspector-data-tab" role="tab" aria-selected={inspectorTab === 'data'} className={inspectorTab === 'data' ? 'active' : ''} type="button" onClick={() => setInspectorTab('data')}>
                  <Database size={14} /> Data
                </button>
                <button id="inspector-style-tab" role="tab" aria-selected={inspectorTab === 'appearance'} className={inspectorTab === 'appearance' ? 'active' : ''} type="button" onClick={() => setInspectorTab('appearance')}>
                  <Paintbrush size={14} /> Style
                </button>
                <button id="inspector-more-tab" role="tab" aria-selected={inspectorTab === 'settings'} className={inspectorTab === 'settings' ? 'active' : ''} type="button" onClick={() => setInspectorTab('settings')}>
                  <Settings2 size={14} /> More
                </button>
              </div>

              <div
                className="studio-inspector-body"
                role="tabpanel"
                aria-labelledby={
                  inspectorTab === 'appearance'
                    ? 'inspector-style-tab'
                    : inspectorTab === 'settings'
                      ? 'inspector-more-tab'
                      : 'inspector-data-tab'
                }
              >
                {inspectorTab === 'data' && (
                  <>
                    <section className="inspector-section">
                      <div className="inspector-section-title">
                        <span>Data sentence</span>
                        <CircleHelp size={14} />
                      </div>
                      <div className="data-sentence">{sentenceForQuery(selectedWidget.query, selectedDataset)}</div>
                      <label className="studio-field">
                        <span>Spreadsheet / worksheet</span>
                        <select
                          value={selectedWidget.query.datasetId ?? ''}
                          onChange={(event) => {
                            const dataset = catalog?.datasets.find((candidate) => candidate.id === event.target.value)
                            updateWidget(selectedWidget.id, (widget) => ({
                              ...widget,
                              query: queryForDataset(
                                widget.query,
                                dataset?.id ?? null,
                                widget.visualType,
                                dataset?.fields.slice(0, 6).map((field) => field.id) ?? [],
                              ),
                            }))
                          }}
                        >
                          <option value="">Choose data</option>
                          {catalog?.datasets.map((dataset) => (
                            <option key={dataset.id} value={dataset.id}>{datasetLabel(dataset, catalog)}</option>
                          ))}
                        </select>
                      </label>
                    </section>

                    {selectedDataset && selectedWidget.visualType !== 'text' && (
                      <>
                        <section className="inspector-section calculation-library">
                          <div className="inspector-section-title">
                            <div>
                              <h3>Reusable calculations</h3>
                              <small>Save this calculation and its row rules for another visual.</small>
                            </div>
                          </div>
                          {(draft.calculations?.length ?? 0) > 0 && (
                            <div className="calculation-apply-row">
                              <select
                                aria-label="Saved calculation"
                                value={selectedCalculationId}
                                onChange={(event) => setSelectedCalculationId(event.target.value)}
                              >
                                <option value="">Choose a saved calculation</option>
                                {draft.calculations?.map((calculation) => (
                                  <option value={calculation.id} key={calculation.id}>
                                    {calculation.name}
                                    {' · '}
                                    {catalog?.datasets.find((dataset) =>
                                      dataset.id === calculation.datasetId)?.name ?? 'Missing worksheet'}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                disabled={!selectedCalculationId}
                                onClick={() => applyCalculation(selectedCalculationId)}
                              >
                                Apply
                              </button>
                              <button
                                type="button"
                                className="calculation-delete"
                                disabled={!selectedCalculationId}
                                aria-label="Delete saved calculation"
                                title="Delete saved calculation"
                                onClick={() => deleteCalculation(selectedCalculationId)}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          )}
                          <div className="calculation-save-row">
                            <input
                              value={calculationName}
                              placeholder="Name this calculation"
                              aria-label="Calculation name"
                              onChange={(event) => setCalculationName(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') saveCalculation()
                              }}
                            />
                            <button
                              type="button"
                              disabled={!calculationName.trim()}
                              onClick={saveCalculation}
                            >
                              <Plus size={13} /> {calculationNameExists ? 'Update' : 'Save'}
                            </button>
                          </div>
                        </section>
                        <section className="inspector-section field-role-section">
                          <div className="inspector-section-title">
                            <div>
                              <h3>Chart fields</h3>
                              <small>Drag columns from Data or choose them here.</small>
                            </div>
                          </div>
                          {selectedWidget.visualType === 'table' ? (
                            <FieldRoleWell
                              label="Columns"
                              hint="Shown from left to right"
                              dataset={selectedDataset}
                              fieldIds={selectedWidget.query.tableFieldIds}
                              multiple
                              onAssign={(datasetId, fieldId) => assignFieldRole('table', datasetId, fieldId)}
                              onRemove={(fieldId) => removeFieldRole('table', fieldId)}
                            />
                          ) : (
                            <>
                              {!['kpi', 'splitKpi', 'progress', 'gauge'].includes(selectedWidget.visualType) && (
                                <FieldRoleWell
                                  label={selectedWidget.visualType === 'scatter' ? 'Point label' : 'Category / X-axis'}
                                  hint="How values are grouped"
                                  dataset={selectedDataset}
                                  fieldIds={selectedWidget.query.groupByFieldId ? [selectedWidget.query.groupByFieldId] : []}
                                  onAssign={(datasetId, fieldId) => assignFieldRole('category', datasetId, fieldId)}
                                  onRemove={(fieldId) => removeFieldRole('category', fieldId)}
                                />
                              )}
                              <FieldRoleWell
                                label={selectedWidget.visualType === 'scatter' ? 'X-axis value' : 'Value'}
                                hint={selectedWidget.query.aggregation === 'countRows'
                                  ? 'Drop a column to count or summarize it'
                                  : 'Primary calculation'}
                                dataset={selectedDataset}
                                fieldIds={selectedWidget.query.measureFieldId ? [selectedWidget.query.measureFieldId] : []}
                                onAssign={(datasetId, fieldId) => assignFieldRole('measure', datasetId, fieldId)}
                                onRemove={(fieldId) => removeFieldRole('measure', fieldId)}
                              />
                              {visualSupportsSeries(selectedWidget.visualType) && (
                                <FieldRoleWell
                                  label="Series / color"
                                  hint="Optional comparison groups"
                                  dataset={selectedDataset}
                                  fieldIds={selectedWidget.query.seriesFieldId ? [selectedWidget.query.seriesFieldId] : []}
                                  onAssign={(datasetId, fieldId) => assignFieldRole('series', datasetId, fieldId)}
                                  onRemove={(fieldId) => removeFieldRole('series', fieldId)}
                                />
                              )}
                              {['combo', 'scatter', 'kpi', 'splitKpi'].includes(selectedWidget.visualType) && (
                                <FieldRoleWell
                                  label={selectedWidget.visualType === 'scatter'
                                    ? 'Y-axis value'
                                    : selectedWidget.visualType === 'combo'
                                      ? 'Secondary-axis line'
                                      : 'Comparison value'}
                                  hint="Optional second calculation"
                                  dataset={selectedDataset}
                                  fieldIds={selectedWidget.query.secondaryMeasureFieldId
                                    ? [selectedWidget.query.secondaryMeasureFieldId]
                                    : []}
                                  onAssign={(datasetId, fieldId) => assignFieldRole('secondary', datasetId, fieldId)}
                                  onRemove={(fieldId) => removeFieldRole('secondary', fieldId)}
                                />
                              )}
                            </>
                          )}
                        </section>
                        <section className="inspector-section">
                          <h3>Calculate</h3>
                          <label className="studio-field">
                            <span>Summarize</span>
                            <select
                              value={selectedWidget.query.aggregation}
                              onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                                ...widget,
                                query: {
                                  ...widget.query,
                                  aggregation: event.target.value as typeof widget.query.aggregation,
                                },
                              }))}
                            >
                              {AGGREGATIONS.map((aggregation) => (
                                <option value={aggregation.value} key={aggregation.value}>{aggregation.label}</option>
                              ))}
                            </select>
                          </label>
                          {selectedWidget.query.aggregation !== 'countRows' && (
                            <FieldSelect
                              label="Column"
                              value={selectedWidget.query.measureFieldId}
                              fields={selectedDataset.fields}
                              allowNone={false}
                              onChange={(value) => updateWidget(selectedWidget.id, (widget) => ({
                                ...widget,
                                query: { ...widget.query, measureFieldId: value },
                              }))}
                            />
                          )}
                          <label className="studio-field">
                            <span>Show values as</span>
                            <select
                              value={selectedWidget.query.resultTransform ?? 'none'}
                              onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                                ...widget,
                                query: {
                                  ...widget.query,
                                  resultTransform: event.target.value as typeof widget.query.resultTransform,
                                },
                                appearance: event.target.value === 'percentOfTotal'
                                  ? { ...widget.appearance, valueFormat: 'percent' }
                                  : widget.appearance,
                              }))}
                            >
                              <option value="none">Calculated value</option>
                              <option value="percentOfTotal">Percent of total</option>
                              <option value="runningTotal">Running total</option>
                            </select>
                          </label>
                          {!['kpi', 'progress', 'gauge', 'table'].includes(selectedWidget.visualType) && (
                            <>
                              <FieldSelect
                                label="Group by"
                                value={selectedWidget.query.groupByFieldId}
                                fields={selectedDataset.fields}
                                onChange={(value) => updateWidget(selectedWidget.id, (widget) => ({
                                  ...widget,
                                  query: { ...widget.query, groupByFieldId: value },
                                }))}
                              />
                              {visualSupportsSeries(selectedWidget.visualType) && (
                                <FieldSelect
                                  label="Split into series"
                                  value={selectedWidget.query.seriesFieldId}
                                  fields={selectedDataset.fields}
                                  onChange={(value) => updateWidget(selectedWidget.id, (widget) => ({
                                    ...widget,
                                    query: { ...widget.query, seriesFieldId: value },
                                  }))}
                                />
                              )}
                            </>
                          )}
                          {['combo', 'scatter', 'kpi', 'splitKpi'].includes(selectedWidget.visualType) && (
                            <div className="secondary-measure">
                              <div className="secondary-measure-head">
                                <strong>
                                  {selectedWidget.visualType === 'scatter'
                                    ? 'Y-axis measure'
                                    : selectedWidget.visualType === 'combo'
                                      ? 'Secondary-axis line'
                                      : 'Second calculation'}
                                </strong>
                                <label className="studio-switch">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(selectedWidget.query.secondaryAggregation)}
                                    onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                                      ...widget,
                                      query: {
                                        ...widget.query,
                                        secondaryAggregation: event.target.checked ? 'countRows' : null,
                                        secondaryMeasureFieldId: null,
                                        metricCalculation: event.target.checked && widget.visualType === 'kpi'
                                          ? 'ratioPercent'
                                          : 'none',
                                        secondaryRuleMode: 'same',
                                        secondaryMatch: 'all',
                                        secondaryConditions: [],
                                      },
                                      appearance: event.target.checked && widget.visualType === 'kpi'
                                        ? { ...widget.appearance, valueFormat: 'percent' }
                                        : widget.appearance,
                                    }))}
                                  />
                                  <span />
                                </label>
                              </div>
                              {selectedWidget.query.secondaryAggregation && (
                                <>
                                  <label className="studio-field">
                                    <span>Summarize</span>
                                    <select
                                      value={selectedWidget.query.secondaryAggregation}
                                      onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                                        ...widget,
                                        query: {
                                          ...widget.query,
                                          secondaryAggregation: event.target.value as typeof widget.query.aggregation,
                                        },
                                      }))}
                                    >
                                      {AGGREGATIONS.map((aggregation) => (
                                        <option value={aggregation.value} key={aggregation.value}>{aggregation.label}</option>
                                      ))}
                                    </select>
                                  </label>
                                  {selectedWidget.query.secondaryAggregation !== 'countRows' && (
                                    <FieldSelect
                                      label={selectedWidget.visualType === 'combo' ? 'Line column' : 'Column'}
                                      value={selectedWidget.query.secondaryMeasureFieldId}
                                      fields={selectedDataset.fields}
                                      allowNone={false}
                                      onChange={(value) => updateWidget(selectedWidget.id, (widget) => ({
                                        ...widget,
                                        query: { ...widget.query, secondaryMeasureFieldId: value },
                                      }))}
                                    />
                                  )}
                                  {selectedWidget.visualType === 'kpi' && (
                                    <label className="studio-field">
                                      <span>Show</span>
                                      <select
                                        value={selectedWidget.query.metricCalculation ?? 'ratioPercent'}
                                        onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                                          ...widget,
                                          query: {
                                            ...widget.query,
                                            metricCalculation: event.target.value as 'ratioPercent' | 'difference',
                                          },
                                          appearance: event.target.value === 'ratioPercent'
                                            ? { ...widget.appearance, valueFormat: 'percent' }
                                            : widget.appearance,
                                        }))}
                                      >
                                        <option value="ratioPercent">First as % of second</option>
                                        <option value="difference">First minus second</option>
                                      </select>
                                    </label>
                                  )}
                                  <label className="check-setting secondary-rules-toggle">
                                    <input
                                      type="checkbox"
                                      checked={(selectedWidget.query.secondaryRuleMode ?? 'same') === 'custom'}
                                      onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                                        ...widget,
                                        query: {
                                          ...widget.query,
                                          secondaryRuleMode: event.target.checked ? 'custom' : 'same',
                                        },
                                      }))}
                                    />
                                    <span>Use different rows for this calculation</span>
                                  </label>
                                  {(selectedWidget.query.secondaryRuleMode ?? 'same') === 'custom' && (
                                    <RuleBuilder
                                      title="Second calculation rules"
                                      fields={selectedDataset.fields}
                                      conditions={selectedWidget.query.secondaryConditions ?? []}
                                      match={selectedWidget.query.secondaryMatch ?? 'all'}
                                      onAdd={() => addCondition('secondary')}
                                      onMatchChange={(match) => updateWidget(selectedWidget.id, (widget) => ({
                                        ...widget,
                                        query: { ...widget.query, secondaryMatch: match },
                                      }))}
                                      onUpdate={(id, updates) => updateCondition(id, updates, 'secondary')}
                                      onRemove={(id) => removeCondition(id, 'secondary')}
                                    />
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </section>

                        {selectedWidget.visualType === 'table' && (
                          <section className="inspector-section">
                            <h3>Table columns</h3>
                            <div className="table-field-picker">
                              {selectedDataset.fields.map((field) => {
                                const checked = selectedWidget.query.tableFieldIds.includes(field.id)
                                return (
                                  <label key={field.id}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => updateWidget(selectedWidget.id, (widget) => ({
                                        ...widget,
                                        query: {
                                          ...widget.query,
                                          tableFieldIds: checked
                                            ? widget.query.tableFieldIds.filter((id) => id !== field.id)
                                            : [...widget.query.tableFieldIds, field.id],
                                        },
                                      }))}
                                    />
                                    <span>{field.name}</span>
                                  </label>
                                )
                              })}
                            </div>
                          </section>
                        )}

                        <RuleBuilder
                          title="Rules"
                          fields={selectedDataset.fields}
                          conditions={selectedWidget.query.conditions}
                          match={selectedWidget.query.match}
                          onAdd={() => addCondition()}
                          onMatchChange={(match) => updateWidget(selectedWidget.id, (widget) => ({
                            ...widget,
                            query: { ...widget.query, match },
                          }))}
                          onUpdate={(id, updates) => updateCondition(id, updates)}
                          onRemove={(id) => removeCondition(id)}
                        />
                        <section className="inspector-section rule-diagnostics-section">
                          <div className="query-diagnostics">
                            <span><Check size={13} /> {queryPreview?.result.diagnostics.matchedRows.toLocaleString() ?? 0} included</span>
                            <span>{queryPreview?.result.diagnostics.excludedRows.toLocaleString() ?? 0} excluded</span>
                            {(queryPreview?.result.diagnostics.totalCoercionIssues ?? 0) > 0 && (
                              <span
                                className="query-quality-warning"
                                title="Some cells could not be safely interpreted for this calculation."
                              >
                                <AlertTriangle size={13} />
                                {queryPreview?.result.diagnostics.totalCoercionIssues.toLocaleString()} data notes
                              </span>
                            )}
                            <button type="button" onClick={() => {
                              setDrillCategory(null)
                              setRowDrawerOpen(true)
                            }}>View rows</button>
                          </div>
                        </section>

                        {!['kpi', 'splitKpi', 'progress', 'gauge'].includes(selectedWidget.visualType) && (
                          <section className={`inspector-section compact-grid ${selectedWidget.visualType === 'table' ? 'single-column' : ''}`}>
                            <label className="studio-field">
                              <span>Sort</span>
                              <select
                                value={selectedWidget.query.sort}
                                onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                                  ...widget,
                                  query: { ...widget.query, sort: event.target.value as typeof widget.query.sort },
                                }))}
                              >
                                <option value="categoryAscending">
                                  {selectedWidget.visualType === 'table' ? 'First column A to Z' : 'Category A to Z'}
                                </option>
                                <option value="categoryDescending">
                                  {selectedWidget.visualType === 'table' ? 'First column Z to A' : 'Category Z to A'}
                                </option>
                                <option value="valueDescending">Highest value first</option>
                                <option value="valueAscending">Lowest value first</option>
                              </select>
                            </label>
                            {selectedWidget.visualType !== 'table' && (
                              <label className="studio-field">
                                <span>Maximum groups</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={10000}
                                  value={selectedWidget.query.limit}
                                  onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                                    ...widget,
                                    query: { ...widget.query, limit: Number(event.target.value) || 1 },
                                  }))}
                                />
                              </label>
                            )}
                          </section>
                        )}
                      </>
                    )}
                  </>
                )}

                {inspectorTab === 'appearance' && (
                  <>
                    <section className="inspector-section">
                      <h3>Content</h3>
                      <label className="studio-field">
                        <span>Title</span>
                        <input value={selectedWidget.title} onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({ ...widget, title: event.target.value }))} />
                      </label>
                      <label className="studio-field">
                        <span>Subtitle</span>
                        <textarea rows={2} value={selectedWidget.subtitle} onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({ ...widget, subtitle: event.target.value }))} />
                      </label>
                      {selectedWidget.visualType === 'splitKpi' && (
                        <div className="compact-grid">
                          <label className="studio-field">
                            <span>Left label</span>
                            <input
                              value={selectedWidget.appearance.primaryLabel ?? 'Overall'}
                              onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                                ...widget,
                                appearance: { ...widget.appearance, primaryLabel: event.target.value },
                              }))}
                            />
                          </label>
                          <label className="studio-field">
                            <span>Right label</span>
                            <input
                              value={selectedWidget.appearance.secondaryLabel ?? 'Current period'}
                              onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                                ...widget,
                                appearance: { ...widget.appearance, secondaryLabel: event.target.value },
                              }))}
                            />
                          </label>
                        </div>
                      )}
                    </section>
                    <section className="inspector-section">
                      <h3>Visual</h3>
                      <div className="visual-type-picker">
                        {VISUAL_CATALOG.map((item) => (
                          <button
                            type="button"
                            className={selectedWidget.visualType === item.type ? 'active' : ''}
                            key={item.type}
                            title={item.name}
                            onClick={() => updateWidget(selectedWidget.id, (widget) => {
                              const minimum = visualCatalogItem(item.type).minimumSize
                              return {
                                ...widget,
                                visualType: item.type,
                                query: queryForVisualType(widget.query, item.type),
                                layout: {
                                  ...widget.layout,
                                  w: Math.max(widget.layout.w, minimum.w),
                                  h: Math.max(widget.layout.h, minimum.h),
                                  minW: minimum.w,
                                  minH: minimum.h,
                                },
                              }
                            })}
                          >
                            {visualGlyph(item.type)}
                            <span>{item.name}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                    <section className="inspector-section">
                      <h3>Color palette</h3>
                      <div className="palette-picker">
                        {PALETTES.map((palette, index) => (
                          <button
                            type="button"
                            key={palette.join('-')}
                            className={selectedWidget.appearance.palette[0] === palette[0] ? 'active' : ''}
                            aria-label={`Color palette ${index + 1}`}
                            onClick={() => updateWidget(selectedWidget.id, (widget) => ({
                              ...widget,
                              appearance: { ...widget.appearance, palette },
                            }))}
                          >
                            {palette.map((color) => <span key={color} style={{ background: color }} />)}
                          </button>
                        ))}
                      </div>
                    </section>
                    <section className="inspector-section">
                      <h3>Display</h3>
                      <label className="check-setting">
                        <input
                          type="checkbox"
                          checked={selectedWidget.appearance.showDataLabels}
                          onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                            ...widget,
                            appearance: { ...widget.appearance, showDataLabels: event.target.checked },
                          }))}
                        />
                        <span>Show data labels</span>
                      </label>
                      <label className="check-setting">
                        <input
                          type="checkbox"
                          checked={selectedWidget.appearance.showLegend}
                          onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                            ...widget,
                            appearance: { ...widget.appearance, showLegend: event.target.checked },
                          }))}
                        />
                        <span>Show legend</span>
                      </label>
                      <label className="check-setting">
                        <input
                          type="checkbox"
                          checked={selectedWidget.appearance.smooth}
                          onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                            ...widget,
                            appearance: { ...widget.appearance, smooth: event.target.checked },
                          }))}
                        />
                        <span>Smooth lines</span>
                      </label>
                      <label className="studio-field">
                        <span>Number format</span>
                        <select
                          value={selectedWidget.appearance.valueFormat}
                          onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                            ...widget,
                            appearance: {
                              ...widget.appearance,
                              valueFormat: event.target.value as typeof widget.appearance.valueFormat,
                            },
                          }))}
                        >
                          <option value="number">Number</option>
                          <option value="percent">Percent</option>
                          <option value="currency">Currency</option>
                        </select>
                      </label>
                      {selectedWidget.appearance.valueFormat === 'currency' && (
                        <label className="studio-field">
                          <span>Currency</span>
                          <select
                            value={selectedWidget.appearance.currencyCode || 'USD'}
                            onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                              ...widget,
                              appearance: {
                                ...widget.appearance,
                                currencyCode: event.target.value,
                              },
                            }))}
                          >
                            <option value="USD">USD ($)</option>
                            <option value="CAD">CAD ($)</option>
                            <option value="EUR">EUR (€)</option>
                            <option value="GBP">GBP (£)</option>
                            <option value="AUD">AUD ($)</option>
                            <option value="JPY">JPY (¥)</option>
                          </select>
                        </label>
                      )}
                      {(selectedWidget.visualType === 'gauge' || selectedWidget.visualType === 'progress') && (
                        <label className="studio-field">
                          <span>Target</span>
                          <input
                            type="number"
                            value={selectedWidget.appearance.target ?? 100}
                            onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                              ...widget,
                              appearance: {
                                ...widget.appearance,
                                target: Number(event.target.value) || 1,
                              },
                            }))}
                          />
                        </label>
                      )}
                      {['bar', 'column', 'stackedBar', 'line', 'area', 'combo', 'scatter', 'heatmap'].includes(selectedWidget.visualType) && (
                        <>
                          <label className="studio-field">
                            <span>X-axis title</span>
                            <input
                              value={selectedWidget.appearance.xAxisTitle ?? ''}
                              placeholder="Optional"
                              onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                                ...widget,
                                appearance: { ...widget.appearance, xAxisTitle: event.target.value },
                              }))}
                            />
                          </label>
                          <label className="studio-field">
                            <span>Y-axis title</span>
                            <input
                              value={selectedWidget.appearance.yAxisTitle ?? ''}
                              placeholder="Optional"
                              onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                                ...widget,
                                appearance: { ...widget.appearance, yAxisTitle: event.target.value },
                              }))}
                            />
                          </label>
                          {selectedWidget.visualType === 'combo' && (
                            <label className="studio-field">
                              <span>Right Y-axis title</span>
                              <input
                                value={selectedWidget.appearance.secondaryYAxisTitle ?? ''}
                                placeholder="Optional"
                                onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                                  ...widget,
                                  appearance: {
                                    ...widget.appearance,
                                    secondaryYAxisTitle: event.target.value,
                                  },
                                }))}
                              />
                            </label>
                          )}
                          <label className="studio-field">
                            <span>Category label angle</span>
                            <select
                              value={selectedWidget.appearance.axisLabelRotation ?? 0}
                              onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                                ...widget,
                                appearance: {
                                  ...widget.appearance,
                                  axisLabelRotation: Number(event.target.value) as 0 | 30 | 45 | 90,
                                },
                              }))}
                            >
                              <option value={0}>Horizontal</option>
                              <option value={30}>30 degrees</option>
                              <option value={45}>45 degrees</option>
                              <option value={90}>Vertical</option>
                            </select>
                          </label>
                          <label className="check-setting">
                            <input
                              type="checkbox"
                              checked={selectedWidget.appearance.showGrid ?? true}
                              onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                                ...widget,
                                appearance: { ...widget.appearance, showGrid: event.target.checked },
                              }))}
                            />
                            <span>Show grid lines</span>
                          </label>
                          {!['scatter', 'heatmap'].includes(selectedWidget.visualType) && (
                            <div className="reference-line-settings">
                              <label className="check-setting">
                                <input
                                  type="checkbox"
                                  checked={selectedWidget.appearance.showReferenceLine ?? false}
                                  onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                                    ...widget,
                                    appearance: {
                                      ...widget.appearance,
                                      showReferenceLine: event.target.checked,
                                    },
                                  }))}
                                />
                                <span>Show target or baseline</span>
                              </label>
                              {selectedWidget.appearance.showReferenceLine && (
                                <div className="compact-grid">
                                  <label className="studio-field">
                                    <span>Value</span>
                                    <input
                                      type="number"
                                      value={selectedWidget.appearance.referenceLineValue ?? 0}
                                      onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                                        ...widget,
                                        appearance: {
                                          ...widget.appearance,
                                          referenceLineValue: Number(event.target.value) || 0,
                                        },
                                      }))}
                                    />
                                  </label>
                                  <label className="studio-field">
                                    <span>Label</span>
                                    <input
                                      value={selectedWidget.appearance.referenceLineLabel ?? 'Target'}
                                      onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                                        ...widget,
                                        appearance: {
                                          ...widget.appearance,
                                          referenceLineLabel: event.target.value,
                                        },
                                      }))}
                                    />
                                  </label>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </section>
                  </>
                )}

                {inspectorTab === 'settings' && (
                  <>
                    <section className="inspector-section">
                      <h3>Arrange</h3>
                      <button className="inspector-action" type="button" onClick={() => updateWidget(selectedWidget.id, (widget) => ({ ...widget, locked: !widget.locked }))}>
                        {selectedWidget.locked ? <Unlock size={15} /> : <Lock size={15} />}
                        {selectedWidget.locked ? 'Unlock position and size' : 'Lock position and size'}
                      </button>
                      <button className="inspector-action" type="button" onClick={() => duplicateWidget(selectedWidget.id)}>
                        <Copy size={15} /> Duplicate visual
                      </button>
                    </section>
                    <section className="inspector-section">
                      <h3>Source details</h3>
                      <dl className="source-details">
                        <div><dt>Dataset</dt><dd>{selectedDataset?.name ?? 'Not connected'}</dd></div>
                        <div><dt>Rows</dt><dd>{selectedDataset?.rowCount.toLocaleString() ?? '—'}</dd></div>
                        <div><dt>Included</dt><dd>{queryPreview?.result.diagnostics.matchedRows.toLocaleString() ?? '—'}</dd></div>
                        <div><dt>Coercion notes</dt><dd>{queryPreview?.result.diagnostics.totalCoercionIssues.toLocaleString() ?? '—'}</dd></div>
                      </dl>
                    </section>
                    <section className="inspector-section danger-zone">
                      <button type="button" onClick={() => deleteWidget(selectedWidget.id)}><Trash2 size={15} /> Delete visual</button>
                    </section>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="studio-inspector-body">
              <section className="inspector-section">
                <h3>Dashboard</h3>
                <label className="studio-field">
                  <span>Name</span>
                  <input value={draft.name} onChange={(event) => commit({ ...draft, name: event.target.value })} />
                </label>
                <label className="studio-field">
                  <span>Description</span>
                  <textarea rows={4} value={draft.description} onChange={(event) => commit({ ...draft, description: event.target.value })} />
                </label>
              </section>
              <section className="inspector-section">
                <h3>At a glance</h3>
                <dl className="source-details">
                  <div><dt>Pages</dt><dd>{draft.pages.length}</dd></div>
                  <div><dt>Visuals</dt><dd>{draft.pages.reduce((sum, page) => sum + page.widgets.length, 0)}</dd></div>
                  <div><dt>Data sources</dt><dd>{catalog?.workbooks.length ?? 0}</dd></div>
                </dl>
              </section>
              <section className="inspector-tip">
                <GripVertical size={17} />
                <p>Select a visual to edit its data sentence, style, and layout settings.</p>
              </section>
            </div>
          )}
        </aside>
      )}
      {activeExportProfile && (
        <DashboardExportStage
          dashboard={activeExportDashboard ?? draft}
          project={project}
          catalog={catalog}
          profile={activeExportProfile}
          onReady={() => void finishExport()}
          onError={failExport}
        />
      )}
      {exportMessage && (
        <div className="exporting-toast">
          {exportMessage.kind === 'progress'
            ? <RefreshCw className="spin" size={15} />
            : exportMessage.kind === 'error'
              ? <AlertTriangle size={15} />
              : <Check size={15} />}
          {exportMessage.text}
        </div>
      )}
      {exportPreflight && (
        <div
          className="studio-row-drawer-backdrop export-preflight-backdrop"
          role="presentation"
          onMouseDown={closeExportPreflight}
        >
          <section
            ref={preflightRef}
            className="export-preflight-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Export preflight"
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <span className={exportPreflight.status}>
                {exportPreflight.status === 'blocked'
                  ? <AlertTriangle size={19} />
                  : <ClipboardCheck size={19} />}
              </span>
              <div>
                <small>Export check</small>
                <strong>
                  {exportPreflight.status === 'blocked'
                    ? 'Fix these items before exporting'
                    : 'Ready with a few notes'}
                </strong>
                <p>
                  {exportPreflight.pageCount.toLocaleString()} export page{exportPreflight.pageCount === 1 ? '' : 's'}
                  {' · '}
                  {exportPreflight.blockers.length} blockers
                  {' · '}
                  {exportPreflight.warnings.length} warnings
                </p>
              </div>
              <button type="button" aria-label="Close export check" onClick={closeExportPreflight}>
                <X size={16} />
              </button>
            </header>
            <div className="export-preflight-list">
              {[...exportPreflight.blockers, ...exportPreflight.warnings].map((issue) => (
                <article className={issue.severity} key={issue.id}>
                  <span>{issue.severity === 'blocker'
                    ? <AlertTriangle size={15} />
                    : <CircleHelp size={15} />}</span>
                  <div>
                    <strong>{issue.title}</strong>
                    <p>{issue.detail}</p>
                  </div>
                  {(issue.pageId || issue.widgetId) && (
                    <button type="button" onClick={() => locatePreflightIssue(issue)}>
                      Open
                    </button>
                  )}
                </article>
              ))}
            </div>
            <footer>
              <button type="button" onClick={closeExportPreflight}>Cancel</button>
              {exportPreflight.blockers.length === 0
                && pendingExportProfile
                && pendingExportDashboard && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => beginExport(pendingExportProfile, pendingExportDashboard)}
                >
                  <Download size={14} /> Export anyway
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
      <SourceRepairCenter
        open={sourceRepairOpen}
        catalog={catalog}
        repairs={project.sourceRepairs ?? emptySourceRepairs()}
        onChange={onSourceRepairsChange}
        onClose={() => setSourceRepairOpen(false)}
      />
      {previewDataset && !rowDrawerOpen && (
        <div className="studio-row-drawer-backdrop" role="presentation" onMouseDown={() => setPreviewDatasetId(null)}>
          <aside
            ref={rowDrawerRef}
            className="studio-row-drawer source-preview-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`Preview ${previewDataset.name}`}
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>Spreadsheet preview</span>
                <strong>{previewDataset.name}</strong>
                <small>
                  {previewDataset.rowCount.toLocaleString()} rows · {previewDataset.fields.length.toLocaleString()} columns
                  {' · '}
                  header row {previewDataset.headerRowNumber}
                </small>
              </div>
              <button type="button" onClick={() => setPreviewDatasetId(null)} aria-label="Close preview">
                <X size={17} />
              </button>
            </header>
            <div className="studio-row-drawer-table">
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    {previewDataset.fields.slice(0, 20).map((field) => {
                      const selected = quickSelection.datasetId === previewDataset.id
                        && quickSelection.fieldIds.includes(field.id)
                      return (
                        <th key={field.id}>
                          <button
                            type="button"
                            aria-pressed={selected}
                            onClick={() => toggleQuickField(previewDataset.id, field.id)}
                          >
                            {selected && <Check size={12} />}
                            {field.name}
                          </button>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {previewDataset.rows.slice(0, 50).map((row, rowIndex) => (
                    <tr key={row.sourceRowNumber ?? rowIndex}>
                      <td>{row.sourceRowNumber ?? rowIndex + 1}</td>
                      {previewDataset.fields.slice(0, 20).map((field) => (
                        <td key={field.id}>{displayCell(row.cells[field.id]?.raw ?? null)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer>
              Showing {Math.min(50, previewDataset.rowCount).toLocaleString()} of {previewDataset.rowCount.toLocaleString()} rows
            </footer>
          </aside>
        </div>
      )}
      {rowDrawerOpen && selectedWidget && selectedDataset && queryPreview && (
        <div className="studio-row-drawer-backdrop" role="presentation" onMouseDown={() => setRowDrawerOpen(false)}>
          <aside
            ref={rowDrawerRef}
            className="studio-row-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Rows behind this visual"
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>Rows behind this visual</span>
                <strong>{selectedWidget.title}</strong>
                <small>
                  {drillRowIndices.length.toLocaleString()} included rows
                  {drillCategory ? ` for ${drillCategory}` : ''} from {selectedDataset.name}
                </small>
              </div>
              <button type="button" onClick={() => setRowDrawerOpen(false)} aria-label="Close rows"><X size={17} /></button>
            </header>
            <div className="studio-row-drawer-table">
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    {selectedDataset.fields.slice(0, 10).map((field) => <th key={field.id}>{field.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {drillRowIndices.slice(0, 500).map((rowIndex) => {
                    const row = selectedDataset.rows[rowIndex]
                    return (
                      <tr key={row?.sourceRowNumber ?? rowIndex}>
                        <td>{row?.sourceRowNumber ?? rowIndex + 1}</td>
                        {selectedDataset.fields.slice(0, 10).map((field) => (
                          <td key={field.id}>{displayCell(row?.cells[field.id]?.raw ?? null)}</td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {drillRowIndices.length > 500 && (
              <footer>Showing the first 500 matching rows.</footer>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
