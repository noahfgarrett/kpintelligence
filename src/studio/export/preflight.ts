import type { SpreadsheetCatalogProfile } from '../data'
import type {
  DashboardRecord,
  ExportProfileRecord,
  StudioWidgetRecord,
} from '../library/model'
import {
  dashboardFilterConditions,
  dashboardFiltersForWidget,
  resolveDashboardFilterField,
  runStudioQuery,
} from '../builder/queryAdapter'
import { buildExportSegments } from './DashboardExportStage'

export interface ExportPreflightIssue {
  id: string
  severity: 'blocker' | 'warning'
  title: string
  detail: string
  pageId: string | null
  widgetId: string | null
}

export interface ExportPreflightReport {
  status: 'ready' | 'warning' | 'blocked'
  blockers: ExportPreflightIssue[]
  warnings: ExportPreflightIssue[]
  pageCount: number
}

function referencedFieldIds(widget: StudioWidgetRecord): string[] {
  return [
    widget.query.aggregation === 'countRows' ? null : widget.query.measureFieldId,
    widget.query.secondaryAggregation === null
      || widget.query.secondaryAggregation === 'countRows'
      ? null
      : widget.query.secondaryMeasureFieldId,
    widget.query.groupByFieldId,
    widget.query.seriesFieldId,
    ...widget.query.tableFieldIds,
    ...widget.query.conditions.map((condition) => condition.fieldId),
    ...(widget.query.secondaryConditions ?? []).map((condition) => condition.fieldId),
  ].filter((value): value is string => Boolean(value))
}

