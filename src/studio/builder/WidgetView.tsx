import { AlertTriangle, Database, GripVertical, Lock, MoreHorizontal } from 'lucide-react'
import { useMemo } from 'react'
import type { DatasetProfile } from '../data'
import type { DashboardFilterRecord, StudioWidgetRecord } from '../library/model'
import EChart from '../renderers/EChart'
import { buildChartOption } from '../renderers/chartOptions'
import {
  dashboardFilterConditions,
  displayCell,
  runStudioQuery,
  sentenceForQuery,
} from './queryAdapter'

interface WidgetViewProps {
  widget: StudioWidgetRecord
  dataset?: DatasetProfile
  selected: boolean
  editable: boolean
  dashboardFilters?: DashboardFilterRecord[]
  pageId?: string
  showQueryContext?: boolean
  tableRowStart?: number
  tableRowLimit?: number | null
  onPointClick?: (category: string) => void
  onSelect: () => void
  onMenu: () => void
}

function formatMetric(value: number, widget: StudioWidgetRecord): string {
  if (!Number.isFinite(value)) return '—'
  if (widget.appearance.valueFormat === 'percent') {
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
  }
  if (widget.appearance.valueFormat === 'currency') {
    return value.toLocaleString(undefined, {
      style: 'currency',
      currency: widget.appearance.currencyCode || 'USD',
      maximumFractionDigits: 0,
    })
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function compareTableValues(left: unknown, right: unknown): number {
  if (left === right) return 0
  if (left === null || left === undefined || left === '') return 1
  if (right === null || right === undefined || right === '') return -1
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime()
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

export default function WidgetView({
  widget,
  dataset,
  selected,
  editable,
  dashboardFilters = [],
  pageId,
  showQueryContext,
  tableRowStart = 0,
  tableRowLimit = 50,
  onPointClick,
  onSelect,
  onMenu,
}: WidgetViewProps) {
  const dashboardConditions = useMemo(
    () => dataset ? dashboardFilterConditions(dashboardFilters, dataset, pageId) : [],
    [dashboardFilters, dataset, pageId],
  )
  const output = useMemo(() => {
    if (!dataset || widget.visualType === 'text') return null
    try {
      const query = widget.visualType === 'combo' && widget.query.seriesFieldId
        ? { ...widget.query, seriesFieldId: null }
        : widget.query
      return { value: runStudioQuery(query, dataset, dashboardConditions), error: null }
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : 'This visual could not be calculated.',
      }
    }
  }, [dashboardConditions, dataset, widget.query, widget.visualType])

  const firstPoint = output?.value?.points.find((point) => point.series !== 'Secondary')
  const metric = firstPoint?.value ?? 0
  const primaryMetric = firstPoint?.primaryValue ?? firstPoint?.value ?? 0
  const secondaryMetric = firstPoint?.secondaryValue
    ?? output?.value?.points.find((point) => point.series === 'Secondary')?.value
    ?? 0
  const target = widget.appearance.target ?? 100
  const showContext = showQueryContext ?? editable
  const sentence = sentenceForQuery(widget.query, dataset)
  const chartPoints = (widget.visualType === 'scatter'
    ? (output?.value?.points ?? []).filter((point) => point.series !== 'Secondary')
    : output?.value?.points ?? []).map((point) => {
      if (widget.query.seriesFieldId) return point
      if (point.series === 'Secondary') {
        return { ...point, series: widget.appearance.secondaryLabel || 'Secondary' }
      }
      return { ...point, series: widget.appearance.primaryLabel || 'Value' }
    })
  const noMatchingRows = Boolean(dataset && output?.value
    && output.value.result.diagnostics.matchedRows === 0)
  const tableFields = useMemo(() => dataset
    ? widget.query.tableFieldIds
      .map((fieldId) => dataset.fields.find((field) => field.id === fieldId))
      .filter((field): field is DatasetProfile['fields'][number] => Boolean(field))
    : [], [dataset, widget.query.tableFieldIds])
  const supportsPointInteraction = Boolean(
    onPointClick
    && widget.query.groupByFieldId
    && !['gauge', 'radar'].includes(widget.visualType),
  )
  const tableRowIndices = useMemo(() => {
    const indices = [...(output?.value?.result.diagnostics.matchedRowIndices ?? [])]
    if (!dataset || widget.visualType !== 'table' || indices.length < 2) return indices
    const categoryField = tableFields[0]
    const numericField = dataset.fields.find((field) =>
      field.id === widget.query.measureFieldId && field.inferredType === 'number')
      ?? tableFields.find((field) => field.inferredType === 'number')
      ?? categoryField
    const sortField = widget.query.sort.startsWith('value') ? numericField : categoryField
    if (!sortField) return indices
    const direction = widget.query.sort.endsWith('Descending') ? -1 : 1
    return indices.sort((leftIndex, rightIndex) => direction * compareTableValues(
      dataset.rows[leftIndex]?.cells[sortField.id]?.raw,
      dataset.rows[rightIndex]?.cells[sortField.id]?.raw,
    ))
  }, [dataset, output?.value?.result.diagnostics.matchedRowIndices, tableFields, widget.query.measureFieldId, widget.query.sort, widget.visualType])

  return (
    <article
      className={`studio-widget ${selected ? 'selected' : ''} ${widget.locked ? 'locked' : ''}`}
      onMouseDown={onSelect}
      data-widget-id={widget.id}
    >
      <header className="studio-widget-header">
        <button
          className="widget-drag-handle"
          type="button"
          aria-label={widget.locked ? 'Widget is locked' : `Move ${widget.title}`}
          disabled={!editable || widget.locked}
        >
          {widget.locked ? <Lock size={14} /> : <GripVertical size={14} />}
        </button>
        <div className="studio-widget-titles">
          <strong>{widget.title}</strong>
          {widget.subtitle && <span>{widget.subtitle}</span>}
        </div>
        {editable && (
          <button
            type="button"
            className="widget-menu-button"
            aria-label={`More options for ${widget.title}`}
            onClick={(event) => {
              event.stopPropagation()
              onMenu()
            }}
          >
            <MoreHorizontal size={16} />
          </button>
        )}
      </header>

      <div className="studio-widget-body">
        {widget.visualType === 'text' ? (
          <div className="studio-text-widget">
            <p>{widget.subtitle || 'Add context, a heading, or a note from the inspector.'}</p>
          </div>
        ) : !dataset ? (
          <div className="studio-widget-empty">
            <Database size={20} />
            <strong>Choose a data source</strong>
            <span>Select this visual and build its data sentence.</span>
          </div>
        ) : output?.error ? (
          <div className="studio-widget-error">
            <AlertTriangle size={20} />
            <strong>Check this visual</strong>
            <span>{output.error}</span>
          </div>
        ) : widget.visualType === 'table' && tableFields.length === 0 ? (
          <div className="studio-widget-empty">
            <Database size={20} />
            <strong>Add table columns</strong>
            <span>Drop or choose the columns this table should show.</span>
          </div>
        ) : noMatchingRows && !['kpi', 'splitKpi', 'progress', 'gauge'].includes(widget.visualType) ? (
          <div className="studio-widget-empty">
            <Database size={20} />
            <strong>No rows match</strong>
            <span>Adjust this visual's rules or the dashboard filters.</span>
          </div>
        ) : widget.visualType === 'kpi' ? (
          <div className="studio-kpi">
            <strong>{formatMetric(metric, widget)}</strong>
            {showContext && <span>{sentence}</span>}
          </div>
        ) : widget.visualType === 'splitKpi' ? (
          <div className="studio-split-kpi">
            <div>
              <span>{widget.appearance.primaryLabel || 'Overall'}</span>
              <strong>{formatMetric(primaryMetric, widget)}</strong>
            </div>
            <div>
              <span>{widget.appearance.secondaryLabel || 'Current period'}</span>
              <strong>{formatMetric(secondaryMetric, widget)}</strong>
            </div>
            {showContext && <small>{sentence}</small>}
          </div>
        ) : widget.visualType === 'progress' ? (
          <div className="studio-progress">
            <div>
              <strong>{formatMetric(metric, widget)}</strong>
              <span>of {formatMetric(target, widget)}</span>
            </div>
            <div className="studio-progress-track">
              <span style={{ width: `${Math.min(100, Math.max(0, metric / Math.max(1, target) * 100))}%` }} />
            </div>
            {showContext && <small>{sentence}</small>}
          </div>
        ) : widget.visualType === 'table' ? (
          <div className="studio-table-wrap">
            <table>
              <thead>
                <tr>
                  {tableFields.map((field) => <th key={field.id}>{field.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {tableRowIndices
                  .slice(
                    tableRowStart,
                    tableRowLimit === null ? undefined : tableRowStart + tableRowLimit,
                  )
                  .map((rowIndex) => {
                    const row = dataset.rows[rowIndex]
                    return (
                      <tr key={row?.sourceRowNumber ?? rowIndex}>
                        {tableFields.map((field) => (
                          <td key={field.id}>{displayCell(row?.cells[field.id]?.raw ?? null)}</td>
                        ))}
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        ) : (
          <EChart
            option={buildChartOption(widget.visualType, chartPoints, {
              title: widget.title,
              showLegend: widget.appearance.showLegend,
              showLabels: widget.appearance.showDataLabels,
              smooth: widget.appearance.smooth,
              primaryColor: widget.appearance.palette[0],
              secondaryColor: widget.appearance.palette[1],
              palette: widget.appearance.palette,
              secondarySeriesName: widget.appearance.secondaryLabel || 'Secondary',
              valueFormat: widget.appearance.valueFormat,
              currencyCode: widget.appearance.currencyCode,
              target,
              xAxisTitle: widget.appearance.xAxisTitle,
              yAxisTitle: widget.appearance.yAxisTitle,
              secondaryYAxisTitle: widget.appearance.secondaryYAxisTitle,
              axisLabelRotation: widget.appearance.axisLabelRotation,
              showGrid: widget.appearance.showGrid,
              showReferenceLine: widget.appearance.showReferenceLine,
              referenceLineValue: widget.appearance.referenceLineValue,
              referenceLineLabel: widget.appearance.referenceLineLabel,
              referenceLineColor: widget.appearance.referenceLineColor,
            })}
            ariaLabel={`${widget.title}. ${sentence}`}
            onPointClick={supportsPointInteraction
              ? (category, dataIndex) => {
                  onPointClick?.(category || chartPoints[dataIndex]?.category || '')
                }
              : undefined}
          />
        )}
      </div>
    </article>
  )
}
