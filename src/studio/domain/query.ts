import {
  coerceCell,
  coercedKey,
  compareCoerced,
  isBlankCell,
  type CoercedValue,
} from './coercion'
import type {
  AggregationOperationV1,
  AggregationV1,
  FieldV1,
  PredicateV1,
  QueryOrderV1,
  QueryScalar,
  QuerySpecV1,
} from './model'
import {
  createFieldMap,
  createPredicateEvaluator,
  validatePredicate,
  type PredicateCoercionIssue,
  type PredicateEvaluator,
} from './predicate'

export const DEFAULT_MAX_QUERY_ROWS = 250_000
export const MAX_QUERY_GROUP_FIELDS = 8
export const MAX_QUERY_AGGREGATIONS = 100

export interface QueryValidationIssue {
  path: string
  message: string
}

export class QueryValidationError extends Error {
  readonly issues: QueryValidationIssue[]

  constructor(issues: QueryValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'))
    this.name = 'QueryValidationError'
    this.issues = issues
  }
}

export class QueryExecutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueryExecutionError'
  }
}

export type CoercionPhase =
  | 'queryFilter'
  | 'grouping'
  | 'aggregationFilter'
  | 'aggregationValue'
  | 'aggregationOrder'

export interface QueryCoercionDiagnostic {
  rowIndex: number
  fieldId: string
  phase: CoercionPhase
  reason: string
  aggregationId?: string
}

export interface AggregationDiagnostics {
  aggregationId: string
  candidateRows: number
  filteredOutRows: number
  orderExcludedRows: number
  includedRows: number
  blankValues: number
  invalidValues: number
}

export interface QueryDiagnostics {
  totalRows: number
  matchedRows: number
  excludedRows: number
  matchedRowIndices: number[]
  excludedRowIndices: number[]
  predicateCoercionFailures: number
  totalCoercionIssues: number
  coercionIssues: QueryCoercionDiagnostic[]
  coercionIssuesTruncated: boolean
  aggregations: Record<string, AggregationDiagnostics>
}

export interface QueryGroupDimension {
  fieldId: string
  value: QueryScalar | null
  label: string
  status: 'value' | 'blank' | 'invalid'
}

export interface QueryGroupResult {
  key: string
  dimensions: Record<string, QueryGroupDimension>
  rowCount: number
  values: Record<string, QueryScalar | null>
}

export interface QueryResult {
  schemaVersion: 1
  queryId: string
  datasetId: string
  groups: QueryGroupResult[]
  diagnostics: QueryDiagnostics
}

export interface QueryExecutionOptions {
  maxRows?: number
  diagnosticSampleLimit?: number
}

export interface QueryExecutionInput {
  query: QuerySpecV1
  fields: readonly FieldV1[]
  rows: readonly Readonly<Record<string, unknown>>[]
  options?: QueryExecutionOptions
}

interface IndexedRow {
  rowIndex: number
  row: Readonly<Record<string, unknown>>
}

interface InternalDimension extends QueryGroupDimension {
  sortValue: QueryScalar | null
}

interface InternalGroup {
  key: string
  dimensions: Record<string, InternalDimension>
  rows: IndexedRow[]
  values: Record<string, QueryScalar | null>
  valueSortKeys: Record<string, QueryScalar | null>
}

interface AggregateEvaluation {
  value: QueryScalar | null
  sortValue: QueryScalar | null
}

interface DiagnosticCollector {
  diagnostics: QueryDiagnostics
  sampleLimit: number
  addCoercionIssue(issue: QueryCoercionDiagnostic): void
}

const OPERATIONS_REQUIRING_FIELD: ReadonlySet<AggregationOperationV1> = new Set([
  'countNonEmpty',
  'distinctCount',
  'sum',
  'average',
  'min',
  'max',
  'first',
  'last',
])

function toQueryIssues(
  path: string,
  issues: ReturnType<typeof validatePredicate>,
): QueryValidationIssue[] {
  return issues.map((issue) => ({
    path: `${path}.${issue.path}`,
    message: issue.message,
  }))
}

function referencedPredicateFieldIds(
  predicate: PredicateV1,
  fieldIds = new Set<string>(),
): Set<string> {
  if (predicate.kind === 'condition') {
    fieldIds.add(predicate.fieldId)
  } else {
    predicate.predicates.forEach((child) =>
      referencedPredicateFieldIds(child, fieldIds),
    )
  }
  return fieldIds
}

