import type {
  FieldDataTypeV1,
  FieldV1,
  PredicateConditionV1,
  PredicateV1,
  QuerySpecV1,
  ScalarLiteralV1,
} from '../domain/model'
import { executeQuery, type QueryResult } from '../domain/query'
import type { DatasetProfile, FieldProfile, ProfiledRawValue } from '../data'
import type { ChartDataPoint } from '../renderers/chartOptions'
import type { DashboardFilterRecord, StudioCondition, StudioWidgetQuery } from '../library/model'

export interface StudioQueryOutput {
  result: QueryResult
  points: ChartDataPoint[]
  fields: FieldV1[]
  records: Record<string, unknown>[]
}

export function dashboardFilterConditions(
  filters: DashboardFilterRecord[],
  dataset: DatasetProfile,
): StudioCondition[] {
  return filters.flatMap((filter) => {
    if (!filter.enabled || !filter.value) return []
    const field = dataset.fields.find((candidate) =>
      candidate.name.trim().toLowerCase() === filter.fieldName.trim().toLowerCase())
    if (!field) return []
    return [{
      id: `dashboard-${filter.id}`,
      fieldId: field.id,
      operator: 'equals',
      value: filter.value,
    }]
  })
}

function now(): string {
  return new Date().toISOString()
}

export function fieldType(field: FieldProfile): FieldDataTypeV1 {
  return field.inferredType
}

export function domainFields(dataset: DatasetProfile): FieldV1[] {
  const createdAt = now()
  return dataset.fields.map((field) => ({
    schemaVersion: 1,
    id: field.id,
    kind: 'field',
    datasetId: dataset.id,
    name: field.name,
    sourceColumn: field.id,
    aliases: [],
    dataType: fieldType(field),
    nullable: field.blankCount > 0,
    coercion: {
      trimText: true,
      emptyTextIsBlank: true,
    },
    createdAt,
    updatedAt: createdAt,
  }))
}

export function datasetRecords(dataset: DatasetProfile): Record<string, unknown>[] {
  return dataset.rows.map((row) => Object.fromEntries(
    dataset.fields.map((field) => [field.id, row.cells[field.id]?.raw ?? null]),
  ))
}

function scalarLiteral(type: FieldDataTypeV1, input: string): ScalarLiteralV1 {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('Enter a value for every rule, or choose “is blank”.')
  if (type === 'number') {
    const value = Number(trimmed)
    if (!Number.isFinite(value)) throw new Error(`“${input}” is not a valid number.`)
    return { dataType: type, value }
  }
  if (type === 'boolean') {
    if (/^(true|yes|1)$/i.test(trimmed)) return { dataType: type, value: true }
    if (/^(false|no|0)$/i.test(trimmed)) return { dataType: type, value: false }
    throw new Error('Choose True or False for a yes/no rule.')
  }
  if (type === 'date' || type === 'datetime' || type === 'workWeek') {
    return { dataType: type, value: trimmed }
  }
  return { dataType: 'text', value: input }
}

function conditionPredicate(
  condition: StudioCondition,
  field: FieldProfile,
): PredicateConditionV1 {
  if (condition.operator === 'isBlank' || condition.operator === 'isNotBlank') {
    return {
      kind: 'condition',
      fieldId: field.id,
      operator: condition.operator,
    }
  }
  if (condition.operator === 'oneOf' || condition.operator === 'notOneOf') {
    return {
      kind: 'condition',
      fieldId: field.id,
      operator: condition.operator,
      values: condition.value
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => scalarLiteral(fieldType(field), value)),
    }
  }
  if (condition.operator === 'between') {
    const [lower = '', upper = ''] = condition.value.split('..', 2)
    return {
      kind: 'condition',
      fieldId: field.id,
      operator: 'between',
      lower: scalarLiteral(fieldType(field), lower),
      upper: scalarLiteral(fieldType(field), upper),
      inclusive: true,
    }
  }
  return {
    kind: 'condition',
    fieldId: field.id,
    operator: condition.operator,
    value: scalarLiteral(fieldType(field), condition.value),
  }
}

