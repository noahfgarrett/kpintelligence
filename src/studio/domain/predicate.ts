import {
  coerceCell,
  coerceLiteral,
  compareCoerced,
  isBlankCell,
  type CoercedValue,
} from './coercion'
import type {
  FieldDataTypeV1,
  FieldV1,
  PredicateConditionV1,
  PredicateV1,
  PredicateValueOperatorV1,
} from './model'

export const MAX_PREDICATE_DEPTH = 20

export interface PredicateValidationIssue {
  path: string
  message: string
}

export interface PredicateCoercionIssue {
  fieldId: string
  reason: string
}

export interface PredicateEvaluation {
  matches: boolean
  coercionIssues: PredicateCoercionIssue[]
}

export class PredicateValidationError extends Error {
  readonly issues: PredicateValidationIssue[]

  constructor(issues: PredicateValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'))
    this.name = 'PredicateValidationError'
    this.issues = issues
  }
}

const TEXT_OPERATORS: ReadonlySet<PredicateConditionV1['operator']> = new Set([
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'oneOf',
  'notOneOf',
  'isBlank',
  'isNotBlank',
])

const ORDERED_OPERATORS: ReadonlySet<PredicateConditionV1['operator']> = new Set([
  'equals',
  'notEquals',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'oneOf',
  'notOneOf',
  'between',
  'isBlank',
  'isNotBlank',
])

const BOOLEAN_OPERATORS: ReadonlySet<PredicateConditionV1['operator']> = new Set([
  'equals',
  'notEquals',
  'oneOf',
  'notOneOf',
  'isBlank',
  'isNotBlank',
])

function allowedOperators(
  dataType: FieldDataTypeV1,
): ReadonlySet<PredicateConditionV1['operator']> {
  if (dataType === 'text') return TEXT_OPERATORS
  if (dataType === 'boolean') return BOOLEAN_OPERATORS
  return ORDERED_OPERATORS
}

export function createFieldMap(fields: readonly FieldV1[]): ReadonlyMap<string, FieldV1> {
  const map = new Map<string, FieldV1>()
  for (const field of fields) {
    if (map.has(field.id)) {
      throw new PredicateValidationError([
        { path: 'fields', message: `Field ID "${field.id}" is duplicated.` },
      ])
    }
    map.set(field.id, field)
  }
  return map
}

export function resolveFieldMap(
  fields: readonly FieldV1[] | ReadonlyMap<string, FieldV1>,
): ReadonlyMap<string, FieldV1> {
  return Array.isArray(fields)
    ? createFieldMap(fields)
    : (fields as ReadonlyMap<string, FieldV1>)
}

function conditionLiterals(condition: PredicateConditionV1) {
  if ('values' in condition) return condition.values
  if ('lower' in condition) return [condition.lower, condition.upper]
  if ('value' in condition) return [condition.value]
  return []
}

function validateNode(
  predicate: PredicateV1,
  fieldMap: ReadonlyMap<string, FieldV1>,
  path: string,
  depth: number,
  issues: PredicateValidationIssue[],
): void {
  if (depth > MAX_PREDICATE_DEPTH) {
    issues.push({
      path,
      message: `Predicate nesting exceeds ${MAX_PREDICATE_DEPTH} levels.`,
    })
    return
  }

  if (predicate.kind === 'group') {
    if (predicate.predicates.length === 0) {
      issues.push({ path, message: 'Predicate groups cannot be empty.' })
    }
    predicate.predicates.forEach((child, index) => {
      validateNode(child, fieldMap, `${path}.predicates[${index}]`, depth + 1, issues)
    })
    return
  }

  const field = fieldMap.get(predicate.fieldId)
  if (field === undefined) {
    issues.push({
      path: `${path}.fieldId`,
      message: `Field "${predicate.fieldId}" does not exist.`,
    })
    return
  }
  if (!allowedOperators(field.dataType).has(predicate.operator)) {
    issues.push({
      path: `${path}.operator`,
      message: `Operator "${predicate.operator}" is not valid for ${field.dataType} fields.`,
    })
  }

  const literals = conditionLiterals(predicate)
  if (
    (predicate.operator === 'oneOf' || predicate.operator === 'notOneOf') &&
    literals.length === 0
  ) {
    issues.push({ path: `${path}.values`, message: 'At least one value is required.' })
  }
  literals.forEach((literal, index) => {
    if (literal.dataType !== field.dataType) {
      issues.push({
        path: `${path}.value${literals.length > 1 ? `[${index}]` : ''}`,
        message: `Expected a ${field.dataType} value, received ${literal.dataType}.`,
      })
    } else if (coerceLiteral(literal) === null) {
      issues.push({
        path: `${path}.value${literals.length > 1 ? `[${index}]` : ''}`,
        message: `The ${literal.dataType} value is invalid.`,
      })
    }
  })

  if (predicate.operator === 'between') {
    const lower = coerceLiteral(predicate.lower)
    const upper = coerceLiteral(predicate.upper)
    if (
      lower !== null &&
      upper !== null &&
      compareCoerced(lower, upper, field.dataType) > 0
    ) {
      issues.push({
        path,
        message: 'The lower bound cannot be greater than the upper bound.',
      })
    }
  }
}

export function validatePredicate(
  predicate: PredicateV1,
  fields: readonly FieldV1[] | ReadonlyMap<string, FieldV1>,
): PredicateValidationIssue[] {
  const fieldMap = resolveFieldMap(fields)
  const issues: PredicateValidationIssue[] = []
  validateNode(predicate, fieldMap, 'predicate', 1, issues)
  return issues
}