function validatePredicateDataset(
  predicate: PredicateV1,
  path: string,
  datasetId: string,
  fieldMap: ReadonlyMap<string, FieldV1>,
): QueryValidationIssue[] {
  const issues: QueryValidationIssue[] = []
  for (const fieldId of referencedPredicateFieldIds(predicate)) {
    const field = fieldMap.get(fieldId)
    if (field !== undefined && field.datasetId !== datasetId) {
      issues.push({
        path,
        message: `Predicate field "${fieldId}" belongs to another dataset.`,
      })
    }
  }
  return issues
}

export function validateQuery(
  query: QuerySpecV1,
  fields: readonly FieldV1[],
): QueryValidationIssue[] {
  const issues: QueryValidationIssue[] = []
  const fieldMap = createFieldMap(fields)

  if (query.schemaVersion !== 1) {
    issues.push({ path: 'query.schemaVersion', message: 'Only schema version 1 is supported.' })
  }
  if (query.groupBy.length > MAX_QUERY_GROUP_FIELDS) {
    issues.push({
      path: 'query.groupBy',
      message: `A query can group by at most ${MAX_QUERY_GROUP_FIELDS} fields.`,
    })
  }
  if (query.aggregations.length === 0) {
    issues.push({
      path: 'query.aggregations',
      message: 'At least one aggregation is required.',
    })
  }
  if (query.aggregations.length > MAX_QUERY_AGGREGATIONS) {
    issues.push({
      path: 'query.aggregations',
      message: `A query can contain at most ${MAX_QUERY_AGGREGATIONS} aggregations.`,
    })
  }
  if (
    query.limit !== undefined &&
    (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 10_000)
  ) {
    issues.push({
      path: 'query.limit',
      message: 'Limit must be an integer from 1 through 10,000.',
    })
  }

  const groupedFieldIds = new Set<string>()
  query.groupBy.forEach((group, index) => {
    if (groupedFieldIds.has(group.fieldId)) {
      issues.push({
        path: `query.groupBy[${index}].fieldId`,
        message: `Field "${group.fieldId}" is grouped more than once.`,
      })
    }
    groupedFieldIds.add(group.fieldId)
    const field = fieldMap.get(group.fieldId)
    if (field === undefined) {
      issues.push({
        path: `query.groupBy[${index}].fieldId`,
        message: `Field "${group.fieldId}" does not exist.`,
      })
    } else if (field.datasetId !== query.datasetId) {
      issues.push({
        path: `query.groupBy[${index}].fieldId`,
        message: `Field "${group.fieldId}" belongs to another dataset.`,
      })
    }
  })

  if (query.where !== undefined) {
    issues.push(...toQueryIssues('query.where', validatePredicate(query.where, fieldMap)))
    issues.push(
      ...validatePredicateDataset(
        query.where,
        'query.where',
        query.datasetId,
        fieldMap,
      ),
    )
  }

  const aggregationIds = new Set<string>()
  query.aggregations.forEach((aggregation, index) => {
    const path = `query.aggregations[${index}]`
    if (aggregation.schemaVersion !== 1) {
      issues.push({ path: `${path}.schemaVersion`, message: 'Only version 1 is supported.' })
    }
    if (aggregationIds.has(aggregation.id)) {
      issues.push({
        path: `${path}.id`,
        message: `Aggregation ID "${aggregation.id}" is duplicated.`,
      })
    }
    aggregationIds.add(aggregation.id)

    const requiresField = OPERATIONS_REQUIRING_FIELD.has(aggregation.operation)
    if (requiresField && aggregation.fieldId === undefined) {
      issues.push({
        path: `${path}.fieldId`,
        message: `${aggregation.operation} requires a field.`,
      })
    }
    if (aggregation.operation === 'countRows' && aggregation.fieldId !== undefined) {
      issues.push({
        path: `${path}.fieldId`,
        message: 'countRows does not accept a field.',
      })
    }

    const field =
      aggregation.fieldId === undefined ? undefined : fieldMap.get(aggregation.fieldId)
    if (aggregation.fieldId !== undefined && field === undefined) {
      issues.push({
        path: `${path}.fieldId`,
        message: `Field "${aggregation.fieldId}" does not exist.`,
      })
    }
    if (field !== undefined && field.datasetId !== query.datasetId) {
      issues.push({
        path: `${path}.fieldId`,
        message: `Field "${field.id}" belongs to another dataset.`,
      })
    }
    if (
      field !== undefined &&
      (aggregation.operation === 'sum' || aggregation.operation === 'average') &&
      field.dataType !== 'number'
    ) {
      issues.push({
        path: `${path}.fieldId`,
        message: `${aggregation.operation} requires a number field.`,
      })
    }
    if (
      field !== undefined &&
      (aggregation.operation === 'min' || aggregation.operation === 'max') &&
      field.dataType === 'boolean'
    ) {
      issues.push({
        path: `${path}.fieldId`,
        message: `${aggregation.operation} cannot use a boolean field.`,
      })
    }

    if (aggregation.where !== undefined) {
      issues.push(
        ...toQueryIssues(`${path}.where`, validatePredicate(aggregation.where, fieldMap)),
      )
      issues.push(
        ...validatePredicateDataset(
          aggregation.where,
          `${path}.where`,
          query.datasetId,
          fieldMap,
        ),
      )
    }
    if (
      aggregation.orderBy !== undefined &&
      aggregation.operation !== 'first' &&
      aggregation.operation !== 'last'
    ) {
      issues.push({
        path: `${path}.orderBy`,
        message: 'Only first and last aggregations can specify row ordering.',
      })
    }
    if (aggregation.orderBy !== undefined) {
      const orderField = fieldMap.get(aggregation.orderBy.fieldId)
      if (orderField === undefined) {
        issues.push({
          path: `${path}.orderBy.fieldId`,
          message: `Field "${aggregation.orderBy.fieldId}" does not exist.`,
        })
      } else if (orderField.datasetId !== query.datasetId) {
        issues.push({
          path: `${path}.orderBy.fieldId`,
          message: `Field "${orderField.id}" belongs to another dataset.`,
        })
      }
    }
  })

  query.orderBy?.forEach((order, index) => {
    if (order.by === 'group') {
      if (!groupedFieldIds.has(order.fieldId)) {
        issues.push({
          path: `query.orderBy[${index}].fieldId`,
          message: `Field "${order.fieldId}" is not in groupBy.`,
        })
      }
    } else if (!aggregationIds.has(order.aggregationId)) {
      issues.push({
        path: `query.orderBy[${index}].aggregationId`,
        message: `Aggregation "${order.aggregationId}" does not exist.`,
      })
    }
  })

  return issues
}