export function runExportPreflight(
  dashboard: DashboardRecord,
  catalog: SpreadsheetCatalogProfile | null,
  profile: ExportProfileRecord,
): ExportPreflightReport {
  const issues: ExportPreflightIssue[] = []
  let pageCount = dashboard.pages.length
  if (!catalog) {
    issues.push({
      id: 'missing-catalog',
      severity: 'blocker',
      title: 'Spreadsheet data is not loaded',
      detail: 'Reconnect or refresh this project before exporting.',
      pageId: null,
      widgetId: null,
    })
  }

  dashboard.pages.forEach((page) => {
    if (page.widgets.length === 0) {
      issues.push({
        id: `empty-page-${page.id}`,
        severity: 'warning',
        title: `${page.name} is empty`,
        detail: 'The export will include a blank report page.',
        pageId: page.id,
        widgetId: null,
      })
    }
    page.widgets.forEach((widget) => {
      if (widget.visualType === 'text') return
      if (!widget.query.datasetId) {
        issues.push({
          id: `missing-dataset-${widget.id}`,
          severity: 'blocker',
          title: `${widget.title || 'Untitled visual'} has no spreadsheet`,
          detail: `Choose a spreadsheet or worksheet on ${page.name}.`,
          pageId: page.id,
          widgetId: widget.id,
        })
        return
      }
      const dataset = catalog?.datasets.find((candidate) =>
        candidate.id === widget.query.datasetId)
      if (!dataset) {
        issues.push({
          id: `disconnected-dataset-${widget.id}`,
          severity: 'blocker',
          title: `${widget.title || 'Untitled visual'} is disconnected`,
          detail: `Its source worksheet is no longer available on ${page.name}.`,
          pageId: page.id,
          widgetId: widget.id,
        })
        return
      }
      const available = new Set(dataset.fields.map((field) => field.id))
      const missing = referencedFieldIds(widget).filter((fieldId) => !available.has(fieldId))
      if (missing.length > 0) {
        issues.push({
          id: `missing-fields-${widget.id}`,
          severity: 'blocker',
          title: `${widget.title || 'Untitled visual'} needs ${missing.length} replacement column${missing.length === 1 ? '' : 's'}`,
          detail: `Repair its field assignments on ${page.name} before exporting.`,
          pageId: page.id,
          widgetId: widget.id,
        })
        return
      }
      if (widget.visualType === 'table' && widget.query.tableFieldIds.length === 0) {
        issues.push({
          id: `empty-table-${widget.id}`,
          severity: 'blocker',
          title: `${widget.title || 'Detail table'} has no columns`,
          detail: `Add at least one table column on ${page.name}.`,
          pageId: page.id,
          widgetId: widget.id,
        })
        return
      }
      try {
        const result = runStudioQuery(
          widget.query,
          dataset,
          dashboardFilterConditions(
            dashboardFiltersForWidget(dashboard.filters, widget.id),
            dataset,
            page.id,
          ),
        )
        if (result.result.diagnostics.matchedRows === 0) {
          issues.push({
            id: `empty-result-${widget.id}`,
            severity: 'warning',
            title: `${widget.title || 'Untitled visual'} has no matching rows`,
            detail: `Current slicers and rules leave this visual empty on ${page.name}.`,
            pageId: page.id,
            widgetId: widget.id,
          })
        }
        if (result.result.diagnostics.totalCoercionIssues > 0) {
          issues.push({
            id: `data-notes-${widget.id}`,
            severity: 'warning',
            title: `${widget.title || 'Untitled visual'} has data notes`,
            detail: `${result.result.diagnostics.totalCoercionIssues.toLocaleString()} cells could not be interpreted cleanly.`,
            pageId: page.id,
            widgetId: widget.id,
          })
        }
        if (result.points.some((point) => !Number.isFinite(point.value))) {
          issues.push({
            id: `undefined-results-${widget.id}`,
            severity: 'warning',
            title: `${widget.title || 'Untitled visual'} has undefined results`,
            detail: 'At least one calculation cannot produce a finite value, often because its comparison total is zero.',
            pageId: page.id,
            widgetId: widget.id,
          })
        }
      } catch (error) {
        issues.push({
          id: `query-error-${widget.id}`,
          severity: 'blocker',
          title: `${widget.title || 'Untitled visual'} cannot be calculated`,
          detail: error instanceof Error ? error.message : 'Review its calculation and row rules.',
          pageId: page.id,
          widgetId: widget.id,
        })
      }
    })
  })

  if (catalog) {
    const pageIds = new Set(dashboard.pages.map((page) => page.id))
    dashboard.filters.forEach((filter) => {
      const selectedValues = filter.values ?? (filter.value ? [filter.value] : [])
      if (!filter.enabled || selectedValues.length === 0) return
      if ((filter.scope ?? 'dashboard') === 'page'
        && (!filter.pageId || !pageIds.has(filter.pageId))) {
        issues.push({
          id: `missing-filter-page-${filter.id}`,
          severity: 'blocker',
          title: `${filter.name} slicer has no report page`,
          detail: 'Move this slicer to an existing page or remove it before exporting.',
          pageId: null,
          widgetId: null,
        })
        return
      }
      const widgets = dashboard.pages
        .filter((page) =>
          (filter.scope ?? 'dashboard') === 'dashboard' || page.id === filter.pageId)
        .flatMap((page) => page.widgets
          .filter((widget) =>
            widget.visualType !== 'text'
            && widget.id !== filter.sourceWidgetId
            && Boolean(widget.query.datasetId))
          .map((widget) => ({
            page,
            widget,
            dataset: catalog.datasets.find((dataset) =>
              dataset.id === widget.query.datasetId),
          })))
        .filter((entry) => Boolean(entry.dataset))
      const matchedCount = widgets.filter(({ dataset }) =>
        Boolean(dataset && resolveDashboardFilterField(filter, dataset))).length
      if (matchedCount === 0) {
        issues.push({
          id: `missing-filter-${filter.id}`,
          severity: 'blocker',
          title: `${filter.name} slicer is disconnected`,
          detail: 'Its selected values do not match any visual in its current scope.',
          pageId: filter.pageId ?? null,
          widgetId: null,
        })
      } else if (matchedCount < widgets.length) {
        issues.push({
          id: `partial-filter-${filter.id}`,
          severity: 'warning',
          title: `${filter.name} affects ${matchedCount} of ${widgets.length} visuals`,
          detail: 'Some visuals do not contain one unambiguous compatible column for this slicer.',
          pageId: filter.pageId ?? null,
          widgetId: null,
        })
      }
    })
    try {
      pageCount = buildExportSegments(dashboard, catalog, profile).length
    } catch (error) {
      issues.push({
        id: 'export-size',
        severity: 'blocker',
        title: 'The export is too large',
        detail: error instanceof Error ? error.message : 'Reduce the report size before exporting.',
        pageId: null,
        widgetId: null,
      })
    }
  }

  const blockers = issues.filter((issue) => issue.severity === 'blocker')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  return {
    status: blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'ready',
    blockers,
    warnings,
    pageCount,
  }
}
