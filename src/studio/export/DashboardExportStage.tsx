import { useEffect, useMemo, useRef } from 'react'
import type { DatasetProfile, SpreadsheetCatalogProfile } from '../data'
import type {
  DashboardRecord,
  ExportProfileRecord,
  ProjectRecord,
  StudioPageRecord,
  StudioWidgetRecord,
} from '../library/model'
import WidgetView from '../builder/WidgetView'
import { dashboardFilterConditions, runStudioQuery } from '../builder/queryAdapter'
import { exportPageSize } from './customDashboard'

interface ExportSegment {
  id: string
  page: StudioPageRecord
  widgets: StudioWidgetRecord[]
  startRow: number
  endRow: number
  segmentIndex: number
  segmentCount: number
  tableSlices?: Record<string, { start: number; limit: number }>
}

interface DashboardExportStageProps {
  dashboard: DashboardRecord
  project: ProjectRecord
  catalog: SpreadsheetCatalogProfile | null
  profile: ExportProfileRecord
  onReady: () => void
  onError: (message: string) => void
}

const MAX_EXPORT_PAGES = 60

function layoutPageSegments(page: StudioPageRecord): ExportSegment[] {
  const ordered = [...page.widgets].sort((left, right) =>
    left.layout.y - right.layout.y || left.layout.x - right.layout.x)
  if (ordered.length === 0) return []

  const segments: Omit<ExportSegment, 'segmentCount'>[] = []
  let remaining = ordered
  let startRow = Math.min(...remaining.map((widget) => widget.layout.y))
  while (remaining.length > 0) {
    let endRow = startRow + 16
    const crossing = remaining.filter((widget) =>
      widget.layout.y < endRow && widget.layout.y + widget.layout.h > endRow)
    if (crossing.length > 0) {
      const firstCrossingStart = Math.min(...crossing.map((widget) => widget.layout.y))
      if (firstCrossingStart > startRow) endRow = firstCrossingStart
      else endRow = Math.max(...crossing.map((widget) => widget.layout.y + widget.layout.h))
    }
    const widgets = remaining.filter((widget) => widget.layout.y >= startRow && widget.layout.y < endRow)
    const safeWidgets = widgets.length > 0 ? widgets : [remaining[0]]
    const actualEnd = Math.max(endRow, ...safeWidgets.map((widget) => widget.layout.y + widget.layout.h))
    segments.push({
      id: `${page.id}-${segments.length}`,
      page,
      widgets: safeWidgets,
      startRow,
      endRow: actualEnd,
      segmentIndex: segments.length,
    })
    const ids = new Set(safeWidgets.map((widget) => widget.id))
    remaining = remaining.filter((widget) => !ids.has(widget.id))
    startRow = remaining.length > 0 ? Math.min(...remaining.map((widget) => widget.layout.y)) : actualEnd
  }
  return segments.map((segment) => ({ ...segment, segmentCount: segments.length }))
}

function datasetFor(widget: StudioWidgetRecord, catalog: SpreadsheetCatalogProfile | null): DatasetProfile | undefined {
  return catalog?.datasets.find((dataset) => dataset.id === widget.query.datasetId)
}

function tableRowCount(
  widget: StudioWidgetRecord,
  dashboard: DashboardRecord,
  catalog: SpreadsheetCatalogProfile | null,
): number {
  const dataset = datasetFor(widget, catalog)
  if (!dataset) return 0
  try {
    return runStudioQuery(
      widget.query,
      dataset,
      dashboardFilterConditions(dashboard.filters, dataset),
    ).result.diagnostics.matchedRows
  } catch {
    return 0
  }
}

export function buildExportSegments(
  dashboard: DashboardRecord,
  catalog: SpreadsheetCatalogProfile | null,
  profile: ExportProfileRecord,
): ExportSegment[] {
  const segments = dashboard.pages.flatMap((page) => {
    const tables = page.widgets.filter((widget) => widget.visualType === 'table')
    const layoutSegments = layoutPageSegments(page).map((segment) => ({
      ...segment,
      tableSlices: Object.fromEntries(
        segment.widgets
          .filter((widget) => widget.visualType === 'table')
          .map((widget) => [
            widget.id,
            {
              start: 0,
              limit: Math.max(
                3,
                Math.floor(widget.layout.h * (profile.tableOverflow === 'shrink' ? 3 : 2) - 4),
              ),
            },
          ]),
      ),
    }))
    const rowsPerPage = profile.tableOverflow === 'shrink' ? 55 : 28
    const tableSegments = tables.flatMap((widget) => {
      const rowCount = tableRowCount(widget, dashboard, catalog)
      const firstPageRows = Math.max(
        3,
        Math.floor(widget.layout.h * (profile.tableOverflow === 'shrink' ? 3 : 2) - 4),
      )
      const remainingRows = Math.max(0, rowCount - firstPageRows)
      const count = Math.ceil(remainingRows / rowsPerPage)
      if (count + 1 > MAX_EXPORT_PAGES) {
        throw new Error(`This export would create more than ${MAX_EXPORT_PAGES} pages. Narrow the table filters or split the dashboard before exporting.`)
      }
      return Array.from({ length: count }, (_, index): ExportSegment => ({
        id: `${page.id}-${widget.id}-table-${index}`,
        page,
        widgets: [{
          ...widget,
          layout: { ...widget.layout, x: 0, y: 0, w: 12, h: 16 },
        }],
        startRow: 0,
        endRow: 16,
        segmentIndex: 0,
        segmentCount: 1,
        tableSlices: {
          [widget.id]: {
            start: firstPageRows + index * rowsPerPage,
            limit: rowsPerPage,
          },
        },
      }))
    })
    const combined = [...layoutSegments, ...tableSegments]
    const resolved = combined.length > 0
      ? combined
      : [{
          id: `${page.id}-empty`,
          page,
          widgets: [],
          startRow: 0,
          endRow: 14,
          segmentIndex: 0,
          segmentCount: 1,
        }]
    return resolved.map((segment, index) => ({
      ...segment,
      segmentIndex: index,
      segmentCount: resolved.length,
    }))
  })
  if (segments.length > MAX_EXPORT_PAGES) {
    throw new Error(`This export would create ${segments.length.toLocaleString()} pages. Narrow the table filters or split the dashboard to stay under ${MAX_EXPORT_PAGES} pages.`)
  }
  return segments
}