function assertValidQuery(query: QuerySpecV1, fields: readonly FieldV1[]): void {
  const issues = validateQuery(query, fields)
  if (issues.length > 0) throw new QueryValidationError(issues)
}

function createDiagnostics(
  rows: readonly Readonly<Record<string, unknown>>[],
  aggregations: readonly AggregationV1[],
  sampleLimit: number,
): DiagnosticCollector {
  const diagnostics: QueryDiagnostics = {
    totalRows: rows.length,
    matchedRows: 0,
    excludedRows: 0,
    matchedRowIndices: [],
    excludedRowIndices: [],
    predicateCoercionFailures: 0,
    totalCoercionIssues: 0,
    coercionIssues: [],
    coercionIssuesTruncated: false,
    aggregations: Object.fromEntries(
      aggregations.map((aggregation) => [
        aggregation.id,
        {
          aggregationId: aggregation.id,
          candidateRows: 0,
          filteredOutRows: 0,
          orderExcludedRows: 0,
          includedRows: 0,
          blankValues: 0,
          invalidValues: 0,
        },
      ]),
    ),
  }
  return {
    diagnostics,
    sampleLimit,
    addCoercionIssue(issue) {
      diagnostics.totalCoercionIssues += 1
      if (diagnostics.coercionIssues.length < sampleLimit) {
        diagnostics.coercionIssues.push(issue)
      } else {
        diagnostics.coercionIssuesTruncated = true
      }
    },
  }
}

function addPredicateIssues(
  collector: DiagnosticCollector,
  rowIndex: number,
  phase: Extract<CoercionPhase, 'queryFilter' | 'aggregationFilter'>,
  issues: PredicateCoercionIssue[],
  aggregationId?: string,
): void {
  for (const issue of issues) {
    if (phase === 'queryFilter') collector.diagnostics.predicateCoercionFailures += 1
    collector.addCoercionIssue({
      rowIndex,
      fieldId: issue.fieldId,
      phase,
      reason: issue.reason,
      aggregationId,
    })
  }
}

