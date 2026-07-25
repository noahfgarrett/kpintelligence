import {
  AlertTriangle,
  ArrowDownAZ,
  ArrowLeft,
  ArrowRight,
  AreaChart,
  BarChart3,
  ChartNoAxesColumnIncreasing,
  Check,
  ChevronDown,
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
  Rows3,
  Search,
  Settings2,
  ScatterChart,
  SlidersHorizontal,
  Sparkles,
  Radar,
  Table2,
  Text as TextIcon,
  Trash2,
  Undo2,
  Unlock,
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
import type { DatasetProfile, SpreadsheetCatalogProfile } from '../data'
import {
  createId,
  createWidget,
  type DashboardRecord,
  type ExportProfileRecord,
  type ProjectRecord,
  type StudioCondition,
  type StudioWidgetQuery,
  type StudioWidgetRecord,
} from '../library/model'
import { VISUAL_CATALOG, visualCatalogItem, type StudioVisualType } from '../renderers/catalog'
import DashboardExportStage from '../export/DashboardExportStage'
import { exportRenderedDashboard } from '../export/customDashboard'
import {
  dashboardFilterConditions,
  displayCell,
  runStudioQuery,
  sentenceForQuery,
} from './queryAdapter'
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
  return ['column', 'bar', 'stackedBar', 'line', 'area', 'combo', 'scatter', 'heatmap'].includes(type)
}