function conditionsForDataset(
  conditions: StudioCondition[],
  dataset: DatasetProfile,
  strict: boolean,
): PredicateConditionV1[] {
  return conditions.flatMap((condition) => {
    const field = dataset.fields.find((candidate) => candidate.id === condition.fieldId)
    if (!field) {
      if (strict) {
        throw new Error('A column used by this visual is no longer available. Choose a replacement in Rules.')
      }
      return []
    }
    return [conditionPredicate(condition, field)]
  })
}

function wherePredicate(
  query: StudioWidgetQuery,
  dataset: DatasetProfile,
  dashboardConditions: StudioCondition[],
): PredicateV1 | undefined {
  const localConditions = conditionsForDataset(query.conditions, dataset, true)
  const globalConditions = conditionsForDataset(dashboardConditions, dataset, false)
  const localPredicate: PredicateV1 | undefined = localConditions.length > 0 ? {
    kind: 'group',
    mode: query.match,
    predicates: localConditions,
  } : undefined
  if (globalConditions.length === 0) return localPredicate
  return {
    kind: 'group',
    mode: 'all',
    predicates: [
      ...(localPredicate ? [localPredicate] : []),
      ...globalConditions,
    ],
  }
}

export function sentenceForQuery(query: StudioWidgetQuery, dataset?: DatasetProfile): string {
  if (!dataset) return 'Choose a spreadsheet to start building this visual.'
  const measure = dataset.fields.find((field) => field.id === query.measureFieldId)
  const secondaryMeasure = dataset.fields.find((field) => field.id === query.secondaryMeasureFieldId)
  const group = dataset.fields.find((field) => field.id === query.groupByFieldId)
  const series = dataset.fields.find((field) => field.id === query.seriesFieldId)
  const aggregateLabels: Record<StudioWidgetQuery['aggregation'], string> = {
    countRows: 'Count rows',
    countNonEmpty: 'Count filled',
    distinctCount: 'Count unique',
    sum: 'Sum',
    average: 'Average',
    min: 'Minimum',
    max: 'Maximum',
    first: 'First',
    last: 'Last',
  }
  const filterText = query.conditions.length > 0
    ? ` where ${query.conditions.length} ${query.match === 'all' ? 'rule' : 'alternative'}${query.conditions.length === 1 ? '' : 's'} match`
    : ''
  const secondary = query.secondaryAggregation
    ? ` and ${aggregateLabels[query.secondaryAggregation]}${secondaryMeasure ? ` of ${secondaryMeasure.name}` : ''}`
    : ''
  const transform = query.resultTransform === 'percentOfTotal'
    ? ' as percent of total'
    : query.resultTransform === 'runningTotal'
      ? ' as a running total'
      : ''
  return `${aggregateLabels[query.aggregation]}${measure ? ` of ${measure.name}` : ''}${secondary} from ${dataset.name}${group ? ` by ${group.name}` : ''}${series ? ` split by ${series.name}` : ''}${filterText}${transform}.`
}

