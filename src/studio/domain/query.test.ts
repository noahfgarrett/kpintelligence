import { describe, expect, it } from 'vitest'
import type {
  AggregationOperationV1,
  AggregationV1,
  FieldDataTypeV1,
  FieldV1,
  PredicateV1,
  QuerySpecV1,
} from './model'
import {
  QueryExecutionError,
  QueryValidationError,
  executeQuery,
  validateQuery,
} from './query'

const timestamp = '2026-07-25T12:00:00.000Z'

function field(
  id: string,
  sourceColumn: string,
  dataType: FieldDataTypeV1,
  datasetId = 'inspections',
): FieldV1 {
  return {
    kind: 'field',
    schemaVersion: 1,
    id,
    name: sourceColumn,
    createdAt: timestamp,
    updatedAt: timestamp,
    datasetId,
    sourceColumn,
    aliases: [],
    dataType,
    nullable: true,
    coercion: { trimText: true, emptyTextIsBlank: true },
  }
}

const fields = [
  field('id', 'ID', 'text'),
  field('contractor', 'Contractor', 'text'),
  field('status', 'Status', 'text'),
  field('amount', 'Amount', 'number'),
  field('created', 'Created On', 'date'),
  field('week', 'Work Week', 'workWeek'),
  field('sequence', 'Sequence', 'number'),
  field('note', 'Note', 'text'),
  field('phase', 'Inspection Phase', 'text'),
  field('issue', 'Issue?', 'text'),
] as const

const rows: ReadonlyArray<Readonly<Record<string, unknown>>> = [
  {
    ID: 'I-1',
    Contractor: 'Bechtel',
    Status: 'Closed',
    Amount: 10,
    'Created On': '2026-01-10',
    'Work Week': "WW1'2026",
    Sequence: 2,
    Note: 'Alpha',
    'Inspection Phase': 'Final',
    'Issue?': 'No Issue Found',
  },
  {
    ID: 'I-2',
    Contractor: 'Bechtel',
    Status: 'Open',
    Amount: '20',
    'Created On': '2026-01-15',
    'Work Week': "WW2'2026",
    Sequence: 1,
    Note: 'Beta',
    'Inspection Phase': 'Final',
    'Issue?': 'BIM-2',
  },
  {
    ID: 'I-3',
    Contractor: 'Kiewit',
    Status: 'Closed',
    Amount: '',
    'Created On': '2026-02-01',
    'Work Week': "WW1'2026",
    Sequence: 4,
    Note: 'Alpha',
    'Inspection Phase': 'Draft',
    'Issue?': 'BIM-3',
  },
  {
    ID: 'I-4',
    Contractor: 'Bechtel',
    Status: 'Closed',
    Amount: 'bad',
    'Created On': 'not a date',
    'Work Week': "WW2'2026",
    Sequence: 3,
    Note: '',
    'Inspection Phase': 'Final',
    'Issue?': 'BIM-4',
  },
  {
    ID: 'I-5',
    Contractor: 'Kiewit',
    Status: 'Closed',
    Amount: 30,
    'Created On': '2026-03-01',
    'Work Week': "WW2'2026",
    Sequence: 5,
    Note: 'Gamma',
    'Inspection Phase': 'Final',
    'Issue?': 'BIM-5',
  },
  {
    ID: 'I-6',
    Contractor: '',
    Status: 'Void',
    Amount: null,
    'Created On': '2026-04-01',
    'Work Week': 'bad week',
    Sequence: '',
    Note: 'Beta',
    'Inspection Phase': 'Final',
    'Issue?': '',
  },
]

function aggregation(
  id: string,
  operation: AggregationOperationV1,
  fieldId?: string,
  overrides: Partial<AggregationV1> = {},
): AggregationV1 {
  return {
    schemaVersion: 1,
    id,
    label: id,
    operation,
    fieldId,
    ...overrides,
  }
}

function query(overrides: Partial<QuerySpecV1> = {}): QuerySpecV1 {
  return {
    schemaVersion: 1,
    id: 'query',
    datasetId: 'inspections',
    groupBy: [],
    aggregations: [aggregation('rows', 'countRows')],
    ...overrides,
  }
}

const reportStatuses: PredicateV1 = {
  kind: 'condition',
  fieldId: 'status',
  operator: 'notEquals',
  value: { dataType: 'text', value: 'Void' },
}

