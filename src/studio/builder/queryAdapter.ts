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
import { resolveWorkWeekPreset, workWeekPresetLabel } from './relativePeriods'

export interface StudioQueryOutput {
  result: QueryResult
  secondaryResult?: QueryResult
  points: ChartDataPoint[]
  fields: FieldV1[]
  records: Record<string, unknown>[]
}

export function dashboardFiltersForWidget(
  filters: DashboardFilterRecord[],
  widgetId: string,
): DashboardFilterRecord[] {
  return filters.filter((filter) => filter.sourceWidgetId !== widgetId)
}

export function resolveDashboardFilterField(
  filter: DashboardFilterRecord,
  dataset: DatasetProfile,
): FieldProfile | null {
  const binding = filter.bindings?.find((candidate) => candidate.datasetId === dataset.id)
  if (binding) {
    const exact = dataset.fields.find((field) => field.id === binding.fieldId)
    if (exact && exact.inferredType === binding.fieldType) return exact
    const keyed = dataset.fields.filter((field) =>
      field.key === binding.fieldKey && field.inferredType === binding.fieldType)
    if (keyed.length === 1) return keyed[0]
    const named = dataset.fields.filter((field) =>
      field.inferredType === binding.fieldType
      && [
        field.name,
        field.headerDisplay,
        field.key,
      ].some((name) => name.trim().toLowerCase() === binding.fieldName.trim().toLowerCase()))
    if (named.length === 1) return named[0]
    return null
  }

  const normalizedName = filter.fieldName.trim().toLowerCase()
  const expectedType = filter.fieldType ?? filter.bindings?.[0]?.fieldType
  const matches = dataset.fields.filter((candidate) =>
    (!expectedType || candidate.inferredType === expectedType)
    && (
      candidate.name.trim().toLowerCase() === normalizedName
      || candidate.headerDisplay.trim().toLowerCase() === normalizedName
      || candidate.key.trim().toLowerCase() === normalizedName
    ))
  return matches.length === 1 ? matches[0] : null
}