export function runStudioQuery(
  query: StudioWidgetQuery,
  dataset: DatasetProfile,
  dashboardConditions: StudioCondition[] = [],
): StudioQueryOutput {
  const fields = domainFields(dataset)
  const records = datasetRecords(dataset)
  const aggregationId = 'value'
  const secondaryAggregationId = 'secondary'
  const groupBy = [
    ...(query.groupByFieldId ? [{ fieldId: query.groupByFieldId }] : []),
    ...(query.seriesFieldId && query.seriesFieldId !== query.groupByFieldId
      ? [{ fieldId: query.seriesFieldId }]
      : []),
  ]
  const aggregations: QuerySpecV1['aggregations'] = [{
    schemaVersion: 1,
    id: aggregationId,
    label: 'Value',
    operation: query.aggregation,
    ...(query.aggregation !== 'countRows' && query.measureFieldId
      ? { fieldId: query.measureFieldId }
      : {}),
  }]
  if (query.secondaryAggregation) {
    aggregations.push({
      schemaVersion: 1,
      id: secondaryAggregationId,
      label: 'Secondary',
      operation: query.secondaryAggregation,
      ...(query.secondaryAggregation !== 'countRows' && query.secondaryMeasureFieldId
        ? { fieldId: query.secondaryMeasureFieldId }
        : {}),
    })
  }
  const querySpec: QuerySpecV1 = {
    schemaVersion: 1,
    id: `query-${dataset.id}`,
    datasetId: dataset.id,
    where: wherePredicate(query, dataset, dashboardConditions),
    groupBy,
    aggregations,
    orderBy: query.groupByFieldId
      ? [{
          by: query.sort.startsWith('value') ? 'aggregation' : 'group',
          ...(query.sort.startsWith('value')
            ? { aggregationId }
            : { fieldId: query.groupByFieldId }),
          direction: query.sort.endsWith('Descending') ? 'descending' : 'ascending',
        }]
      : undefined,
    limit: Math.max(1, Math.min(10_000, query.limit)),
  } as QuerySpecV1

  const result = executeQuery({ query: querySpec, fields, rows: records })
  let points = result.groups.flatMap((group, index) => {
    const dimension = query.groupByFieldId ? group.dimensions[query.groupByFieldId] : undefined
    const seriesDimension = query.seriesFieldId ? group.dimensions[query.seriesFieldId] : undefined
    const rawValue = result.groups[index]?.values[aggregationId]
    const primaryPoint: ChartDataPoint = {
      category: dimension?.label ?? 'Total',
      value: typeof rawValue === 'number' ? rawValue : Number(rawValue ?? 0),
      series: seriesDimension?.label ?? 'Value',
    }
    if (!query.secondaryAggregation) return [primaryPoint]
    const rawSecondaryValue = result.groups[index]?.values[secondaryAggregationId]
    const secondaryValue = typeof rawSecondaryValue === 'number'
      ? rawSecondaryValue
      : Number(rawSecondaryValue ?? 0)
    primaryPoint.secondaryValue = secondaryValue
    primaryPoint.x = primaryPoint.value
    primaryPoint.y = secondaryValue
    return [
      primaryPoint,
      {
        category: dimension?.label ?? 'Total',
        value: secondaryValue,
        series: 'Secondary',
      },
    ]
  })
  if (query.resultTransform === 'percentOfTotal') {
    const totals = new Map<string, number>()
    points.forEach((point) => {
      const series = point.series ?? 'Value'
      totals.set(series, (totals.get(series) ?? 0) + point.value)
    })
    points = points.map((point) => ({
      ...point,
      value: (point.value / Math.max(1, totals.get(point.series ?? 'Value') ?? 0)) * 100,
    }))
  } else if (query.resultTransform === 'runningTotal') {
    const totals = new Map<string, number>()
    points = points.map((point) => {
      const series = point.series ?? 'Value'
      const value = (totals.get(series) ?? 0) + point.value
      totals.set(series, value)
      return { ...point, value }
    })
  }
  if (query.secondaryAggregation) {
    points = points.map((point) => {
      if (point.series === 'Secondary') return point
      const secondary = points.find((candidate) =>
        candidate.series === 'Secondary' && candidate.category === point.category)
      if (!secondary) return point
      return {
        ...point,
        secondaryValue: secondary.value,
        x: point.value,
        y: secondary.value,
      }
    })
  }
  return { result, points, fields, records }
}

export function displayCell(value: ProfiledRawValue): string {
  if (value === null) return ''
  if (value instanceof Date) return value.toLocaleDateString()
  if (typeof value === 'number') return value.toLocaleString()
  return String(value)
}