function queryForVisualType(
  query: StudioWidgetQuery,
  type: StudioVisualType,
): StudioWidgetQuery {
  const supportsGrouping = !['kpi', 'progress', 'gauge', 'table', 'text'].includes(type)
  const supportsSecondary = type === 'combo' || type === 'scatter'
  return {
    ...query,
    groupByFieldId: supportsGrouping ? query.groupByFieldId : null,
    seriesFieldId: visualSupportsSeries(type) ? query.seriesFieldId : null,
    secondaryAggregation: supportsSecondary
      ? query.secondaryAggregation ?? 'countRows'
      : null,
    secondaryMeasureFieldId: supportsSecondary ? query.secondaryMeasureFieldId : null,
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
  const [pageMenuOpen, setPageMenuOpen] = useState(false)
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [filterDatasetId, setFilterDatasetId] = useState('')
  const [filterFieldId, setFilterFieldId] = useState('')
  const [widgetMenuId, setWidgetMenuId] = useState<string | null>(null)
  const [activeExportProfile, setActiveExportProfile] = useState<ExportProfileRecord | null>(null)
  const [exportMessage, setExportMessage] = useState<{
    text: string
    kind: 'progress' | 'success' | 'error'
  } | null>(null)
  const [rowDrawerOpen, setRowDrawerOpen] = useState(false)
  const [drillCategory, setDrillCategory] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const rowDrawerRef = useRef<HTMLElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 1120 })
  useModalFocus(rowDrawerOpen, rowDrawerRef, () => setRowDrawerOpen(false))

  const activePage = draft.pages.find((page) => page.id === activePageId) ?? draft.pages[0]
  const selectedWidget = activePage?.widgets.find((widget) => widget.id === selectedWidgetId) ?? null
  const selectedDataset = catalog?.datasets.find((dataset) => dataset.id === selectedWidget?.query.datasetId)
  const filterDataset = catalog?.datasets.find((dataset) => dataset.id === filterDatasetId)
    ?? catalog?.datasets[0]
  const filterField = filterDataset?.fields.find((field) => field.id === filterFieldId)
    ?? filterDataset?.fields[0]
  const filterValueMap = useMemo(() => {
    const values = new Map<string, Set<string>>()
    catalog?.datasets.forEach((dataset) => {
      dataset.fields.forEach((field) => {
        const key = field.name.trim().toLowerCase()
        const fieldValues = values.get(key) ?? new Set<string>()
        if (fieldValues.size < 500) {
          dataset.rows.forEach((row) => {
            if (fieldValues.size >= 500) return
            const value = displayCell(row.cells[field.id]?.raw ?? null).trim()
            if (value) fieldValues.add(value)
          })
        }
        values.set(key, fieldValues)
      })
    })
    return values
  }, [catalog])
  const queryPreview = useMemo(() => {
    if (!selectedWidget || !selectedDataset || selectedWidget.visualType === 'text') return null
    try {
      return runStudioQuery(
        selectedWidget.query,
        selectedDataset,
        dashboardFilterConditions(draft.filters, selectedDataset),
      )
    } catch {
      return null
    }
  }, [draft.filters, selectedWidget, selectedDataset])
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
      setExportMessage({ text: 'Rendering every dashboard page…', kind: 'progress' })
      setActiveExportProfile(exportProfile)
    }
    window.addEventListener('kpintelligence:export-dashboard', listener)
    return () => window.removeEventListener('kpintelligence:export-dashboard', listener)
  }, [exportProfile])

  useEffect(() => {
    if (!activePage && draft.pages[0]) setActivePageId(draft.pages[0].id)
  }, [activePage, draft.pages])

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
      if (!['kpi', 'progress', 'gauge', 'text', 'table'].includes(type)) {
        widget.query.groupByFieldId = catalog.datasets[0].fields[0]?.id ?? null
      }
    }
    widget.title = visualCatalogItem(type).name
    updateCurrentPage((page) => ({ ...page, widgets: [...page.widgets, widget] }))
    setSelectedWidgetId(widget.id)
    setInspectorOpen(true)
    setInspectorTab('data')
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

  function addCondition(): void {
    if (!selectedWidget || !selectedDataset?.fields[0]) return
    updateWidget(selectedWidget.id, (widget) => ({
      ...widget,
      query: {
        ...widget.query,
        conditions: [
          ...widget.query.conditions,
          {
            id: createId('condition'),
            fieldId: selectedDataset.fields[0].id,
            operator: 'equals',
            value: '',
          },
        ],
      },
    }))
  }

  function updateCondition(id: string, updates: Partial<StudioCondition>): void {
    if (!selectedWidget) return
    updateWidget(selectedWidget.id, (widget) => ({
      ...widget,
      query: {
        ...widget.query,
        conditions: widget.query.conditions.map((condition) =>
          condition.id === id ? { ...condition, ...updates } : condition),
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
    commit({ ...draft, pages: pages.map((page, index) => ({ ...page, order: index })) })
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
          value: '',
          enabled: true,
        },
      ],
    })
    setFilterMenuOpen(false)
  }

  function filterValues(fieldName: string): string[] {
    const values = filterValueMap.get(fieldName.trim().toLowerCase()) ?? new Set<string>()
    return [...values].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }))
  }

  const filteredCatalog = VISUAL_CATALOG.filter((item) => {
    const search = paletteSearch.trim().toLowerCase()
    return !search || `${item.name} ${item.description} ${item.family}`.toLowerCase().includes(search)
  })
  const families = [...new Set(filteredCatalog.map((item) => item.family))]

  async function finishExport(): Promise<void> {
    if (!activeExportProfile) return
    try {
      setExportMessage({
        text: `Building ${activeExportProfile.format.toUpperCase()}…`,
        kind: 'progress',
      })
      const generated = await exportRenderedDashboard(draft, activeExportProfile)
      await platform.saveFile(generated.data, generated.fileName, generated.filters)
      setExportMessage({ text: `${generated.fileName} saved`, kind: 'success' })
      window.setTimeout(() => setExportMessage(null), 3500)
    } catch (error) {
      setExportMessage({
        text: error instanceof Error ? error.message : 'The dashboard could not be exported.',
        kind: 'error',
      })
      window.setTimeout(() => setExportMessage(null), 7000)
    } finally {
      setActiveExportProfile(null)
    }
  }

  function failExport(message: string): void {
    setActiveExportProfile(null)
    setExportMessage({ text: message, kind: 'error' })
    window.setTimeout(() => setExportMessage(null), 7000)
  }

  return (
    <div className={`dashboard-studio ${preview ? 'preview-mode' : ''} ${inspectorOpen ? '' : 'inspector-collapsed'}`}>
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
          <button className={leftTab === 'visuals' ? 'active' : ''} type="button" onClick={() => setLeftTab('visuals')}>
            <BarChart3 size={15} /> Visuals
          </button>
          <button className={leftTab === 'data' ? 'active' : ''} type="button" onClick={() => setLeftTab('data')}>
            <Database size={15} /> Data
          </button>
        </div>

        {leftTab === 'visuals' ? (
          <div className="studio-palette-body">
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
          <div className="studio-palette-body data-palette">
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
            {catalog?.datasets.map((dataset) => (
              <details className="studio-dataset" key={dataset.id} open={catalog.datasets.length === 1}>
                <summary>
                  <span><Database size={15} /></span>
                  <div>
                    <strong>{dataset.name}</strong>
                    <small>{dataset.rowCount.toLocaleString()} rows · {dataset.fields.length} columns</small>
                  </div>
                  <ChevronDown size={14} />
                </summary>
                <div className="studio-field-list">
                  {dataset.fields.map((field) => (
                    <button
                      type="button"
                      key={field.id}
                      onClick={() => {
                        if (!selectedWidget) return
                        updateWidget(selectedWidget.id, (widget) => ({
                          ...widget,
                          query: {
                            ...widget.query,
                            datasetId: dataset.id,
                            ...(field.inferredType === 'number'
                              ? { aggregation: 'sum', measureFieldId: field.id }
                              : { groupByFieldId: field.id }),
                          },
                        }))
                      }}
                    >
                      <span>{field.inferredType === 'number' ? '#' : field.inferredType === 'date' ? 'D' : 'A'}</span>
                      <strong>{field.name}</strong>
                      <small>{field.inferredType}</small>
                    </button>
                  ))}
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

        {draft.filters.length > 0 && (
          <div className="studio-global-filters">
            <span className="global-filter-label"><SlidersHorizontal size={14} /> Dashboard filters</span>
            {draft.filters.map((filter) => (
              <label className="global-filter-chip" key={filter.id}>
                <span>{filter.name}</span>
                <select
                  value={filter.value}
                  onChange={(event) => commit({
                    ...draft,
                    filters: draft.filters.map((candidate) => candidate.id === filter.id
                      ? { ...candidate, value: event.target.value, enabled: Boolean(event.target.value) }
                      : candidate),
                  })}
                >
                  <option value="">All</option>
                  {filterValues(filter.fieldName).map((value) => <option value={value} key={value}>{value}</option>)}
                </select>
                <button
                  type="button"
                  aria-label={`Remove ${filter.name} filter`}
                  onClick={() => commit({
                    ...draft,
                    filters: draft.filters.filter((candidate) => candidate.id !== filter.id),
                  })}
                >
                  <X size={12} />
                </button>
              </label>
            ))}
            <button
              className="clear-dashboard-filters"
              type="button"
              onClick={() => commit({
                ...draft,
                filters: draft.filters.map((filter) => ({ ...filter, value: '', enabled: false })),
              })}
            >
              Clear
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
                      dashboardFilters={draft.filters}
                      onSelect={() => {
                        if (preview) return
                        setSelectedWidgetId(widget.id)
                        setInspectorOpen(true)
                      }}
                      onMenu={() => setWidgetMenuId((id) => id === widget.id ? null : widget.id)}
                      onPointClick={(category) => {
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
                <button className={inspectorTab === 'data' ? 'active' : ''} type="button" onClick={() => setInspectorTab('data')}>
                  <Database size={14} /> Data
                </button>
                <button className={inspectorTab === 'appearance' ? 'active' : ''} type="button" onClick={() => setInspectorTab('appearance')}>
                  <Paintbrush size={14} /> Style
                </button>
                <button className={inspectorTab === 'settings' ? 'active' : ''} type="button" onClick={() => setInspectorTab('settings')}>
                  <Settings2 size={14} /> More
                </button>
              </div>

              <div className="studio-inspector-body">
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
                              query: {
                                ...widget.query,
                                datasetId: dataset?.id ?? null,
                                measureFieldId: null,
                                secondaryMeasureFieldId: null,
                                groupByFieldId: null,
                                seriesFieldId: null,
                                tableFieldIds: dataset?.fields.slice(0, 6).map((field) => field.id) ?? [],
                                conditions: [],
                              },
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
                          {(selectedWidget.visualType === 'combo' || selectedWidget.visualType === 'scatter') && (
                            <div className="secondary-measure">
                              <div className="secondary-measure-head">
                                <strong>{selectedWidget.visualType === 'scatter' ? 'Y-axis measure' : 'Secondary-axis line'}</strong>
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
                                      },
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
                                      label="Line column"
                                      value={selectedWidget.query.secondaryMeasureFieldId}
                                      fields={selectedDataset.fields}
                                      allowNone={false}
                                      onChange={(value) => updateWidget(selectedWidget.id, (widget) => ({
                                        ...widget,
                                        query: { ...widget.query, secondaryMeasureFieldId: value },
                                      }))}
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

                        <section className="inspector-section">
                          <div className="inspector-section-title">
                            <h3>Rules</h3>
                            <button type="button" onClick={addCondition}><Plus size={14} /> Add</button>
                          </div>
                          {selectedWidget.query.conditions.length > 1 && (
                            <div className="match-mode">
                              <span>Keep rows when</span>
                              <select
                                value={selectedWidget.query.match}
                                onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                                  ...widget,
                                  query: { ...widget.query, match: event.target.value as 'all' | 'any' },
                                }))}
                              >
                                <option value="all">all rules match</option>
                                <option value="any">any rule matches</option>
                              </select>
                            </div>
                          )}
                          {selectedWidget.query.conditions.length === 0 ? (
                            <button className="empty-rule" type="button" onClick={addCondition}>
                              <Filter size={16} />
                              Only include the rows you need
                            </button>
                          ) : (
                            <div className="condition-list">
                              {selectedWidget.query.conditions.map((condition) => {
                                const field = selectedDataset.fields.find((candidate) => candidate.id === condition.fieldId)
                                const conditionOperators = conditionOperatorsFor(field)
                                const operator = conditionOperators.find((candidate) => candidate.value === condition.operator)
                                const valueListId = `condition-values-${condition.id}`
                                const [lowerValue = '', upperValue = ''] = condition.value.split('..', 2)
                                return (
                                  <div className="condition-row" key={condition.id}>
                                    <select
                                      value={condition.fieldId}
                                      aria-label="Rule column"
                                      onChange={(event) => updateCondition(condition.id, {
                                        fieldId: event.target.value,
                                        operator: 'equals',
                                        value: '',
                                      })}
                                    >
                                      {selectedDataset.fields.map((field) => <option value={field.id} key={field.id}>{field.name}</option>)}
                                    </select>
                                    <select value={condition.operator} aria-label="Rule operator" onChange={(event) => updateCondition(condition.id, { operator: event.target.value as StudioCondition['operator'] })}>
                                      {conditionOperators.map((candidate) => <option value={candidate.value} key={candidate.value}>{candidate.label}</option>)}
                                    </select>
                                    {operator?.takesValue && condition.operator === 'between' && (
                                      <div className="condition-range">
                                        <input
                                          value={lowerValue}
                                          aria-label="Rule lower value"
                                          placeholder="From"
                                          onChange={(event) => updateCondition(condition.id, {
                                            value: `${event.target.value}..${upperValue}`,
                                          })}
                                        />
                                        <span>to</span>
                                        <input
                                          value={upperValue}
                                          aria-label="Rule upper value"
                                          placeholder="Through"
                                          onChange={(event) => updateCondition(condition.id, {
                                            value: `${lowerValue}..${event.target.value}`,
                                          })}
                                        />
                                      </div>
                                    )}
                                    {operator?.takesValue && condition.operator !== 'between' && field?.inferredType === 'boolean' ? (
                                      <select
                                        className="condition-value"
                                        value={condition.value}
                                        aria-label="Rule value"
                                        onChange={(event) => updateCondition(condition.id, { value: event.target.value })}
                                      >
                                        <option value="">Choose a value</option>
                                        <option value="true">True</option>
                                        <option value="false">False</option>
                                      </select>
                                    ) : operator?.takesValue && condition.operator !== 'between' && (
                                      <input
                                        value={condition.value}
                                        list={valueListId}
                                        type={field?.inferredType === 'number' && !['oneOf', 'notOneOf'].includes(condition.operator) ? 'number' : 'text'}
                                        aria-label="Rule value"
                                        placeholder={['oneOf', 'notOneOf'].includes(condition.operator) ? 'A, B, C' : 'Choose or enter a value'}
                                        onChange={(event) => updateCondition(condition.id, { value: event.target.value })}
                                      />
                                    )}
                                    {field && field.sampleValues.length > 0 && (
                                      <datalist id={valueListId}>
                                        {field.sampleValues.slice(0, 20).map((sample) => (
                                          <option value={sample.display} key={`${sample.display}-${sample.count}`} />
                                        ))}
                                      </datalist>
                                    )}
                                    <button
                                      type="button"
                                      aria-label="Remove rule"
                                      onClick={() => updateWidget(selectedWidget.id, (widget) => ({
                                        ...widget,
                                        query: {
                                          ...widget.query,
                                          conditions: widget.query.conditions.filter((candidate) => candidate.id !== condition.id),
                                        },
                                      }))}
                                    >
                                      <X size={14} />
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                          <div className="query-diagnostics">
                            <span><Check size={13} /> {queryPreview?.result.diagnostics.matchedRows.toLocaleString() ?? 0} included</span>
                            <span>{queryPreview?.result.diagnostics.excludedRows.toLocaleString() ?? 0} excluded</span>
                            <button type="button" onClick={() => {
                              setDrillCategory(null)
                              setRowDrawerOpen(true)
                            }}>View rows</button>
                          </div>
                        </section>

                        <section className="inspector-section compact-grid">
                          <label className="studio-field">
                            <span>Sort</span>
                            <select
                              value={selectedWidget.query.sort}
                              onChange={(event) => updateWidget(selectedWidget.id, (widget) => ({
                                ...widget,
                                query: { ...widget.query, sort: event.target.value as typeof widget.query.sort },
                              }))}
                            >
                              <option value="categoryAscending">Category A to Z</option>
                              <option value="categoryDescending">Category Z to A</option>
                              <option value="valueDescending">Highest value first</option>
                              <option value="valueAscending">Lowest value first</option>
                            </select>
                          </label>
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
                        </section>
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
                            onClick={() => updateWidget(selectedWidget.id, (widget) => ({
                              ...widget,
                              visualType: item.type,
                              query: queryForVisualType(widget.query, item.type),
                            }))}
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
          dashboard={draft}
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
