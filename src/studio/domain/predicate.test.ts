import { describe, expect, it } from 'vitest'
import type {
  FieldDataTypeV1,
  FieldV1,
  PredicateV1,
  ScalarLiteralV1,
} from './model'
import {
  MAX_PREDICATE_DEPTH,
  PredicateValidationError,
  createPredicateEvaluator,
  evaluatePredicate,
  validatePredicate,
} from './predicate'

const timestamp = '2026-07-25T12:00:00.000Z'

function field(
  id: string,
  sourceColumn: string,
  dataType: FieldDataTypeV1,
): FieldV1 {
  return {
    kind: 'field',
    schemaVersion: 1,
    id,
    name: sourceColumn,
    createdAt: timestamp,
    updatedAt: timestamp,
    datasetId: 'inspections',
    sourceColumn,
    aliases: [],
    dataType,
    nullable: true,
    coercion: { trimText: true, emptyTextIsBlank: true },
  }
}

const fields = [
  field('phase', 'Inspection Phase', 'text'),
  field('issue', 'Issue?', 'text'),
  field('status', 'Status', 'text'),
  field('quantity', 'Quantity', 'number'),
  field('created', 'Created On', 'date'),
  field('week', 'Work Week', 'workWeek'),
  field('approved', 'Approved', 'boolean'),
] as const

function text(value: string): ScalarLiteralV1 {
  return { dataType: 'text', value }
}

describe('typed predicate evaluation', () => {
  it('supports nested all/any groups for a readable inspection rule', () => {
    const predicate: PredicateV1 = {
      kind: 'group',
      mode: 'all',
      predicates: [
        {
          kind: 'condition',
          fieldId: 'phase',
          operator: 'equals',
          value: text('Final'),
        },
        {
          kind: 'group',
          mode: 'any',
          predicates: [
            {
              kind: 'condition',
              fieldId: 'status',
              operator: 'equals',
              value: text('Open'),
            },
            {
              kind: 'condition',
              fieldId: 'status',
              operator: 'equals',
              value: text('Closed'),
            },
          ],
        },
        {
          kind: 'condition',
          fieldId: 'issue',
          operator: 'notEquals',
          value: text('No Issue Found'),
        },
        {
          kind: 'condition',
          fieldId: 'issue',
          operator: 'isNotBlank',
        },
      ],
    }
    const evaluator = createPredicateEvaluator(predicate, fields)

    expect(
      evaluator.evaluate({
        'Inspection Phase': 'final',
        'Issue?': 'BIM-100',
        Status: 'Open',
      }).matches,
    ).toBe(true)
    expect(
      evaluator.evaluate({
        'Inspection Phase': 'Pre-Final',
        'Issue?': 'BIM-100',
        Status: 'Open',
      }).matches,
    ).toBe(false)
    expect(
      evaluator.evaluate({
        'Inspection Phase': 'Final',
        'Issue?': 'No Issue Found',
        Status: 'Closed',
      }).matches,
    ).toBe(false)
  })

  it('makes text comparison case-insensitive by default and opt-in sensitive', () => {
    const insensitive: PredicateV1 = {
      kind: 'condition',
      fieldId: 'phase',
      operator: 'equals',
      value: text('FINAL'),
    }
    const sensitive: PredicateV1 = { ...insensitive, caseSensitive: true }

    expect(evaluatePredicate(insensitive, { 'Inspection Phase': 'Final' }, fields).matches).toBe(
      true,
    )
    expect(evaluatePredicate(sensitive, { 'Inspection Phase': 'Final' }, fields).matches).toBe(
      false,
    )
  })

  it.each([
    ['contains', 'Electrical Final Inspection', 'final', true],
    ['notContains', 'Electrical Final Inspection', 'mechanical', true],
    ['startsWith', 'Electrical Final Inspection', 'electrical', true],
    ['endsWith', 'Electrical Final Inspection', 'inspection', true],
  ] as const)('supports the %s text operator', (operator, actual, expected, matches) => {
    const predicate: PredicateV1 = {
      kind: 'condition',
      fieldId: 'phase',
      operator,
      value: text(expected),
    }
    expect(evaluatePredicate(predicate, { 'Inspection Phase': actual }, fields).matches).toBe(
      matches,
    )
  })

  it('supports typed sets, numeric ranges, dates, work weeks, and booleans', () => {
    const predicate: PredicateV1 = {
      kind: 'group',
      mode: 'all',
      predicates: [
        {
          kind: 'condition',
          fieldId: 'status',
          operator: 'oneOf',
          values: [text('Open'), text('Closed')],
        },
        {
          kind: 'condition',
          fieldId: 'quantity',
          operator: 'between',
          lower: { dataType: 'number', value: 10 },
          upper: { dataType: 'number', value: 20 },
          inclusive: true,
        },
        {
          kind: 'condition',
          fieldId: 'created',
          operator: 'greaterThanOrEqual',
          value: { dataType: 'date', value: '2026-07-01' },
        },
        {
          kind: 'condition',
          fieldId: 'week',
          operator: 'lessThan',
          value: { dataType: 'workWeek', value: "WW28'2026" },
        },
        {
          kind: 'condition',
          fieldId: 'approved',
          operator: 'equals',
          value: { dataType: 'boolean', value: true },
        },
      ],
    }

    expect(
      evaluatePredicate(
        predicate,
        {
          Status: 'Closed',
          Quantity: '15',
          'Created On': '7/4/2026',
          'Work Week': "WW27'2026",
          Approved: 'yes',
        },
        fields,
      ).matches,
    ).toBe(true)
  })

  it('treats blank values explicitly', () => {
    const blank: PredicateV1 = {
      kind: 'condition',
      fieldId: 'issue',
      operator: 'isBlank',
    }
    const notBlank: PredicateV1 = {
      kind: 'condition',
      fieldId: 'issue',
      operator: 'isNotBlank',
    }
    expect(evaluatePredicate(blank, { 'Issue?': '   ' }, fields).matches).toBe(true)
    expect(evaluatePredicate(notBlank, { 'Issue?': 'BIM-2' }, fields).matches).toBe(true)
  })

  it('fails closed when a cell cannot be coerced, including negative operators', () => {
    const predicate: PredicateV1 = {
      kind: 'condition',
      fieldId: 'quantity',
      operator: 'notEquals',
      value: { dataType: 'number', value: 0 },
    }
    const evaluation = evaluatePredicate(predicate, { Quantity: 'not a number' }, fields)
    expect(evaluation.matches).toBe(false)
    expect(evaluation.coercionIssues).toEqual([
      {
        fieldId: 'quantity',
        reason: 'Value is not an unambiguous finite number.',
      },
    ])
  })
})

