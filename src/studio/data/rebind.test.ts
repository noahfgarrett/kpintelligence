import { describe, expect, it } from 'vitest'
import { createWidget, type DashboardRecord } from '../library/model'
import { profileSpreadsheetInputs } from './profiler'
import { rebindDashboardSources } from './rebind'

const CSV = [
  'Work Week,Status,Cost',
  "WW27'2026,Open,100",
  "WW28'2026,Closed,250",
].join('\n')

async function catalog(path: string) {
  return profileSpreadsheetInputs([{
    name: 'Inspection_Log.csv',
    path,
    bytes: new TextEncoder().encode(CSV),
  }])
}

function dashboardFor(dataset: Awaited<ReturnType<typeof catalog>>['datasets'][number]): DashboardRecord {
  const now = new Date().toISOString()
  const widget = createWidget('column', { x: 0, y: 0 })
  const workWeek = dataset.fields.find((field) => field.name === 'Work Week')
  const status = dataset.fields.find((field) => field.name === 'Status')
  const cost = dataset.fields.find((field) => field.name === 'Cost')
  widget.query = {
    ...widget.query,
    datasetId: dataset.id,
    aggregation: 'sum',
    measureFieldId: cost?.id ?? null,
    groupByFieldId: workWeek?.id ?? null,
    tableFieldIds: dataset.fields.map((field) => field.id),
    conditions: [{
      id: 'status-rule',
      fieldId: status?.id ?? '',
      operator: 'equals',
      value: 'Open',
    }],
    secondaryConditions: [{
      id: 'secondary-status-rule',
      fieldId: status?.id ?? '',
      operator: 'equals',
      value: 'Closed',
    }],
  }
  return {
    id: 'dashboard-1',
    projectId: 'project-1',
    name: 'Inspection performance',
    description: '',
    kind: 'custom',
    featured: false,
    favorite: false,
    filters: [],
    pages: [{
      id: 'page-1',
      name: 'Overview',
      order: 0,
      widgets: [widget],
      createdAt: now,
      updatedAt: now,
    }],
    createdAt: now,
    updatedAt: now,
  }
}