describe('query aggregation', () => {
  it('executes every supported aggregation deterministically', () => {
    const result = executeQuery({
      query: query({
        aggregations: [
          aggregation('rows', 'countRows'),
          aggregation('nonEmptyAmount', 'countNonEmpty', 'amount'),
          aggregation('distinctNotes', 'distinctCount', 'note'),
          aggregation('amountSum', 'sum', 'amount'),
          aggregation('amountAverage', 'average', 'amount'),
          aggregation('earliest', 'min', 'created'),
          aggregation('latest', 'max', 'created'),
          aggregation('firstStatus', 'first', 'status', {
            orderBy: { fieldId: 'sequence', direction: 'ascending' },
          }),
          aggregation('lastStatus', 'last', 'status', {
            orderBy: { fieldId: 'sequence', direction: 'ascending' },
          }),
        ],
      }),
      fields,
      rows,
    })

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].values).toEqual({
      rows: 6,
      nonEmptyAmount: 4,
      distinctNotes: 3,
      amountSum: 60,
      amountAverage: 20,
      earliest: '2026-01-10',
      latest: '2026-04-01',
      firstStatus: 'Open',
      lastStatus: 'Closed',
    })
    expect(result.diagnostics.aggregations.amountSum).toMatchObject({
      candidateRows: 6,
      includedRows: 3,
      blankValues: 2,
      invalidValues: 1,
    })
    expect(result.diagnostics.aggregations.firstStatus).toMatchObject({
      orderExcludedRows: 1,
      includedRows: 5,
    })
  })

  it('groups across multiple fields with typed sorting and local aggregation filters', () => {
    const result = executeQuery({
      query: query({
        where: reportStatuses,
        groupBy: [{ fieldId: 'contractor' }, { fieldId: 'week' }],
        aggregations: [
          aggregation('rows', 'countRows'),
          aggregation('closed', 'countRows', undefined, {
            where: {
              kind: 'condition',
              fieldId: 'status',
              operator: 'equals',
              value: { dataType: 'text', value: 'Closed' },
            },
          }),
          aggregation('amount', 'sum', 'amount'),
        ],
        orderBy: [
          { by: 'group', fieldId: 'contractor', direction: 'ascending' },
          { by: 'group', fieldId: 'week', direction: 'ascending' },
        ],
      }),
      fields,
      rows,
    })

    expect(
      result.groups.map((group) => ({
        contractor: group.dimensions.contractor.value,
        week: group.dimensions.week.value,
        rows: group.values.rows,
        closed: group.values.closed,
        amount: group.values.amount,
      })),
    ).toEqual([
      {
        contractor: 'Bechtel',
        week: "WW1'2026",
        rows: 1,
        closed: 1,
        amount: 10,
      },
      {
        contractor: 'Bechtel',
        week: "WW2'2026",
        rows: 2,
        closed: 1,
        amount: 20,
      },
      {
        contractor: 'Kiewit',
        week: "WW1'2026",
        rows: 1,
        closed: 1,
        amount: 0,
      },
      {
        contractor: 'Kiewit',
        week: "WW2'2026",
        rows: 1,
        closed: 1,
        amount: 30,
      },
    ])
    expect(result.diagnostics).toMatchObject({
      totalRows: 6,
      matchedRows: 5,
      excludedRows: 1,
      matchedRowIndices: [0, 1, 2, 3, 4],
      excludedRowIndices: [5],
    })
    expect(result.diagnostics.aggregations.closed).toMatchObject({
      candidateRows: 5,
      filteredOutRows: 1,
      includedRows: 4,
    })
  })

  it('expresses the electrical issue rule without counting non-Final rows', () => {
    const result = executeQuery({
      query: query({
        where: {
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
              kind: 'condition',
              fieldId: 'issue',
              operator: 'isNotBlank',
            },
            {
              kind: 'condition',
              fieldId: 'issue',
              operator: 'notEquals',
              value: { dataType: 'text', value: 'No Issue Found' },
            },
          ],
        },
        groupBy: [{ fieldId: 'week' }],
      }),
      fields,
      rows,
    })

    expect(result.diagnostics.matchedRowIndices).toEqual([1, 3, 4])
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].dimensions.week.value).toBe("WW2'2026")
    expect(result.groups[0].values.rows).toBe(3)
  })

  it('sorts by aggregate values, limits groups, and leaves input rows untouched', () => {
    const original = JSON.parse(JSON.stringify(rows)) as unknown
    const result = executeQuery({
      query: query({
        where: reportStatuses,
        groupBy: [{ fieldId: 'contractor' }],
        orderBy: [
          { by: 'aggregation', aggregationId: 'rows', direction: 'descending' },
        ],
        limit: 1,
      }),
      fields,
      rows,
    })
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].dimensions.contractor.value).toBe('Bechtel')
    expect(result.groups[0].values.rows).toBe(3)
    expect(rows).toEqual(original)
  })

  it('distinguishes blank and invalid group values', () => {
    const result = executeQuery({
      query: query({ groupBy: [{ fieldId: 'week' }] }),
      fields,
      rows: [
        { 'Work Week': '' },
        { 'Work Week': 'not a week' },
        { 'Work Week': "WW1'2026" },
      ],
    })
    expect(result.groups.map((group) => group.dimensions.week.status)).toEqual([
      'blank',
      'invalid',
      'value',
    ])
    expect(result.diagnostics.totalCoercionIssues).toBe(1)
    expect(result.diagnostics.coercionIssues[0]).toMatchObject({
      rowIndex: 1,
      fieldId: 'week',
      phase: 'grouping',
    })
  })

  it('returns an empty grouped result and a zero ungrouped result when nothing matches', () => {
    const impossible: PredicateV1 = {
      kind: 'condition',
      fieldId: 'status',
      operator: 'equals',
      value: { dataType: 'text', value: 'Does Not Exist' },
    }
    const grouped = executeQuery({
      query: query({ where: impossible, groupBy: [{ fieldId: 'contractor' }] }),
      fields,
      rows,
    })
    const ungrouped = executeQuery({
      query: query({ where: impossible }),
      fields,
      rows,
    })
    expect(grouped.groups).toEqual([])
    expect(ungrouped.groups[0].values.rows).toBe(0)
    expect(ungrouped.diagnostics.excludedRows).toBe(rows.length)
  })

  it('reports predicate coercion failures and bounds diagnostic samples', () => {
    const result = executeQuery({
      query: query({
        where: {
          kind: 'condition',
          fieldId: 'amount',
          operator: 'greaterThan',
          value: { dataType: 'number', value: 0 },
        },
      }),
      fields,
      rows,
      options: { diagnosticSampleLimit: 0 },
    })
    expect(result.diagnostics).toMatchObject({
      matchedRows: 3,
      excludedRows: 3,
      predicateCoercionFailures: 1,
      totalCoercionIssues: 1,
      coercionIssues: [],
      coercionIssuesTruncated: true,
    })
  })

  it('safely materializes user-defined IDs that match object prototype keys', () => {
    const result = executeQuery({
      query: query({
        aggregations: [aggregation('__proto__', 'countRows')],
      }),
      fields,
      rows,
    })
    expect(result.groups[0].values.__proto__).toBe(6)
    expect(
      Object.prototype.hasOwnProperty.call(result.groups[0].values, '__proto__'),
    ).toBe(true)
    expect(
      Object.prototype.hasOwnProperty.call(
        result.diagnostics.aggregations,
        '__proto__',
      ),
    ).toBe(true)
  })

  it('enforces an explicit row budget', () => {
    expect(() =>
      executeQuery({
        query: query(),
        fields,
        rows,
        options: { maxRows: 5 },
      }),
    ).toThrow(QueryExecutionError)
  })
})