function groupDimension(
  indexedRow: IndexedRow,
  field: FieldV1,
  collector: DiagnosticCollector,
): InternalDimension {
  const cell = coerceCell(indexedRow.row[field.sourceColumn], field)
  if (cell.status === 'blank') {
    return {
      fieldId: field.id,
      value: null,
      sortValue: null,
      label: 'Blank',
      status: 'blank',
    }
  }
  if (cell.status === 'invalid') {
    collector.addCoercionIssue({
      rowIndex: indexedRow.rowIndex,
      fieldId: field.id,
      phase: 'grouping',
      reason: cell.reason,
    })
    return {
      fieldId: field.id,
      value: null,
      sortValue: null,
      label: 'Invalid',
      status: 'invalid',
    }
  }
  return {
    fieldId: field.id,
    value: cell.coerced.value,
    sortValue: cell.coerced.comparable,
    label: cell.coerced.display,
    status: 'value',
  }
}

function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

function buildGroups(
  query: QuerySpecV1,
  rows: IndexedRow[],
  fieldMap: ReadonlyMap<string, FieldV1>,
  collector: DiagnosticCollector,
): InternalGroup[] {
  if (query.groupBy.length === 0) {
    return [
      {
        key: 'all',
        dimensions: emptyRecord<InternalDimension>(),
        rows,
        values: emptyRecord<QueryScalar | null>(),
        valueSortKeys: emptyRecord<QueryScalar | null>(),
      },
    ]
  }

  const groups = new Map<string, InternalGroup>()
  for (const indexedRow of rows) {
    const dimensions = emptyRecord<InternalDimension>()
    for (const group of query.groupBy) {
      const field = fieldMap.get(group.fieldId)
      if (field === undefined) continue
      const dimension = groupDimension(indexedRow, field, collector)
      dimensions[field.id] = dimension
    }
    const key = JSON.stringify(
      query.groupBy.map(({ fieldId }) => {
        const dimension = dimensions[fieldId]
        return [fieldId, dimension?.status ?? 'missing', dimension?.sortValue ?? null]
      }),
    )
    const existing = groups.get(key)
    if (existing === undefined) {
      groups.set(key, {
        key,
        dimensions,
        rows: [indexedRow],
        values: emptyRecord<QueryScalar | null>(),
        valueSortKeys: emptyRecord<QueryScalar | null>(),
      })
    } else {
      existing.rows.push(indexedRow)
    }
  }
  return [...groups.values()]
}

function aggregationCandidates(
  aggregation: AggregationV1,
  rows: IndexedRow[],
  evaluator: PredicateEvaluator | null,
  collector: DiagnosticCollector,
): IndexedRow[] {
  const diagnostics = collector.diagnostics.aggregations[aggregation.id]
  diagnostics.candidateRows += rows.length
  if (evaluator === null) return rows

  const candidates: IndexedRow[] = []
  for (const indexedRow of rows) {
    const evaluation = evaluator.evaluate(indexedRow.row)
    addPredicateIssues(
      collector,
      indexedRow.rowIndex,
      'aggregationFilter',
      evaluation.coercionIssues,
      aggregation.id,
    )
    if (evaluation.matches) {
      candidates.push(indexedRow)
    } else {
      diagnostics.filteredOutRows += 1
    }
  }
  return candidates
}

function orderedCandidates(
  aggregation: AggregationV1,
  rows: IndexedRow[],
  fieldMap: ReadonlyMap<string, FieldV1>,
  collector: DiagnosticCollector,
): IndexedRow[] {
  if (aggregation.orderBy === undefined) return rows
  const field = fieldMap.get(aggregation.orderBy.fieldId)
  if (field === undefined) return rows

  const diagnostics = collector.diagnostics.aggregations[aggregation.id]
  const sortable: Array<{ indexedRow: IndexedRow; orderValue: CoercedValue }> = []
  for (const indexedRow of rows) {
    const cell = coerceCell(indexedRow.row[field.sourceColumn], field)
    if (cell.status === 'value') {
      sortable.push({ indexedRow, orderValue: cell.coerced })
      continue
    }
    diagnostics.orderExcludedRows += 1
    if (cell.status === 'invalid') {
      collector.addCoercionIssue({
        rowIndex: indexedRow.rowIndex,
        fieldId: field.id,
        phase: 'aggregationOrder',
        reason: cell.reason,
        aggregationId: aggregation.id,
      })
    }
  }

  const multiplier = aggregation.orderBy.direction === 'ascending' ? 1 : -1
  sortable.sort((left, right) => {
    const comparison = compareCoerced(
      left.orderValue,
      right.orderValue,
      field.dataType,
    )
    return comparison === 0
      ? left.indexedRow.rowIndex - right.indexedRow.rowIndex
      : comparison * multiplier
  })
  return sortable.map((item) => item.indexedRow)
}