describe('predicate validation', () => {
  it('rejects operators that do not apply to a field type', () => {
    const issues = validatePredicate(
      {
        kind: 'condition',
        fieldId: 'approved',
        operator: 'contains',
        value: { dataType: 'boolean', value: true },
      },
      fields,
    )
    expect(issues).toContainEqual(
      expect.objectContaining({
        message: 'Operator "contains" is not valid for boolean fields.',
      }),
    )
  })

  it('rejects missing fields, literal type mismatches, empty sets, and reversed ranges', () => {
    const predicate: PredicateV1 = {
      kind: 'group',
      mode: 'all',
      predicates: [
        {
          kind: 'condition',
          fieldId: 'missing',
          operator: 'isBlank',
        },
        {
          kind: 'condition',
          fieldId: 'quantity',
          operator: 'equals',
          value: text('10'),
        },
        {
          kind: 'condition',
          fieldId: 'status',
          operator: 'oneOf',
          values: [],
        },
        {
          kind: 'condition',
          fieldId: 'quantity',
          operator: 'between',
          lower: { dataType: 'number', value: 20 },
          upper: { dataType: 'number', value: 10 },
          inclusive: true,
        },
      ],
    }
    const messages = validatePredicate(predicate, fields).map((issue) => issue.message)
    expect(messages).toEqual(
      expect.arrayContaining([
        'Field "missing" does not exist.',
        'Expected a number value, received text.',
        'At least one value is required.',
        'The lower bound cannot be greater than the upper bound.',
      ]),
    )
  })

  it('rejects empty and excessively nested groups', () => {
    expect(
      validatePredicate({ kind: 'group', mode: 'all', predicates: [] }, fields),
    ).toContainEqual(
      expect.objectContaining({ message: 'Predicate groups cannot be empty.' }),
    )

    let nested: PredicateV1 = {
      kind: 'condition',
      fieldId: 'status',
      operator: 'isNotBlank',
    }
    for (let index = 0; index <= MAX_PREDICATE_DEPTH; index += 1) {
      nested = { kind: 'group', mode: 'all', predicates: [nested] }
    }
    expect(validatePredicate(nested, fields)).toContainEqual(
      expect.objectContaining({
        message: `Predicate nesting exceeds ${MAX_PREDICATE_DEPTH} levels.`,
      }),
    )
  })

  it('throws a structured validation error before evaluation', () => {
    expect(() =>
      createPredicateEvaluator(
        {
          kind: 'condition',
          fieldId: 'missing',
          operator: 'isBlank',
        },
        fields,
      ),
    ).toThrow(PredicateValidationError)
  })
})
