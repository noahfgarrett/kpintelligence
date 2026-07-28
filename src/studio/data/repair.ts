import type { ProjectSourceRepairs } from '../library/model'
import type {
  DatasetProfile,
  FieldProfile,
  SpreadsheetCatalogProfile,
} from './types'

export interface SourceHealthIssue {
  id: string
  severity: 'warning' | 'note'
  title: string
  detail: string
  datasetId: string | null
  fieldId: string | null
}

export interface SourceHealthSummary {
  status: 'ready' | 'review'
  warningCount: number
  noteCount: number
  reviewedDatasetCount: number
  issues: SourceHealthIssue[]
}

export function emptySourceRepairs(): ProjectSourceRepairs {
  return { fieldRepairs: [], reviewedDatasetIds: [] }
}

function normalized(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function datasetKey(datasetId: string): string {
  return datasetId.split('/dataset/')[1]?.split('/')[0] ?? ''
}

function fieldKey(fieldId: string): string {
  return fieldId.split('/field/')[1]?.split('/')[0] ?? ''
}

function repairTargetsDataset(
  repair: ProjectSourceRepairs['fieldRepairs'][number],
  dataset: DatasetProfile,
  catalog: SpreadsheetCatalogProfile,
): boolean {
  if (repair.datasetId === dataset.id) return true
  const requestedWorkbook = normalized(repair.workbookFileName ?? '')
  const requestedName = normalized(repair.datasetName ?? '')
  const requestedWorksheet = normalized(
    repair.worksheetName || datasetKey(repair.datasetId),
  )
  if (!requestedName && !requestedWorksheet) return false
  const matches = catalog.datasets.filter((candidate) => {
    const workbook = catalog.workbooks.find((entry) => entry.id === candidate.workbookId)
    const workbookMatches = !requestedWorkbook
      || normalized(workbook?.fileName ?? '') === requestedWorkbook
    const nameMatches = !requestedName || normalized(candidate.name) === requestedName
    const worksheetMatches = !requestedWorksheet
      || normalized(candidate.worksheetName) === requestedWorksheet
      || normalized(datasetKey(candidate.id)) === requestedWorksheet
    return workbookMatches && nameMatches && worksheetMatches
  })
  return matches.length === 1 && matches[0].id === dataset.id
}

export function findSourceFieldRepair(
  catalog: SpreadsheetCatalogProfile,
  dataset: DatasetProfile,
  field: FieldProfile,
  configured?: ProjectSourceRepairs,
): ProjectSourceRepairs['fieldRepairs'][number] | undefined {
  const repairs = configured ?? emptySourceRepairs()
  const candidates = repairs.fieldRepairs.filter((repair) =>
    repairTargetsDataset(repair, dataset, catalog))
  const exact = candidates.find((repair) => repair.fieldId === field.id)
  if (exact) return exact
  const requestedKey = field.key
  const keyed = candidates.filter((repair) =>
    (repair.fieldKey || fieldKey(repair.fieldId)) === requestedKey)
  if (keyed.length === 1) return keyed[0]
  const headerMatches = candidates.filter((repair) =>
    repair.sourceHeader
    && normalized(repair.sourceHeader) === normalized(field.headerDisplay))
  if (headerMatches.length === 1) return headerMatches[0]
  const positional = candidates.filter((repair) =>
    repair.sourceColumnIndex === field.sourceColumnIndex
    && Boolean(repair.sourceHeader)
    && normalized(repair.sourceHeader ?? '') === normalized(field.headerDisplay))
  return positional.length === 1 ? positional[0] : undefined
}

function repairedDataset(
  dataset: DatasetProfile,
  catalog: SpreadsheetCatalogProfile,
  repairs: ProjectSourceRepairs,
): DatasetProfile {
  const repairedFields = dataset.fields.map((field) => {
    const repair = findSourceFieldRepair(catalog, dataset, field, repairs)
    if (!repair) return field
    return {
      ...field,
      name: repair.displayName?.trim() || field.name,
      inferredType: repair.dataType ?? field.inferredType,
      typeConfidence: repair.dataType ? 1 : field.typeConfidence,
    }
  })
  if (repairedFields.every((field, index) => field === dataset.fields[index])) return dataset
  return {
    ...dataset,
    fields: repairedFields,
  }
}

export function applySourceRepairs(
  catalog: SpreadsheetCatalogProfile,
  configured?: ProjectSourceRepairs,
): SpreadsheetCatalogProfile {
  const repairs = configured ?? emptySourceRepairs()
  if (repairs.fieldRepairs.length === 0) return catalog
  const datasets = new Map(
    catalog.datasets.map((dataset) => {
      const repaired = repairedDataset(dataset, catalog, repairs)
      return [dataset.id, repaired] as const
    }),
  )
  return {
    ...catalog,
    datasets: catalog.datasets.map((dataset) => datasets.get(dataset.id) ?? dataset),
    workbooks: catalog.workbooks.map((workbook) => ({
      ...workbook,
      datasets: workbook.datasets.map((dataset) => datasets.get(dataset.id) ?? dataset),
      worksheets: workbook.worksheets.map((worksheet) => ({
        ...worksheet,
        dataset: worksheet.dataset
          ? datasets.get(worksheet.dataset.id) ?? worksheet.dataset
          : null,
      })),
    })),
  }
}

function fieldNeedsReview(field: FieldProfile): boolean {
  return field.nonBlankCount > 0 && field.typeConfidence < 0.72
}

export function inspectSourceHealth(
  catalog: SpreadsheetCatalogProfile,
  configured?: ProjectSourceRepairs,
): SourceHealthSummary {
  const repairs = configured ?? emptySourceRepairs()
  const reviewed = new Set(repairs.reviewedDatasetIds)
  const issues: SourceHealthIssue[] = catalog.warnings.map((warning, index) => ({
    id: `catalog-warning-${index}`,
    severity: 'warning',
    title: 'Source warning',
    detail: warning,
    datasetId: null,
    fieldId: null,
  }))

  catalog.datasets.forEach((dataset) => {
    if (dataset.headerConfidence < 0.62 && !reviewed.has(dataset.id)) {
      issues.push({
        id: `header-${dataset.id}`,
        severity: 'warning',
        title: `${dataset.name} needs a header check`,
        detail: `KPIntelligence detected row ${dataset.headerRowNumber} as the header with ${Math.round(dataset.headerConfidence * 100)}% confidence.`,
        datasetId: dataset.id,
        fieldId: null,
      })
    }
    dataset.fields.forEach((field) => {
      const repair = findSourceFieldRepair(catalog, dataset, field, repairs)
      const typeRepaired = Boolean(repair?.dataType)
      const nameRepaired = Boolean(repair?.displayName?.trim())
      if (fieldNeedsReview(field) && !typeRepaired) {
        issues.push({
          id: `type-${field.id}`,
          severity: 'note',
          title: `Review ${field.name}`,
          detail: `The values look mixed, so ${field.inferredType} was selected with ${Math.round(field.typeConfidence * 100)}% confidence.`,
          datasetId: dataset.id,
          fieldId: field.id,
        })
      }
      if (field.name.startsWith('Column ') && !nameRepaired) {
        issues.push({
          id: `name-${field.id}`,
          severity: 'note',
          title: `${field.name} has no source label`,
          detail: 'Give this column a clear display name before using it in a dashboard.',
          datasetId: dataset.id,
          fieldId: field.id,
        })
      }
    })
  })

  const warningCount = issues.filter((issue) => issue.severity === 'warning').length
  const noteCount = issues.length - warningCount
  return {
    status: warningCount > 0 || noteCount > 0 ? 'review' : 'ready',
    warningCount,
    noteCount,
    reviewedDatasetCount: catalog.datasets.filter((dataset) => reviewed.has(dataset.id)).length,
    issues,
  }
}