function evaluateAggregation(
  aggregation: AggregationV1,
  rows: IndexedRow[],
  evaluator: PredicateEvaluator | null,
  fieldMap: ReadonlyMap<string, FieldV1>,
  collector: DiagnosticCollector,
): AggregateEvaluation {
  const diagnostics = collector.diagnostics.aggregations[aggregation.id]
  let candidates = aggregationCandidates(aggregation, rows, evaluator, collector)

  if (aggregation.operation === 'countRows') {
    diagnostics.includedRows += candidates.length
    return { value: candidates.length, sortValue: candidates.length }
  }

  const field =
    aggregation.fieldId === undefined ? undefined : fieldMap.get(aggregation.fieldId)
  if (field === undefined) return { value: null, sortValue: null }

  if (aggregation.operation === 'countNonEmpty') {
    let count = 0
    for (const indexedRow of candidates) {
      if (isBlankCell(indexedRow.row[field.sourceColumn], field)) {
        diagnostics.blankValues += 1
      } else {
        count += 1
        diagnostics.includedRows += 1
      }
    }
    return { value: count, sortValue: count }
  }

  if (aggregation.operation === 'first' || aggregation.operation === 'last') {
    candidates = orderedCandidates(aggregation, candidates, fieldMap, collector)
  }

  const values: CoercedValue[] = []
  for (const indexedRow of candidates) {
    const cell = coerceCell(indexedRow.row[field.sourceColumn], field)
    if (cell.status === 'blank') {
      diagnostics.blankValues += 1
      continue
    }
    if (cell.status === 'invalid') {
      diagnostics.invalidValues += 1
      collector.addCoercionIssue({
        rowIndex: indexedRow.rowIndex,
        fieldId: field.id,
        phase: 'aggregationValue',
        reason: cell.reason,
        aggregationId: aggregation.id,
      })
      continue
    }
    diagnostics.includedRows += 1
    values.push(cell.coerced)
  }

  switch (aggregation.operation) {
    case 'distinctCount': {
      const distinct = new Set(
        values.map((value) => coercedKey(value, field.dataType)),
      ).size
      return { value: distinct, sortValue: distinct }
    }
    case 'sum': {
      const sum = values.reduce((total, value) => total + Number(value.value), 0)
      return { value: sum, sortValue: sum }
    }
    case 'average': {
      if (values.length === 0) return { value: null, sortValue: null }
      const average =
        values.reduce((total, value) => total + Number(value.value), 0) / values.length
      return { value: average, sortValue: average }
    }
    case 'min':
    case 'max': {
      if (values.length === 0) return { value: null, sortValue: null }
      let selected = values[0]
      for (let index = 1; index < values.length; index += 1) {
        const comparison = compareCoerced(values[index], selected, field.dataType)
        if (
          (aggregation.operation === 'min' && comparison < 0) ||
          (aggregation.operation === 'max' && comparison > 0)
        ) {
          selected = values[index]
        }
      }
      return { value: selected.value, sortValue: selected.comparable }
    }
    case 'first': {
      const first = values[0]
      return first === undefined
        ? { value: null, sortValue: null }
        : { value: first.value, sortValue: first.comparable }
    }
    case 'last': {
      const last = values[values.length - 1]
      return last === undefined
        ? { value: null, sortValue: null }
        : { value: last.value, sortValue: last.comparable }
    }
  }
  throw new QueryExecutionError(`Unsupported aggregation "${aggregation.operation}".`)
}

function compareSortValues(
  left: QueryScalar | null,
  right: QueryScalar | null,
  direction: 'ascending' | 'descending',
): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1

  let comparison: number
  if (typeof left === 'number' && typeof right === 'number') {
    comparison = left === right ? 0 : left < right ? -1 : 1
  } else if (typeof left === 'boolean' && typeof right === 'boolean') {
    comparison = left === right ? 0 : left ? 1 : -1
  } else {
    comparison = String(left).localeCompare(String(right), 'en-US')
  }
  return direction === 'ascending' ? comparison : comparison * -1
}

