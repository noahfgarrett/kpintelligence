import type {
  DashboardFilterBindingRecord,
  DashboardRecord,
  SavedCalculationRecord,
  StudioWidgetQuery,
} from '../library/model'
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
    ...(query.secondaryConditions ?? []).map((condition) => condition.fieldId),
  ].filter((value): value is string => Boolean(value))
}

interface DatasetMatch {
  dataset: DatasetProfile
  score: number
  identityEvidence: boolean
  compatible: boolean
}

function datasetScore(
  oldDatasetId: string,
  query: StudioWidgetQuery,
  candidate: DatasetProfile,
  oldDataset?: DatasetProfile,
): Omit<DatasetMatch, 'dataset'> {
  const oldWorksheet = oldDataset
    ? normalized(oldDataset.worksheetName)
    : datasetWorksheetKey(oldDatasetId)
  const oldDatasetName = oldDataset ? normalized(oldDataset.name) : oldWorksheet
  const oldWorkbook = oldDataset
    ? datasetWorkbookSlug(oldDataset.id)
    : datasetWorkbookSlug(oldDatasetId)
  const candidateWorksheet = normalized(candidate.worksheetName)
  const candidateDatasetName = normalized(candidate.name)
  const candidateWorkbook = datasetWorkbookSlug(candidate.id)
  const requestedFields = new Set(referencedFieldIds(query).map(fieldKey).filter(Boolean))
  const oldFields = new Map(oldDataset?.fields.map((field) => [field.key, field]) ?? [])
  const candidateFields = new Map(candidate.fields.map((field) => [field.key, field]))
  const matchingFields = [...requestedFields].filter((key) => candidateFields.has(key)).length
  const typedFields = [...requestedFields].filter((key) => {
    const oldField = oldFields.get(key)
    const candidateField = candidateFields.get(key)
    return !oldField || (candidateField && oldField.inferredType === candidateField.inferredType)
  }).length
  const fieldScore = requestedFields.size > 0
    ? matchingFields / requestedFields.size * 40
    : 0
  const typeScore = oldDataset && requestedFields.size > 0
    ? typedFields / requestedFields.size * 10
    : 0
  const worksheetMatch = Boolean(oldWorksheet && oldWorksheet === candidateWorksheet)
  const datasetNameMatch = Boolean(oldDatasetName && oldDatasetName === candidateDatasetName)
  const workbookMatch = Boolean(oldWorkbook && oldWorkbook === candidateWorkbook)
  return {
    score: (worksheetMatch ? 35 : 0)
      + (datasetNameMatch && !worksheetMatch ? 20 : 0)
      + (workbookMatch ? 35 : 0)
      + fieldScore
      + typeScore,
    identityEvidence: worksheetMatch || datasetNameMatch || workbookMatch,
    compatible: matchingFields === requestedFields.size
      && (!oldDataset || typedFields === requestedFields.size),
  }
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
    .map((dataset): DatasetMatch => ({
      dataset,
      ...datasetScore(query.datasetId ?? '', query, dataset, oldDataset),
    }))
    .filter((candidate) => candidate.compatible)
    .sort((left, right) => right.score - left.score)
  const best = ranked[0]
  const second = ranked[1]
  const minimumScore = referencedFieldIds(query).length === 0 ? 35 : 50
  if (!best || best.score < minimumScore || !best.identityEvidence) return null
  if (second && best.score - second.score < 10) return null
  return best.dataset
}

function remapFieldId(
  fieldId: string | null,
  dataset: DatasetProfile,
  oldDataset?: DatasetProfile,
): string | null {
  if (!fieldId) return null
  if (dataset.fields.some((field) => field.id === fieldId)) return fieldId
  const key = fieldKey(fieldId)
  const keyed = dataset.fields.filter((field) => field.key === key)
  if (keyed.length === 1) return keyed[0].id
  const oldField = oldDataset?.fields.find((field) => field.id === fieldId || field.key === key)
  if (!oldField) return fieldId
  const headerMatches = dataset.fields.filter((field) =>
    normalized(field.headerDisplay) === normalized(oldField.headerDisplay))
  if (headerMatches.length === 1) return headerMatches[0].id
  const positional = dataset.fields.filter((field) =>
    field.sourceColumnIndex === oldField.sourceColumnIndex
    && field.inferredType === oldField.inferredType
    && normalized(field.headerDisplay) === normalized(oldField.headerDisplay))
  return positional.length === 1 ? positional[0].id : fieldId
}

