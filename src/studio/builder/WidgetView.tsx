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
  showQueryContext?: boolean
  tableRowStart?: number
  tableRowLimit?: number | null
  onPointClick?: (category: string) => void
  onSelect: () => void
  onMenu: () => void
}

function formatMetric(value: number, widget: StudioWidgetRecord): string {
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

export default function WidgetView({
  widget,
  dataset,
  selected,
  editable,
  dashboardFilters = [],
  showQueryContext,
  tableRowStart = 0,
  tableRowLimit = 50,
  onPointClick,
  onSelect,
  onMenu,
}: WidgetViewProps) {
  const dashboardConditions = useMemo(
    () => dataset ? dashboardFilterConditions(dashboardFilters, dataset) : [],
    [dashboardFilters, dataset],
  )
  const output = useMemo(() => {
    if (!dataset || widget.visualType === 'text') return null
    try {
      return { value: runStudioQuery(widget.query, dataset, dashboardConditions), error: null }
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : 'This visual could not be calculated.',
      }
    }
  }, [dashboardConditions, dataset, widget.query, widget.visualType])

  const metric = output?.value?.points[0]?.value ?? 0
  const target = widget.appearance.target ?? 100
  const showContext = showQueryContext ?? editable
  const sentence = sentenceForQuery(widget.query, dataset)
  const chartPoints = widget.visualType === 'scatter'
    ? (output?.value?.points ?? []).filter((point) => point.series !== 'Secondary')
    : output?.value?.points ?? []
  const tableFields = dataset
    ? (widget.query.tableFieldIds.length > 0
        ? widget.query.tableFieldIds
          .map((fieldId) => dataset.fields.find((field) => field.id === fieldId))
          .filter((field): field is DatasetProfile['fields'][number] => Boolean(field))
        : dataset.fields.slice(0, 6))
    : []

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
        ) : widget.visualType === 'kpi' ? (
          <div className="studio-kpi">
            <strong>{formatMetric(metric, widget)}</strong>
            {showContext && <span>{sentence}</span>}
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
                {(output?.value?.result.diagnostics.matchedRowIndices ?? [])
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
              valueFormat: widget.appearance.valueFormat,
              currencyCode: widget.appearance.currencyCode,
              target,
              xAxisTitle: widget.appearance.xAxisTitle,
              yAxisTitle: widget.appearance.yAxisTitle,
              axisLabelRotation: widget.appearance.axisLabelRotation,
              showGrid: widget.appearance.showGrid,
            })}
            ariaLabel={`${widget.title}. ${sentence}`}
            onPointClick={(category, dataIndex) => {
              onPointClick?.(category || chartPoints[dataIndex]?.category || '')
            }}
          />
        )}
      </div>
    </article>
  )
}
