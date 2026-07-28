import { describe, expect, it } from 'vitest'
import type { DatasetProfile, FieldProfile, InferredFieldType } from '../data'
import { suggestQuickCharts } from './quickChart'

function field(
  id: string,
  name: string,
  inferredType: InferredFieldType,
  options: { distinctCount?: number; samples?: string[] } = {},
): FieldProfile {
  const samples = options.samples ?? []
  return {
    id,
    key: id,
    name,
    sourceColumnIndex: 0,
    sourceColumnNumber: 1,
    sourceColumnLabel: 'A',
    headerRaw: name,
    headerDisplay: name,
    inferredType,
    typeConfidence: 1,
    typeCounts: {
      text: 0,
      number: 0,
      boolean: 0,
      date: 0,
      datetime: 0,
      workWeek: 0,
      blank: 0,
    },
    rowCount: 20,
    nonBlankCount: 20,
    blankCount: 0,
    distinctCount: options.distinctCount ?? Math.max(1, samples.length),
    sampleValues: samples.map((display) => ({ raw: display, display, count: 1 })),
  }
}

function dataset(fields: FieldProfile[]): DatasetProfile {
  return {
    id: 'dataset-inspections',
    name: 'Inspections',
    workbookId: 'workbook-1',
    worksheetName: 'Inspections',
    worksheetIndex: 0,
    headerRowNumber: 1,
    headerConfidence: 1,
    sourceRange: 'A1:Z21',
    rowCount: 20,
    fields,
    rows: [],
  }
}

describe('spreadsheet-first chart suggestions', () => {
  it('turns a work week and measure into a labeled trend', () => {
    const source = dataset([
      field('week', 'Work Week', 'workWeek'),
      field('welds', 'Total Welds', 'number'),
    ])

    const suggestions = suggestQuickCharts(source, ['week', 'welds'])

    expect(suggestions[0]).toMatchObject({
      visualType: 'line',
      title: 'Total Welds by Work Week',
      query: {
        datasetId: source.id,
        aggregation: 'sum',
        measureFieldId: 'welds',
        groupByFieldId: 'week',
        sort: 'categoryAscending',
      },
      appearance: {
        xAxisTitle: 'Work Week',
        yAxisTitle: 'Total Welds',
      },
    })
  })

  it('suggests a secondary-axis combo for time and two measures', () => {
    const source = dataset([
      field('week', 'Work Week', 'workWeek'),
      field('opened', 'Issues Opened', 'number'),
      field('remaining', 'Remaining Open', 'number'),
    ])

    const suggestions = suggestQuickCharts(source, ['week', 'opened', 'remaining'])

    expect(suggestions[0]).toMatchObject({
      visualType: 'combo',
      query: {
        measureFieldId: 'opened',
        secondaryMeasureFieldId: 'remaining',
        secondaryAggregation: 'sum',
        groupByFieldId: 'week',
      },
    })
  })

  it('counts an ID column as a headline metric', () => {
    const source = dataset([field('issue-id', 'Issue ID', 'text')])

    expect(suggestQuickCharts(source, ['issue-id'])[0]).toMatchObject({
      visualType: 'kpi',
      title: 'Total Issues',
      query: {
        aggregation: 'countNonEmpty',
        measureFieldId: 'issue-id',
      },
    })
  })

  it('suggests a split metric for two standalone numeric columns', () => {
    const source = dataset([
      field('signed', 'Signed Welds', 'number'),
      field('total', 'Total Welds', 'number'),
    ])

    expect(suggestQuickCharts(source, ['signed', 'total'])[0]).toMatchObject({
      visualType: 'splitKpi',
      query: {
        aggregation: 'sum',
        measureFieldId: 'signed',
        secondaryAggregation: 'sum',
        secondaryMeasureFieldId: 'total',
      },
      appearance: {
        primaryLabel: 'Signed Welds',
        secondaryLabel: 'Total Welds',
      },
    })
    expect(suggestQuickCharts(source, ['signed', 'total'])[1]).toMatchObject({
      visualType: 'kpi',
      query: {
        metricCalculation: 'ratioPercent',
      },
      appearance: {
        valueFormat: 'percent',
      },
    })
  })

  it('uses horizontal bars for numerous or long category labels', () => {
    const source = dataset([
      field('contractor', 'Contractor', 'text', {
        distinctCount: 18,
        samples: ['A Contractor Name That Is Quite Long'],
      }),
      field('issues', 'Issues', 'number'),
    ])

    expect(suggestQuickCharts(source, ['contractor', 'issues'])[0]).toMatchObject({
      visualType: 'bar',
      query: {
        groupByFieldId: 'contractor',
        measureFieldId: 'issues',
      },
    })
  })

  it('preserves two categories as a stacked comparison', () => {
    const source = dataset([
      field('discipline', 'Discipline', 'text'),
      field('status', 'Status', 'text'),
    ])

    expect(suggestQuickCharts(source, ['discipline', 'status'])[0]).toMatchObject({
      visualType: 'stackedBar',
      query: {
        aggregation: 'countRows',
        groupByFieldId: 'discipline',
        seriesFieldId: 'status',
      },
    })
  })

  it('always offers a selected-column detail table for multicolumn selections', () => {
    const source = dataset([
      field('id', 'ID', 'text'),
      field('title', 'Title', 'text'),
      field('status', 'Status', 'text'),
      field('created', 'Created On', 'date'),
    ])

    const suggestions = suggestQuickCharts(source, ['id', 'title', 'status', 'created'])
    const table = suggestions.find((candidate) => candidate.visualType === 'table')

    expect(table?.query.tableFieldIds).toEqual(['id', 'title', 'status', 'created'])
  })
})
