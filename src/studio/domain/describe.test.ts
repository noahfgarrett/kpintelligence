import { describe, expect, it } from 'vitest'
import { describeAggregation, describePredicate, describeQuery } from './describe'
import type { AggregationV1, FieldV1, PredicateV1, QuerySpecV1 } from './model'

const timestamp = '2026-07-25T12:00:00.000Z'

function field(id: string, name: string, dataType: FieldV1['dataType']): FieldV1 {
  return {
    kind: 'field',
    schemaVersion: 1,
    id,
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    datasetId: 'dataset',
    sourceColumn: name,
    aliases: [],
    dataType,
    nullable: true,
    coercion: { trimText: true, emptyTextIsBlank: true },
  }
}

const fields = [
  field('status', 'Status', 'text'),
  field('phase', 'Inspection Phase', 'text'),
  field('contractor', 'Contractor', 'text'),
  field('week', 'Work Week', 'workWeek'),
  field('amount', 'Amount', 'number'),
  field('sequence', 'Sequence', 'number'),
]

describe('plain-English query descriptions', () => {
  it('describes nested all/any logic without exposing implementation syntax', () => {
    const predicate: PredicateV1 = {
      kind: 'group',
      mode: 'all',
      predicates: [
        {
          kind: 'condition',
          fieldId: 'phase',
          operator: 'equals',
          value: { dataType: 'text', value: 'Final' },
        },
        {
          kind: 'group',
          mode: 'any',
          predicates: [
            {
              kind: 'condition',
              fieldId: 'status',
              operator: 'equals',
              value: { dataType: 'text', value: 'Open' },
            },
            {
              kind: 'condition',
              fieldId: 'status',
              operator: 'equals',
              value: { dataType: 'text', value: 'Closed' },
            },
          ],
        },
      ],
    }
    expect(describePredicate(predicate, fields)).toBe(
      'Inspection Phase is "Final" and (Status is "Open" or Status is "Closed")',
    )
  })

  it('describes all condition families', () => {
    expect(
      describePredicate(
        {
          kind: 'group',
          mode: 'all',
          predicates: [
            {
              kind: 'condition',
              fieldId: 'status',
              operator: 'notOneOf',
              values: [
                { dataType: 'text', value: 'Void' },
                { dataType: 'text', value: 'Cancelled' },
              ],
            },
            {
              kind: 'condition',
              fieldId: 'amount',
              operator: 'between',
              lower: { dataType: 'number', value: 10 },
              upper: { dataType: 'number', value: 20 },
              inclusive: true,
            },
            {
              kind: 'condition',
              fieldId: 'contractor',
              operator: 'isNotBlank',
            },
          ],
        },
        fields,
      ),
    ).toBe(
      'Status is none of "Void" or "Cancelled", Amount is from 10 through 20, and Contractor is not blank',
    )
  })

  it('describes first/last ordering and aggregation-local filters', () => {
    const aggregation: AggregationV1 = {
      schemaVersion: 1,
      id: 'last-status',
      label: 'Last status',
      operation: 'last',
      fieldId: 'status',
      where: {
        kind: 'condition',
        fieldId: 'phase',
        operator: 'equals',
        value: { dataType: 'text', value: 'Final' },
      },
      orderBy: { fieldId: 'sequence', direction: 'ascending' },
    }
    expect(describeAggregation(aggregation, fields)).toBe(
      'Last Status where Inspection Phase is "Final" ordered by Sequence ascending',
    )
  })

  it('describes a complete grouped query as one readable sentence', () => {
    const query: QuerySpecV1 = {
      schemaVersion: 1,
      id: 'query',
      datasetId: 'dataset',
      groupBy: [{ fieldId: 'contractor' }, { fieldId: 'week' }],
      aggregations: [
        {
          schemaVersion: 1,
          id: 'closed',
          label: 'Closed',
          operation: 'countRows',
          where: {
            kind: 'condition',
            fieldId: 'status',
            operator: 'equals',
            value: { dataType: 'text', value: 'Closed' },
          },
        },
        {
          schemaVersion: 1,
          id: 'average',
          label: 'Average',
          operation: 'average',
          fieldId: 'amount',
        },
      ],
      where: {
        kind: 'condition',
        fieldId: 'phase',
        operator: 'equals',
        value: { dataType: 'text', value: 'Final' },
      },
    }
    expect(describeQuery(query, fields)).toBe(
      'Count rows where Status is "Closed" and Average Amount, grouped by Contractor and Work Week, where Inspection Phase is "Final".',
    )
  })

  it('makes missing field references visible', () => {
    expect(
      describePredicate(
        {
          kind: 'condition',
          fieldId: 'gone',
          operator: 'isBlank',
        },
        fields,
      ),
    ).toBe('[Missing field: gone] is blank')
  })
})