function rebindQuery(
  query: StudioWidgetQuery,
  catalog: SpreadsheetCatalogProfile,
  previousCatalog?: SpreadsheetCatalogProfile | null,
): StudioWidgetQuery {
  const dataset = replacementDataset(query, catalog, previousCatalog)
  if (!dataset) return query
  const oldDataset = previousCatalog?.datasets.find((candidate) => candidate.id === query.datasetId)
  const rebound: StudioWidgetQuery = {
    ...query,
    datasetId: dataset.id,
    measureFieldId: remapFieldId(query.measureFieldId, dataset, oldDataset),
    secondaryMeasureFieldId: remapFieldId(query.secondaryMeasureFieldId, dataset, oldDataset),
    groupByFieldId: remapFieldId(query.groupByFieldId, dataset, oldDataset),
    seriesFieldId: remapFieldId(query.seriesFieldId, dataset, oldDataset),
    tableFieldIds: query.tableFieldIds.map((id) => remapFieldId(id, dataset, oldDataset) ?? id),
    conditions: query.conditions.map((condition) => ({
      ...condition,
      fieldId: remapFieldId(condition.fieldId, dataset, oldDataset) ?? condition.fieldId,
    })),
    secondaryConditions: (query.secondaryConditions ?? []).map((condition) => ({
      ...condition,
      fieldId: remapFieldId(condition.fieldId, dataset, oldDataset) ?? condition.fieldId,
    })),
  }
  return JSON.stringify(rebound) === JSON.stringify(query) ? query : rebound
}

function rebindCalculation(
  calculation: SavedCalculationRecord,
  catalog: SpreadsheetCatalogProfile,
  previousCatalog?: SpreadsheetCatalogProfile | null,
): SavedCalculationRecord {
  const query = rebindQuery({
    datasetId: calculation.datasetId,
    aggregation: calculation.aggregation,
    measureFieldId: calculation.measureFieldId,
    secondaryAggregation: calculation.secondaryAggregation,
    secondaryMeasureFieldId: calculation.secondaryMeasureFieldId,
    metricCalculation: calculation.metricCalculation,
    secondaryRuleMode: calculation.secondaryRuleMode,
    secondaryMatch: calculation.secondaryMatch,
    secondaryConditions: calculation.secondaryConditions,
    groupByFieldId: null,
    seriesFieldId: null,
    tableFieldIds: [],
    resultTransform: calculation.resultTransform ?? 'none',
    match: calculation.match,
    conditions: calculation.conditions,
    sort: 'categoryAscending',
    limit: 1,
  }, catalog, previousCatalog)
  if (query.datasetId === calculation.datasetId
    && query.measureFieldId === calculation.measureFieldId
    && query.secondaryMeasureFieldId === calculation.secondaryMeasureFieldId
    && query.conditions === calculation.conditions
    && query.secondaryConditions === calculation.secondaryConditions) {
    return calculation
  }
  return {
    ...calculation,
    datasetId: query.datasetId ?? calculation.datasetId,
    measureFieldId: query.measureFieldId,
    secondaryMeasureFieldId: query.secondaryMeasureFieldId,
    resultTransform: query.resultTransform,
    conditions: query.conditions,
    secondaryConditions: query.secondaryConditions ?? [],
    updatedAt: new Date().toISOString(),
  }
}

function rebindFilterBinding(
  binding: DashboardFilterBindingRecord,
  catalog: SpreadsheetCatalogProfile,
  previousCatalog?: SpreadsheetCatalogProfile | null,
): DashboardFilterBindingRecord {
  const query: StudioWidgetQuery = {
    datasetId: binding.datasetId,
    aggregation: 'countRows',
    measureFieldId: null,
    secondaryAggregation: null,
    secondaryMeasureFieldId: null,
    metricCalculation: 'none',
    secondaryRuleMode: 'same',
    secondaryMatch: 'all',
    secondaryConditions: [],
    groupByFieldId: binding.fieldId,
    seriesFieldId: null,
    tableFieldIds: [],
    resultTransform: 'none',
    match: 'all',
    conditions: [],
    sort: 'categoryAscending',
    limit: 1,
  }
  const rebound = rebindQuery(query, catalog, previousCatalog)
  if (!rebound.datasetId || !rebound.groupByFieldId) return binding
  const dataset = catalog.datasets.find((candidate) => candidate.id === rebound.datasetId)
  const field = dataset?.fields.find((candidate) => candidate.id === rebound.groupByFieldId)
  if (!dataset || !field) return binding
  const next: DashboardFilterBindingRecord = {
    datasetId: dataset.id,
    fieldId: field.id,
    fieldKey: field.key,
    fieldName: field.name,
    fieldType: field.inferredType,
  }
  return JSON.stringify(next) === JSON.stringify(binding) ? binding : next
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
  const calculations = (dashboard.calculations ?? []).map((calculation) => {
    const rebound = rebindCalculation(calculation, catalog, previousCatalog)
    if (rebound !== calculation) changed = true
    return rebound
  })
  const filters = dashboard.filters.map((filter) => {
    if (!filter.bindings?.length) return filter
    const bindings = filter.bindings.map((binding) =>
      rebindFilterBinding(binding, catalog, previousCatalog))
    if (bindings.every((binding, index) => binding === filter.bindings?.[index])) return filter
    changed = true
    return {
      ...filter,
      fieldType: bindings[0]?.fieldType ?? filter.fieldType,
      bindings,
    }
  })
  return changed
    ? { ...dashboard, pages, filters, calculations, updatedAt: new Date().toISOString() }
    : dashboard
}