export function dashboardFilterConditions(
  filters: DashboardFilterRecord[],
  dataset: DatasetProfile,
  pageId?: string,
): StudioCondition[] {
  return filters.flatMap((filter) => {
    const values = filter.values === undefined
      ? filter.value ? [filter.value] : []
      : filter.values
    if (
      !filter.enabled
      || values.length === 0
      || ((filter.scope ?? 'dashboard') === 'page' && filter.pageId !== pageId)
    ) return []
    const field = resolveDashboardFilterField(filter, dataset)
    if (!field) return []
    const multiple = values.length > 1 || (filter.selectionMode ?? 'single') === 'multiple'
    const exclude = (filter.operator ?? 'include') === 'exclude'
    return [{
      id: `dashboard-${filter.id}`,
      fieldId: field.id,
      operator: multiple
        ? exclude ? 'notOneOf' : 'oneOf'
        : exclude ? 'notEquals' : 'equals',
      value: values[0] ?? '',
      values,
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
  return dataset.fields.map((field) => {
    const percent = field.inferredType === 'number'
      && field.sampleValues.some((sample) => sample.display.trim().endsWith('%'))
    return {
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
      ...(percent ? { format: { numberStyle: 'percent' as const } } : {}),
      createdAt,
      updatedAt: createdAt,
    }
  })
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
  evaluationDate: Date,
): PredicateConditionV1 {
  const preset = field.inferredType === 'workWeek'
    ? resolveWorkWeekPreset(condition.value, evaluationDate)
    : null
  const resolved = preset ? { ...condition, ...preset } : condition
  if (resolved.operator === 'isBlank' || resolved.operator === 'isNotBlank') {
    return {
      kind: 'condition',
      fieldId: field.id,
      operator: resolved.operator,
    }
  }
  if (resolved.operator === 'oneOf' || resolved.operator === 'notOneOf') {
    return {
      kind: 'condition',
      fieldId: field.id,
      operator: resolved.operator,
      values: (resolved.values ?? resolved.value
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean))
        .map((value) => scalarLiteral(fieldType(field), value)),
    }
  }
  if (resolved.operator === 'between') {
    const [lower = '', upper = ''] = resolved.value.split('..', 2)
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
    operator: resolved.operator,
    value: scalarLiteral(fieldType(field), resolved.value),
  }
}

function conditionsForDataset(
  conditions: StudioCondition[],
  dataset: DatasetProfile,
  strict: boolean,
  evaluationDate: Date,
): PredicateConditionV1[] {
  return conditions.flatMap((condition) => {
    const field = dataset.fields.find((candidate) => candidate.id === condition.fieldId)
    if (!field) {
      if (strict) {
        throw new Error('A column used by this visual is no longer available. Choose a replacement in Rules.')
      }
      return []
    }
    return [conditionPredicate(condition, field, evaluationDate)]
  })
}

function wherePredicate(
  query: StudioWidgetQuery,
  dataset: DatasetProfile,
  dashboardConditions: StudioCondition[],
  evaluationDate: Date,
): PredicateV1 | undefined {
  const localConditions = conditionsForDataset(query.conditions, dataset, true, evaluationDate)
  const globalConditions = conditionsForDataset(dashboardConditions, dataset, false, evaluationDate)
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
  const preset = query.conditions
    .map((condition) => workWeekPresetLabel(condition.value))
    .find((label): label is string => Boolean(label))
  const filterText = query.conditions.length > 0
    ? ` where ${preset ?? `${query.conditions.length} ${query.match === 'all' ? 'rule' : 'alternative'}${query.conditions.length === 1 ? '' : 's'} match`}`
    : ''
  const secondary = query.secondaryAggregation
    ? ` and ${aggregateLabels[query.secondaryAggregation]}${secondaryMeasure ? ` of ${secondaryMeasure.name}` : ''}`
    : ''
  const transform = query.metricCalculation === 'ratioPercent'
    ? ' as a percentage of the second calculation'
    : query.metricCalculation === 'difference'
      ? ' as the difference between the calculations'
      : query.resultTransform === 'percentOfTotal'
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
  evaluationDate = new Date(),
): StudioQueryOutput {
  if (query.secondaryAggregation && query.secondaryRuleMode === 'custom') {
    const primary = runStudioQuery({
      ...query,
      secondaryAggregation: null,
      secondaryMeasureFieldId: null,
      metricCalculation: 'none',
    }, dataset, dashboardConditions, evaluationDate)
    const secondary = runStudioQuery({
      ...query,
      aggregation: query.secondaryAggregation,
      measureFieldId: query.secondaryMeasureFieldId,
      secondaryAggregation: null,
      secondaryMeasureFieldId: null,
      metricCalculation: 'none',
      match: query.secondaryMatch ?? 'all',
      conditions: query.secondaryConditions ?? [],
    }, dataset, dashboardConditions, evaluationDate)
    const keyFor = (point: ChartDataPoint) => `${point.category}\u0000${point.series ?? 'Value'}`
    const secondaryValues = new Map(
      secondary.points.map((point) => [keyFor(point), point.value]),
    )
    const primaryPoints = primary.points.map((point) => ({
      ...point,
      secondaryValue: secondaryValues.get(keyFor(point)) ?? 0,
      x: point.value,
      y: secondaryValues.get(keyFor(point)) ?? 0,
    }))
    const points = applyMetricCalculation([
      ...primaryPoints,
      ...secondary.points.map((point) => ({ ...point, series: 'Secondary' })),
    ], query.metricCalculation)
    return {
      ...primary,
      secondaryResult: secondary.result,
      points,
    }
  }

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
    where: wherePredicate(query, dataset, dashboardConditions, evaluationDate),
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
      value: (totals.get(point.series ?? 'Value') ?? 0) === 0
        ? Number.NaN
        : point.value / (totals.get(point.series ?? 'Value') ?? 0) * 100,
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
  points = applyMetricCalculation(points, query.metricCalculation)
  return { result, points, fields, records }
}

function applyMetricCalculation(
  points: ChartDataPoint[],
  calculation: StudioWidgetQuery['metricCalculation'],
): ChartDataPoint[] {
  if (!calculation || calculation === 'none') return points
  return points
    .filter((point) => point.series !== 'Secondary')
    .map((point) => {
      const secondaryValue = point.secondaryValue ?? points.find((candidate) =>
        candidate.series === 'Secondary' && candidate.category === point.category)?.value ?? 0
      const primaryValue = point.value
      const value = calculation === 'ratioPercent'
        ? secondaryValue === 0 ? Number.NaN : primaryValue / secondaryValue * 100
        : primaryValue - secondaryValue
      return {
        ...point,
        primaryValue,
        secondaryValue,
        value,
      }
    })
}

export function displayCell(value: ProfiledRawValue): string {
  if (value === null) return ''
  if (value instanceof Date) return value.toLocaleDateString()
  if (typeof value === 'number') return value.toLocaleString()
  return String(value)
}
