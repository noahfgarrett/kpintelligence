import type { DashboardRecord, StudioWidgetQuery } from '../library/model'
import type { DatasetProfile, SpreadsheetCatalogProfile } from './types'

function normalized(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function datasetWorksheetKey(datasetId: string): string {
  return datasetId.split('/dataset/')[1]?.split('/')[0] ?? ''
}

function datasetWorkbookSlug(datasetId: string): string {
  const workbookPart = datasetId.split('/dataset/')[0] ?? ''
  return workbookPart
    .replace(/^workbook:/, '')
    .replace(/-[a-z0-9]+$/, '')
}

function fieldKey(fieldId: string | null): string {
  if (!fieldId) return ''
  return fieldId.split('/field/')[1]?.split('/')[0] ?? ''
}

function referencedFieldIds(query: StudioWidgetQuery): string[] {
  return [
    query.measureFieldId,
    query.secondaryMeasureFieldId,
    query.groupByFieldId,
    query.seriesFieldId,
    ...query.tableFieldIds,
    ...query.conditions.map((condition) => condition.fieldId),
  ].filter((value): value is string => Boolean(value))
}

function datasetScore(
  oldDatasetId: string,
  query: StudioWidgetQuery,
  candidate: DatasetProfile,
  oldDataset?: DatasetProfile,
): number {
  const oldWorksheet = oldDataset
    ? normalized(oldDataset.worksheetName)
    : datasetWorksheetKey(oldDatasetId)
  const oldWorkbook = oldDataset
    ? datasetWorkbookSlug(oldDataset.id)
    : datasetWorkbookSlug(oldDatasetId)
  const candidateWorksheet = normalized(candidate.worksheetName)
  const candidateWorkbook = datasetWorkbookSlug(candidate.id)
  const requestedFields = new Set(referencedFieldIds(query).map(fieldKey).filter(Boolean))
  const candidateFields = new Set(candidate.fields.map((field) => field.key))
  const matchingFields = [...requestedFields].filter((key) => candidateFields.has(key)).length
  const fieldScore = requestedFields.size > 0
    ? matchingFields / requestedFields.size * 50
    : 0

  return (oldWorksheet && oldWorksheet === candidateWorksheet ? 35 : 0)
    + (oldWorkbook && oldWorkbook === candidateWorkbook ? 35 : 0)
    + fieldScore
}

function replacementDataset(
  query: StudioWidgetQuery,
  catalog: SpreadsheetCatalogProfile,
  previousCatalog?: SpreadsheetCatalogProfile | null,
): DatasetProfile | null {
  if (!query.datasetId) return null
  const exact = catalog.datasets.find((dataset) => dataset.id === query.datasetId)
  if (exact) return exact

  const oldDataset = previousCatalog?.datasets.find((dataset) => dataset.id === query.datasetId)
  const ranked = catalog.datasets
    .map((dataset) => ({
      dataset,
      score: datasetScore(query.datasetId ?? '', query, dataset, oldDataset),
    }))
    .sort((left, right) => right.score - left.score)
  const best = ranked[0]
  const second = ranked[1]
  if (!best || best.score < 50) return null
  if (second && second.score === best.score) return null
  return best.dataset
}

function remapFieldId(fieldId: string | null, dataset: DatasetProfile): string | null {
  if (!fieldId) return null
  const key = fieldKey(fieldId)
  return dataset.fields.find((field) => field.key === key)?.id ?? fieldId
}

function rebindQuery(
  query: StudioWidgetQuery,
  catalog: SpreadsheetCatalogProfile,
  previousCatalog?: SpreadsheetCatalogProfile | null,
): StudioWidgetQuery {
  const dataset = replacementDataset(query, catalog, previousCatalog)
  if (!dataset || dataset.id === query.datasetId) return query
  return {
    ...query,
    datasetId: dataset.id,
    measureFieldId: remapFieldId(query.measureFieldId, dataset),
    secondaryMeasureFieldId: remapFieldId(query.secondaryMeasureFieldId, dataset),
    groupByFieldId: remapFieldId(query.groupByFieldId, dataset),
    seriesFieldId: remapFieldId(query.seriesFieldId, dataset),
    tableFieldIds: query.tableFieldIds.map((id) => remapFieldId(id, dataset) ?? id),
    conditions: query.conditions.map((condition) => ({
      ...condition,
      fieldId: remapFieldId(condition.fieldId, dataset) ?? condition.fieldId,
    })),
  }
}

export function rebindDashboardSources(
  dashboard: DashboardRecord,
  catalog: SpreadsheetCatalogProfile,
  previousCatalog?: SpreadsheetCatalogProfile | null,
): DashboardRecord {
  if (dashboard.kind !== 'custom') return dashboard
  let changed = false
  const pages = dashboard.pages.map((page) => {
    const widgets = page.widgets.map((widget) => {
      const query = rebindQuery(widget.query, catalog, previousCatalog)
      if (query === widget.query) return widget
      changed = true
      return { ...widget, query, updatedAt: new Date().toISOString() }
    })
    return widgets.some((widget, index) => widget !== page.widgets[index])
      ? { ...page, widgets, updatedAt: new Date().toISOString() }
      : page
  })
  return changed
    ? { ...dashboard, pages, updatedAt: new Date().toISOString() }
    : dashboard
}
