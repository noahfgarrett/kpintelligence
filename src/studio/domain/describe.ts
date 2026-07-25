import type {
  AggregationV1,
  FieldV1,
  PredicateConditionV1,
  PredicateV1,
  QuerySpecV1,
  ScalarLiteralV1,
} from './model'
import { resolveFieldMap } from './predicate'

function fieldName(fieldId: string, fields: ReadonlyMap<string, FieldV1>): string {
  return fields.get(fieldId)?.name ?? `[Missing field: ${fieldId}]`
}

function literalText(literal: ScalarLiteralV1): string {
  switch (literal.dataType) {
    case 'text':
      return JSON.stringify(literal.value)
    case 'number':
      return String(literal.value)
    case 'boolean':
      return literal.value ? 'Yes' : 'No'
    case 'date':
    case 'datetime':
    case 'workWeek':
      return JSON.stringify(literal.value)
  }
}

function joinEnglish(items: string[], conjunction: 'and' | 'or'): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, ${conjunction} ${
    items[items.length - 1]
  }`
}

function describeCondition(
  condition: PredicateConditionV1,
  fields: ReadonlyMap<string, FieldV1>,
): string {
  const name = fieldName(condition.fieldId, fields)
  switch (condition.operator) {
    case 'isBlank':
      return `${name} is blank`
    case 'isNotBlank':
      return `${name} is not blank`
    case 'equals':
      return `${name} is ${literalText(condition.value)}`
    case 'notEquals':
      return `${name} is not ${literalText(condition.value)}`
    case 'greaterThan':
      return `${name} is greater than ${literalText(condition.value)}`
    case 'greaterThanOrEqual':
      return `${name} is at least ${literalText(condition.value)}`
    case 'lessThan':
      return `${name} is less than ${literalText(condition.value)}`
    case 'lessThanOrEqual':
      return `${name} is at most ${literalText(condition.value)}`
    case 'contains':
      return `${name} contains ${literalText(condition.value)}`
    case 'notContains':
      return `${name} does not contain ${literalText(condition.value)}`
    case 'startsWith':
      return `${name} starts with ${literalText(condition.value)}`
    case 'endsWith':
      return `${name} ends with ${literalText(condition.value)}`
    case 'oneOf':
      return `${name} is one of ${joinEnglish(
        condition.values.map(literalText),
        'or',
      )}`
    case 'notOneOf':
      return `${name} is none of ${joinEnglish(
        condition.values.map(literalText),
        'or',
      )}`
    case 'between':
      return condition.inclusive
        ? `${name} is from ${literalText(condition.lower)} through ${literalText(
            condition.upper,
          )}`
        : `${name} is between ${literalText(condition.lower)} and ${literalText(
            condition.upper,
          )}, excluding both bounds`
  }
}

function describePredicateNode(
  predicate: PredicateV1,
  fields: ReadonlyMap<string, FieldV1>,
  nested: boolean,
): string {
  if (predicate.kind === 'condition') return describeCondition(predicate, fields)
  const description = joinEnglish(
    predicate.predicates.map((child) => describePredicateNode(child, fields, true)),
    predicate.mode === 'all' ? 'and' : 'or',
  )
  return nested && predicate.predicates.length > 1 ? `(${description})` : description
}

export function describePredicate(
  predicate: PredicateV1,
  fields: readonly FieldV1[] | ReadonlyMap<string, FieldV1>,
): string {
  const fieldMap = resolveFieldMap(fields)
  return describePredicateNode(predicate, fieldMap, false)
}

export function describeAggregation(
  aggregation: AggregationV1,
  fields: readonly FieldV1[] | ReadonlyMap<string, FieldV1>,
): string {
  const fieldMap = resolveFieldMap(fields)
  const name =
    aggregation.fieldId === undefined
      ? ''
      : fieldName(aggregation.fieldId, fieldMap)
  let description: string

  switch (aggregation.operation) {
    case 'countRows':
      description = 'Count rows'
      break
    case 'countNonEmpty':
      description = `Count non-empty ${name}`
      break
    case 'distinctCount':
      description = `Count distinct ${name}`
      break
    case 'sum':
      description = `Sum ${name}`
      break
    case 'average':
      description = `Average ${name}`
      break
    case 'min':
      description = `Minimum ${name}`
      break
    case 'max':
      description = `Maximum ${name}`
      break
    case 'first':
      description = `First ${name}`
      break
    case 'last':
      description = `Last ${name}`
      break
  }

  if (aggregation.where !== undefined) {
    description += ` where ${describePredicateNode(aggregation.where, fieldMap, false)}`
  }
  if (aggregation.orderBy !== undefined) {
    description += ` ordered by ${fieldName(
      aggregation.orderBy.fieldId,
      fieldMap,
    )} ${aggregation.orderBy.direction}`
  }
  return description
}

export function describeQuery(
  query: QuerySpecV1,
  fields: readonly FieldV1[] | ReadonlyMap<string, FieldV1>,
): string {
  const fieldMap = resolveFieldMap(fields)
  let description = joinEnglish(
    query.aggregations.map((aggregation) =>
      describeAggregation(aggregation, fieldMap),
    ),
    'and',
  )

  if (query.groupBy.length > 0) {
    description += `, grouped by ${joinEnglish(
      query.groupBy.map((group) => fieldName(group.fieldId, fieldMap)),
      'and',
    )}`
  }
  if (query.where !== undefined) {
    description += `, where ${describePredicateNode(query.where, fieldMap, false)}`
  }
  return `${description}.`
}