describe('query validation', () => {
  it('reports incompatible aggregations and unresolved ordering', () => {
    const invalid = query({
      aggregations: [
        aggregation('rows', 'countRows', 'id'),
        aggregation('sumStatus', 'sum', 'status'),
      ],
      orderBy: [
        {
          by: 'aggregation',
          aggregationId: 'missing',
          direction: 'ascending',
        },
      ],
    })
    const messages = validateQuery(invalid, fields).map((issue) => issue.message)
    expect(messages).toEqual(
      expect.arrayContaining([
        'countRows does not accept a field.',
        'sum requires a number field.',
        'Aggregation "missing" does not exist.',
      ]),
    )
  })

  it('rejects cross-dataset fields and invalid limits before executing', () => {
    const otherField = field('other', 'Other', 'number', 'other-dataset')
    const invalid = query({
      where: {
        kind: 'condition',
        fieldId: 'other',
        operator: 'greaterThan',
        value: { dataType: 'number', value: 0 },
      },
      groupBy: [{ fieldId: 'other' }],
      aggregations: [aggregation('sum', 'sum', 'other')],
      limit: 0,
    })
    const validation = validateQuery(invalid, [...fields, otherField])
    expect(validation).toContainEqual(
      expect.objectContaining({
        message: 'Predicate field "other" belongs to another dataset.',
      }),
    )
    expect(() =>
      executeQuery({ query: invalid, fields: [...fields, otherField], rows }),
    ).toThrow(QueryValidationError)
  })
})