function assertValidPredicate(
  predicate: PredicateV1,
  fieldMap: ReadonlyMap<string, FieldV1>,
): void {
  const issues = validatePredicate(predicate, fieldMap)
  if (issues.length > 0) throw new PredicateValidationError(issues)
}

function normalizeText(value: CoercedValue, caseSensitive: boolean): string {
  const text = String(value.comparable)
  return caseSensitive ? text : text.toLowerCase()
}

function evaluateValueOperator(
  operator: PredicateValueOperatorV1,
  left: CoercedValue,
  right: CoercedValue,
  field: FieldV1,
  caseSensitive: boolean,
): boolean {
  const comparison = compareCoerced(left, right, field.dataType, caseSensitive)
  switch (operator) {
    case 'equals':
      return comparison === 0
    case 'notEquals':
      return comparison !== 0
    case 'greaterThan':
      return comparison > 0
    case 'greaterThanOrEqual':
      return comparison >= 0
    case 'lessThan':
      return comparison < 0
    case 'lessThanOrEqual':
      return comparison <= 0
    case 'contains':
      return normalizeText(left, caseSensitive).includes(
        normalizeText(right, caseSensitive),
      )
    case 'notContains':
      return !normalizeText(left, caseSensitive).includes(
        normalizeText(right, caseSensitive),
      )
    case 'startsWith':
      return normalizeText(left, caseSensitive).startsWith(
        normalizeText(right, caseSensitive),
      )
    case 'endsWith':
      return normalizeText(left, caseSensitive).endsWith(
        normalizeText(right, caseSensitive),
      )
  }
}

function evaluateCondition(
  condition: PredicateConditionV1,
  row: Readonly<Record<string, unknown>>,
  fieldMap: ReadonlyMap<string, FieldV1>,
): PredicateEvaluation {
  const field = fieldMap.get(condition.fieldId)
  if (field === undefined) {
    return {
      matches: false,
      coercionIssues: [
        { fieldId: condition.fieldId, reason: 'The referenced field does not exist.' },
      ],
    }
  }
  const rawValue = row[field.sourceColumn]

  if (condition.operator === 'isBlank') {
    return { matches: isBlankCell(rawValue, field), coercionIssues: [] }
  }
  if (condition.operator === 'isNotBlank') {
    return { matches: !isBlankCell(rawValue, field), coercionIssues: [] }
  }

  const cell = coerceCell(rawValue, field)
  if (cell.status === 'blank') return { matches: false, coercionIssues: [] }
  if (cell.status === 'invalid') {
    return {
      matches: false,
      coercionIssues: [{ fieldId: field.id, reason: cell.reason }],
    }
  }

  const caseSensitive = 'caseSensitive' in condition && condition.caseSensitive === true
  if (condition.operator === 'oneOf' || condition.operator === 'notOneOf') {
    const matchesOne = condition.values.some((literal) => {
      const value = coerceLiteral(literal)
      return (
        value !== null &&
        compareCoerced(cell.coerced, value, field.dataType, caseSensitive) === 0
      )
    })
    return {
      matches: condition.operator === 'oneOf' ? matchesOne : !matchesOne,
      coercionIssues: [],
    }
  }

  if (condition.operator === 'between') {
    const lower = coerceLiteral(condition.lower)
    const upper = coerceLiteral(condition.upper)
    if (lower === null || upper === null) return { matches: false, coercionIssues: [] }
    const lowerComparison = compareCoerced(cell.coerced, lower, field.dataType)
    const upperComparison = compareCoerced(cell.coerced, upper, field.dataType)
    return {
      matches: condition.inclusive
        ? lowerComparison >= 0 && upperComparison <= 0
        : lowerComparison > 0 && upperComparison < 0,
      coercionIssues: [],
    }
  }

  if (!('value' in condition)) return { matches: false, coercionIssues: [] }
  const value = coerceLiteral(condition.value)
  return {
    matches:
      value !== null &&
      evaluateValueOperator(
        condition.operator,
        cell.coerced,
        value,
        field,
        caseSensitive,
      ),
    coercionIssues: [],
  }
}

function evaluateNode(
  predicate: PredicateV1,
  row: Readonly<Record<string, unknown>>,
  fieldMap: ReadonlyMap<string, FieldV1>,
): PredicateEvaluation {
  if (predicate.kind === 'condition') {
    return evaluateCondition(predicate, row, fieldMap)
  }

  const children = predicate.predicates.map((child) =>
    evaluateNode(child, row, fieldMap),
  )
  return {
    matches:
      predicate.mode === 'all'
        ? children.every((child) => child.matches)
        : children.some((child) => child.matches),
    coercionIssues: children.flatMap((child) => child.coercionIssues),
  }
}

export interface PredicateEvaluator {
  evaluate(row: Readonly<Record<string, unknown>>): PredicateEvaluation
}

export function createPredicateEvaluator(
  predicate: PredicateV1,
  fields: readonly FieldV1[] | ReadonlyMap<string, FieldV1>,
): PredicateEvaluator {
  const fieldMap = resolveFieldMap(fields)
  assertValidPredicate(predicate, fieldMap)
  return {
    evaluate: (row) => evaluateNode(predicate, row, fieldMap),
  }
}

export function evaluatePredicate(
  predicate: PredicateV1,
  row: Readonly<Record<string, unknown>>,
  fields: readonly FieldV1[] | ReadonlyMap<string, FieldV1>,
): PredicateEvaluation {
  return createPredicateEvaluator(predicate, fields).evaluate(row)
}