function groupOrderValue(group: InternalGroup, order: QueryOrderV1): QueryScalar | null {
  return order.by === 'group'
    ? group.dimensions[order.fieldId]?.sortValue ?? null
    : group.valueSortKeys[order.aggregationId] ?? null
}

function sortGroups(groups: InternalGroup[], orders: readonly QueryOrderV1[]): void {
  groups.sort((left, right) => {
    for (const order of orders) {
      const comparison = compareSortValues(
        groupOrderValue(left, order),
        groupOrderValue(right, order),
        order.direction,
      )
      if (comparison !== 0) return comparison
    }
    return 0
  })
}

function publicGroup(group: InternalGroup): QueryGroupResult {
  return {
    key: group.key,
    dimensions: Object.fromEntries(
      Object.entries(group.dimensions).map(([fieldId, dimension]) => [
        fieldId,
        {
          fieldId: dimension.fieldId,
          value: dimension.value,
          label: dimension.label,
          status: dimension.status,
        },
      ]),
    ),
    rowCount: group.rows.length,
    values: Object.fromEntries(Object.entries(group.values)),
  }
}

function positiveIntegerOption(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < 0) {
    throw new QueryExecutionError(`${label} must be a non-negative integer.`)
  }
  return resolved
}

export function executeQuery(input: QueryExecutionInput): QueryResult {
  const { query, fields, rows } = input
  assertValidQuery(query, fields)

  const maxRows = positiveIntegerOption(
    input.options?.maxRows,
    DEFAULT_MAX_QUERY_ROWS,
    'maxRows',
  )
  if (rows.length > maxRows) {
    throw new QueryExecutionError(
      `Query received ${rows.length} rows, exceeding the configured limit of ${maxRows}.`,
    )
  }
  const sampleLimit = positiveIntegerOption(
    input.options?.diagnosticSampleLimit,
    100,
    'diagnosticSampleLimit',
  )

  const fieldMap = createFieldMap(fields)
  const collector = createDiagnostics(rows, query.aggregations, sampleLimit)
  const queryEvaluator =
    query.where === undefined ? null : createPredicateEvaluator(query.where, fieldMap)
  const matchedRows: IndexedRow[] = []

  rows.forEach((row, rowIndex) => {
    if (queryEvaluator === null) {
      collector.diagnostics.matchedRowIndices.push(rowIndex)
      matchedRows.push({ rowIndex, row })
      return
    }
    const evaluation = queryEvaluator.evaluate(row)
    addPredicateIssues(
      collector,
      rowIndex,
      'queryFilter',
      evaluation.coercionIssues,
    )
    if (evaluation.matches) {
      collector.diagnostics.matchedRowIndices.push(rowIndex)
      matchedRows.push({ rowIndex, row })
    } else {
      collector.diagnostics.excludedRowIndices.push(rowIndex)
    }
  })
  collector.diagnostics.matchedRows = matchedRows.length
  collector.diagnostics.excludedRows = rows.length - matchedRows.length
  if (queryEvaluator === null) {
    collector.diagnostics.excludedRowIndices = []
  }

  let groups = buildGroups(query, matchedRows, fieldMap, collector)
  const aggregationEvaluators = new Map<string, PredicateEvaluator | null>()
  for (const aggregation of query.aggregations) {
    aggregationEvaluators.set(
      aggregation.id,
      aggregation.where === undefined
        ? null
        : createPredicateEvaluator(aggregation.where, fieldMap),
    )
  }

  for (const group of groups) {
    for (const aggregation of query.aggregations) {
      const result = evaluateAggregation(
        aggregation,
        group.rows,
        aggregationEvaluators.get(aggregation.id) ?? null,
        fieldMap,
        collector,
      )
      group.values[aggregation.id] = result.value
      group.valueSortKeys[aggregation.id] = result.sortValue
    }
  }

  if (query.orderBy !== undefined && query.orderBy.length > 0) {
    sortGroups(groups, query.orderBy)
  }
  if (query.limit !== undefined) groups = groups.slice(0, query.limit)

  return {
    schemaVersion: 1,
    queryId: query.id,
    datasetId: query.datasetId,
    groups: groups.map(publicGroup),
    diagnostics: collector.diagnostics,
  }
}