describe('dashboard source rebinding', () => {
  it('reconnects datasets and columns after a synced folder moves', async () => {
    const previous = await catalog('/old/sharepoint/Inspection_Log.csv')
    const current = await catalog('/new/sharepoint/Inspection_Log.csv')
    expect(previous.datasets[0].id).not.toBe(current.datasets[0].id)

    const rebound = rebindDashboardSources(
      dashboardFor(previous.datasets[0]),
      current,
      previous,
    )
    const query = rebound.pages[0].widgets[0].query

    expect(query.datasetId).toBe(current.datasets[0].id)
    expect(query.measureFieldId).toBe(current.datasets[0].fields.find((field) => field.name === 'Cost')?.id)
    expect(query.groupByFieldId).toBe(current.datasets[0].fields.find((field) => field.name === 'Work Week')?.id)
    expect(query.conditions[0].fieldId).toBe(current.datasets[0].fields.find((field) => field.name === 'Status')?.id)
    expect(query.secondaryConditions?.[0].fieldId).toBe(current.datasets[0].fields.find((field) => field.name === 'Status')?.id)
  })

  it('can recover the binding after restart from readable ID segments', async () => {
    const previous = await catalog('/old/sharepoint/Inspection_Log.csv')
    const current = await catalog('/new/sharepoint/Inspection_Log.csv')
    const rebound = rebindDashboardSources(dashboardFor(previous.datasets[0]), current)

    expect(rebound.pages[0].widgets[0].query.datasetId).toBe(current.datasets[0].id)
  })

  it('repairs missing field IDs even when the dataset ID itself did not change', async () => {
    const previous = await catalog('/sharepoint/Inspection_Log.csv')
    const sourceDashboard = dashboardFor(previous.datasets[0])
    const status = previous.datasets[0].fields.find((field) => field.name === 'Status')
    const currentDataset = {
      ...previous.datasets[0],
      fields: previous.datasets[0].fields.map((field) => field.id === status?.id
        ? { ...field, id: `${field.id}-refreshed`, key: `${field.key}-refreshed` }
        : field),
    }
    const rebound = rebindDashboardSources(
      sourceDashboard,
      { ...previous, datasets: [currentDataset] },
      previous,
    )

    expect(rebound.pages[0].widgets[0].query.conditions[0].fieldId)
      .toBe(`${status?.id}-refreshed`)
  })

  it('does not use column position alone after a referenced column is deleted', async () => {
    const previous = await catalog('/sharepoint/Inspection_Log.csv')
    const sourceDashboard = dashboardFor(previous.datasets[0])
    const status = previous.datasets[0].fields.find((field) => field.name === 'Status')
    const cost = previous.datasets[0].fields.find((field) => field.name === 'Cost')
    if (!status || !cost) throw new Error('Fixture fields missing')
    const shiftedCost = {
      ...cost,
      sourceColumnIndex: status.sourceColumnIndex,
      sourceColumnNumber: status.sourceColumnNumber,
      sourceColumnLabel: status.sourceColumnLabel,
    }
    const currentDataset = {
      ...previous.datasets[0],
      fields: previous.datasets[0].fields
        .filter((field) => field.id !== status.id && field.id !== cost.id)
        .concat(shiftedCost),
    }
    const rebound = rebindDashboardSources(
      sourceDashboard,
      { ...previous, datasets: [currentDataset] },
      previous,
    )

    expect(rebound.pages[0].widgets[0].query.conditions[0].fieldId).toBe(status.id)
    expect(rebound.pages[0].widgets[0].query.conditions[0].fieldId).not.toBe(cost.id)
  })

  it('rebinds stable slicer field identity when a synced folder moves', async () => {
    const previous = await catalog('/old/sharepoint/Inspection_Log.csv')
    const current = await catalog('/new/sharepoint/Inspection_Log.csv')
    const sourceDashboard = dashboardFor(previous.datasets[0])
    const status = previous.datasets[0].fields.find((field) => field.name === 'Status')
    if (!status) throw new Error('Status field missing')
    sourceDashboard.filters = [{
      id: 'status-filter',
      name: 'Status',
      fieldName: status.name,
      fieldType: status.inferredType,
      bindings: [{
        datasetId: previous.datasets[0].id,
        fieldId: status.id,
        fieldKey: status.key,
        fieldName: status.name,
        fieldType: status.inferredType,
      }],
      value: 'Open',
      values: ['Open'],
      enabled: true,
    }]

    const rebound = rebindDashboardSources(sourceDashboard, current, previous)
    const currentStatus = current.datasets[0].fields.find((field) => field.name === 'Status')

    expect(rebound.filters[0].bindings?.[0]).toMatchObject({
      datasetId: current.datasets[0].id,
      fieldId: currentStatus?.id,
      fieldKey: currentStatus?.key,
    })
  })

  it('does not guess when two replacement datasets score equally', async () => {
    const previous = await catalog('/old/sharepoint/Inspection_Log.csv')
    const current = await catalog('/new/sharepoint/Inspection_Log.csv')
    const duplicate = {
      ...current.datasets[0],
      id: current.datasets[0].id.replace(
        /-[a-z0-9]+\/dataset\//,
        '-different/dataset/',
      ),
    }
    const ambiguous = {
      ...current,
      datasets: [current.datasets[0], duplicate],
    }
    const sourceDashboard = dashboardFor(previous.datasets[0])
    const rebound = rebindDashboardSources(sourceDashboard, ambiguous)

    expect(rebound).toBe(sourceDashboard)
  })

  it('does not bind generic matching columns without worksheet or workbook identity evidence', async () => {
    const previous = await catalog('/old/sharepoint/Inspection_Log.csv')
    const current = await catalog('/new/sharepoint/Unrelated_Log.csv')
    const renamedDataset = {
      ...current.datasets[0],
      id: current.datasets[0].id
        .replace(/^workbook:[^/]+/, 'workbook:unrelated-log-different')
        .replace('/dataset/sheet1', '/dataset/renamed-sheet'),
      name: 'Renamed Sheet',
      worksheetName: 'Renamed Sheet',
    }
    const unrelated = {
      ...current,
      datasets: [renamedDataset],
    }
    const sourceDashboard = dashboardFor(previous.datasets[0])

    expect(rebindDashboardSources(sourceDashboard, unrelated, previous)).toBe(sourceDashboard)
  })

  it('does not rebind a referenced column to an incompatible inferred type', async () => {
    const previous = await catalog('/old/sharepoint/Inspection_Log.csv')
    const current = await catalog('/new/sharepoint/Inspection_Log.csv')
    const costId = current.datasets[0].fields.find((field) => field.name === 'Cost')?.id
    const incompatibleDataset = {
      ...current.datasets[0],
      fields: current.datasets[0].fields.map((field) => field.id === costId
        ? { ...field, inferredType: 'text' as const }
        : field),
    }
    const incompatible = { ...current, datasets: [incompatibleDataset] }
    const sourceDashboard = dashboardFor(previous.datasets[0])

    expect(rebindDashboardSources(sourceDashboard, incompatible, previous)).toBe(sourceDashboard)
  })
})
