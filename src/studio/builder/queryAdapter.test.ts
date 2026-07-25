import { describe, expect, it } from 'vitest'
import { profileSpreadsheetInputs } from '../data'
import type { DashboardFilterRecord, StudioWidgetQuery } from '../library/model'
import { dashboardFilterConditions, runStudioQuery } from './queryAdapter'

async function fixture() {
  const catalog = await profileSpreadsheetInputs([{
    name: 'Inspection_Log.csv',
    bytes: new TextEncoder().encode([
      'Work Week,Status,Cost',
      "WW27'2026,Open,100",
      "WW27'2026,Closed,250",
      "WW28'2026,Open,150",
    ].join('\n')),
  }])
  return catalog.datasets[0]
}

function query(): StudioWidgetQuery {
  return {
    datasetId: null,
    aggregation: 'countRows',
    measureFieldId: null,
    secondaryAggregation: null,
    secondaryMeasureFieldId: null,
    groupByFieldId: null,
    seriesFieldId: null,
    tableFieldIds: [],
    resultTransform: 'none',
    match: 'all',
    conditions: [],
    sort: 'categoryAscending',
    limit: 50,
  }
}

describe('studio query adapter', () => {
  it('applies dashboard filters by semantic column name', async () => {
    const dataset = await fixture()
    const workWeek = dataset.fields.find((field) => field.name === 'Work Week')
    const filter: DashboardFilterRecord = {
      id: 'status-filter',
      name: 'Status',
      fieldName: 'Status',
      value: 'Open',
      enabled: true,
    }
    const input = {
      ...query(),
      datasetId: dataset.id,
      groupByFieldId: workWeek?.id ?? null,
    }
    const output = runStudioQuery(
      input,
      dataset,
      dashboardFilterConditions([filter], dataset),
    )

    expect(output.result.diagnostics.matchedRows).toBe(2)
    expect(output.points.map((point) => [point.category, point.value])).toEqual([
      ["WW27'2026", 1],
      ["WW28'2026", 1],
    ])
  })

  it('fails visibly when a saved local rule references a missing column', async () => {
    const dataset = await fixture()
    const input: StudioWidgetQuery = {
      ...query(),
      datasetId: dataset.id,
      conditions: [{
        id: 'missing-rule',
        fieldId: 'removed-field',
        operator: 'equals',
        value: 'Open',
      }],
    }

    expect(() => runStudioQuery(input, dataset)).toThrow(/no longer available/i)
  })

  it('fails closed when a numeric rule is blank or invalid', async () => {
    const dataset = await fixture()
    const cost = dataset.fields.find((field) => field.name === 'Cost')
    const input: StudioWidgetQuery = {
      ...query(),
      datasetId: dataset.id,
      conditions: [{
        id: 'invalid-number',
        fieldId: cost?.id ?? '',
        operator: 'greaterThan',
        value: '',
      }],
    }

    expect(() => runStudioQuery(input, dataset)).toThrow(/enter a value/i)
    input.conditions[0].value = 'not a number'
    expect(() => runStudioQuery(input, dataset)).toThrow(/valid number/i)
  })

  it('returns paired values for scatter and combo visuals', async () => {
    const dataset = await fixture()
    const workWeek = dataset.fields.find((field) => field.name === 'Work Week')
    const cost = dataset.fields.find((field) => field.name === 'Cost')
    const input: StudioWidgetQuery = {
      ...query(),
      datasetId: dataset.id,
      aggregation: 'countRows',
      secondaryAggregation: 'sum',
      secondaryMeasureFieldId: cost?.id ?? null,
      groupByFieldId: workWeek?.id ?? null,
    }
    const output = runStudioQuery(input, dataset)
    const primary = output.points.filter((point) => point.series === 'Value')

    expect(primary.map((point) => [point.value, point.secondaryValue])).toEqual([
      [2, 350],
      [1, 150],
    ])
  })
})