export default function DashboardExportStage({
  dashboard,
  project,
  catalog,
  profile,
  onReady,
  onError,
}: DashboardExportStageProps) {
  const size = exportPageSize(profile)
  const plan = useMemo(
    () => {
      try {
        return { segments: buildExportSegments(dashboard, catalog, profile), error: null }
      } catch (error) {
        return {
          segments: [],
          error: error instanceof Error ? error.message : 'The dashboard is too large to export safely.',
        }
      }
    },
    [catalog, dashboard, profile],
  )
  const readyRef = useRef(onReady)
  readyRef.current = onReady
  const errorRef = useRef(onError)
  errorRef.current = onError
  const margin = profile.margin / size.widthInches * size.widthPixels
  const headerHeight = profile.includeTitle || profile.headerText ? 68 : 24
  const footerHeight = profile.includeGeneratedAt || profile.includePageNumbers || profile.footerText ? 44 : 18
  const bodyWidth = size.widthPixels - margin * 2
  const bodyHeight = size.heightPixels - margin * 2 - headerHeight - footerHeight

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (plan.error) errorRef.current(plan.error)
      else readyRef.current()
    }, plan.error ? 0 : 80)
    return () => window.clearTimeout(timer)
  }, [plan.error])

  return (
    <div className="studio-export-stage" aria-hidden="true">
      {plan.segments.map((segment, pageIndex) => {
        const rowSpan = Math.max(1, segment.endRow - segment.startRow)
        const columnWidth = bodyWidth / 12
        const rowHeight = bodyHeight / rowSpan
        return (
          <section
            data-studio-export-page
            className="studio-export-page"
            key={segment.id}
            style={{
              width: size.widthPixels,
              height: size.heightPixels,
              padding: margin,
            }}
          >
            <header style={{ height: headerHeight }}>
              <div>
                {profile.headerText && <span>{profile.headerText}</span>}
                {profile.includeTitle && (
                  <strong>
                    {segment.page.name}
                    {segment.segmentCount > 1 ? ` · ${segment.segmentIndex + 1} of ${segment.segmentCount}` : ''}
                  </strong>
                )}
              </div>
              <div>
                <span>{project.name}</span>
                <small>{dashboard.name}</small>
              </div>
            </header>
            <div className="studio-export-body" style={{ width: bodyWidth, height: bodyHeight }}>
              {segment.widgets.map((widget) => (
                <div
                  className="studio-export-widget"
                  key={widget.id}
                  style={{
                    left: widget.layout.x * columnWidth + 6,
                    top: (widget.layout.y - segment.startRow) * rowHeight + 6,
                    width: widget.layout.w * columnWidth - 12,
                    height: widget.layout.h * rowHeight - 12,
                  }}
                >
                  <WidgetView
                    widget={widget}
                    dataset={datasetFor(widget, catalog)}
                    selected={false}
                    editable={false}
                    dashboardFilters={dashboard.filters}
                    showQueryContext={false}
                    tableRowStart={segment.tableSlices?.[widget.id]?.start ?? 0}
                    tableRowLimit={segment.tableSlices?.[widget.id]?.limit ?? 50}
                    onSelect={() => undefined}
                    onMenu={() => undefined}
                  />
                </div>
              ))}
              {segment.widgets.length === 0 && (
                <div className="studio-export-empty">This page has no visuals.</div>
              )}
            </div>
            <footer style={{ height: footerHeight }}>
              <span>{profile.footerText}</span>
              <div>
                {profile.includeGeneratedAt && <span>Generated {new Date().toLocaleDateString()}</span>}
                {profile.includePageNumbers && <strong>{pageIndex + 1} / {plan.segments.length}</strong>}
              </div>
            </footer>
          </section>
        )
      })}
    </div>
  )
}
