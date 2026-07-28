import { describe, expect, it } from 'vitest'
import { profileSpreadsheetInputs } from '../data'
import type { DashboardFilterRecord, StudioWidgetQuery } from '../library/model'
import {
  dashboardFilterConditions,
  dashboardFiltersForWidget,
  resolveDashboardFilterField,
  runStudioQuery,
} from './queryAdapter'

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

  it('keeps multi-select values typed even when a value contains a comma', async () => {
    const catalog = await profileSpreadsheetInputs([{
      name: 'Contractors.csv',
      bytes: new TextEncoder().encode([
        'Contractor,Status',
        '"Garrett, Smith & Co",Open',
        'Bechtel,Open',
        'Other,Closed',
      ].join('\n')),
    }])
    const dataset = catalog.datasets[0]
    const filter: DashboardFilterRecord = {
      id: 'contractor-filter',
      name: 'Contractor',
      fieldName: 'Contractor',
      value: 'Garrett, Smith & Co',
      values: ['Garrett, Smith & Co', 'Bechtel'],
      selectionMode: 'multiple',
      operator: 'include',
      enabled: true,
    }

    const output = runStudioQuery(
      { ...query(), datasetId: dataset.id },
      dataset,
      dashboardFilterConditions([filter], dataset),
    )

    expect(output.result.diagnostics.matchedRows).toBe(2)
  })

  it('supports exclude slicers and page-scoped slicers', async () => {
    const dataset = await fixture()
    const filter: DashboardFilterRecord = {
      id: 'status-filter',
      name: 'Status',
      fieldName: 'Status',
      value: 'Closed',
      values: ['Closed'],
      operator: 'exclude',
      scope: 'page',
      pageId: 'page-one',
      enabled: true,
    }

    expect(runStudioQuery(
      { ...query(), datasetId: dataset.id },
      dataset,
      dashboardFilterConditions([filter], dataset, 'page-one'),
    ).result.diagnostics.matchedRows).toBe(2)
    expect(runStudioQuery(
      { ...query(), datasetId: dataset.id },
      dataset,
      dashboardFilterConditions([filter], dataset, 'page-two'),
    ).result.diagnostics.matchedRows).toBe(3)
  })

  it('keeps persisted disabled slicers disabled even when they retain values', async () => {
    const dataset = await fixture()
    const filter: DashboardFilterRecord = {
      id: 'disabled-filter',
      name: 'Status',
      fieldName: 'Status',
      value: 'Open',
      values: ['Open'],
      enabled: false,
    }

    expect(dashboardFilterConditions([filter], dataset)).toEqual([])
  })

  it('uses stable field identity when duplicate headers would be ambiguous', async () => {
    const source = await fixture()
    const status = source.fields.find((field) => field.name === 'Status')
    if (!status) throw new Error('Status field missing')
    const dataset = {
      ...source,
      fields: [
        ...source.fields,
        {
          ...status,
          id: `${status.id}-duplicate`,
          key: `${status.key}-duplicate`,
          name: 'Duplicate status',
        },
      ],
    }
    const unbound: DashboardFilterRecord = {
      id: 'ambiguous-filter',
      name: 'Status',
      fieldName: 'Status',
      fieldType: status.inferredType,
      value: 'Open',
      values: ['Open'],
      enabled: true,
    }
    const bound: DashboardFilterRecord = {
      ...unbound,
      bindings: [{
        datasetId: dataset.id,
        fieldId: status.id,
        fieldKey: status.key,
        fieldName: status.name,
        fieldType: status.inferredType,
      }],
    }

    expect(resolveDashboardFilterField(unbound, dataset)).toBeNull()
    expect(resolveDashboardFilterField(bound, dataset)?.id).toBe(status.id)
  })

  it('exempts a cross-filter source visual from its own exported filter', () => {
    const filter: DashboardFilterRecord = {
      id: 'chart-selection',
      name: 'Status',
      fieldName: 'Status',
      value: 'Open',
      sourceWidgetId: 'source-widget',
      enabled: true,
    }

    expect(dashboardFiltersForWidget([filter], 'source-widget')).toEqual([])
    expect(dashboardFiltersForWidget([filter], 'dependent-widget')).toEqual([filter])
  })

  it('keeps filters bound through a repaired display name', async () => {
    const source = await fixture()
    const dataset = {
      ...source,
      fields: source.fields.map((field) => field.name === 'Status'
        ? { ...field, name: 'Issue Status' }
        : field),
    }
    const filter: DashboardFilterRecord = {
      id: 'status-filter',
      name: 'Status',
      fieldName: 'Status',
      value: 'Open',
      values: ['Open'],
      enabled: true,
    }

    const output = runStudioQuery(
      { ...query(), datasetId: dataset.id },
      dataset,
      dashboardFilterConditions([filter], dataset),
    )

    expect(output.result.diagnostics.matchedRows).toBe(2)
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

  it('builds a percentage from independently filtered calculations', async () => {
    const dataset = await fixture()
    const status = dataset.fields.find((field) => field.name === 'Status')
    const input: StudioWidgetQuery = {
      ...query(),
      datasetId: dataset.id,
      aggregation: 'countRows',
      conditions: [{
        id: 'closed-only',
        fieldId: status?.id ?? '',
        operator: 'equals',
        value: 'Closed',
      }],
      secondaryAggregation: 'countRows',
      secondaryRuleMode: 'custom',
      secondaryConditions: [],
      metricCalculation: 'ratioPercent',
    }

    const output = runStudioQuery(input, dataset)

    expect(output.points).toHaveLength(1)
    expect(output.points[0]).toMatchObject({
      primaryValue: 1,
      secondaryValue: 3,
    })
    expect(output.points[0].value).toBeCloseTo(33.333, 2)
    expect(output.secondaryResult?.diagnostics.matchedRows).toBe(3)
  })

  it('resolves reusable completed-work-week rules at query time', async () => {
    const dataset = await fixture()
    const workWeek = dataset.fields.find((field) => field.name === 'Work Week')
    const input: StudioWidgetQuery = {
      ...query(),
      datasetId: dataset.id,
      conditions: [{
        id: 'reporting-week',
        fieldId: workWeek?.id ?? '',
        operator: 'equals',
        value: '@previous-work-week',
      }],
    }

    const output = runStudioQuery(input, dataset, [], new Date(2026, 6, 8, 12))

    expect(output.result.diagnostics.matchedRows).toBe(2)
    expect(output.points[0].value).toBe(2)
  })

  it('keeps percentage-formatted CSV values numeric during aggregation', async () => {
    const catalog = await profileSpreadsheetInputs([{
      name: 'Rates.csv',
      bytes: new TextEncoder().encode('Rate\n50%\n25%'),
    }])
    const dataset = catalog.datasets[0]
    const rate = dataset.fields.find((field) => field.name === 'Rate')
    const input: StudioWidgetQuery = {
      ...query(),
      datasetId: dataset.id,
      aggregation: 'sum',
      measureFieldId: rate?.id ?? null,
    }

    const output = runStudioQuery(input, dataset)

    expect(output.points[0].value).toBeCloseTo(0.75, 4)
    expect(output.result.diagnostics.totalCoercionIssues).toBe(0)
  })
})
