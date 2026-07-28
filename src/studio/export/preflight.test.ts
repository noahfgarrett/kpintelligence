import { describe, expect, it } from 'vitest'
import { profileSpreadsheetInputs } from '../data'
import {
  createWidget,
  type DashboardRecord,
  type ExportProfileRecord,
} from '../library/model'
import { runExportPreflight } from './preflight'

async function fixture() {
  return profileSpreadsheetInputs([{
    name: 'Issues.csv',
    bytes: new TextEncoder().encode('Status,Cost\nOpen,100\nClosed,-100'),
  }])
}

function dashboard(datasetId: string, statusFieldId: string): DashboardRecord {
  const timestamp = new Date().toISOString()
  const widget = createWidget('column')
  widget.title = 'Issues by status'
  widget.query.datasetId = datasetId
  widget.query.groupByFieldId = statusFieldId
  return {
    id: 'dashboard',
    projectId: 'project',
    name: 'Weekly report',
    description: '',
    kind: 'custom',
    featured: false,
    favorite: false,
    pages: [{
      id: 'page',
      name: 'Overview',
      order: 0,
      widgets: [widget],
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    filters: [],
    calculations: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function profile(): ExportProfileRecord {
  const timestamp = new Date().toISOString()
  return {
    id: 'export',
    projectId: 'project',
    dashboardId: 'dashboard',
    name: 'Widescreen report',
    format: 'pptx',
    pageSize: 'widescreen',
    orientation: 'landscape',
    margin: 0.35,
    includeTitle: true,
    includeGeneratedAt: true,
    includePageNumbers: true,
    tableOverflow: 'paginate',
    scale: 4,
    headerText: '',
    footerText: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

describe('export preflight', () => {
  it('passes a connected dashboard and reports its rendered page count', async () => {
    const catalog = await fixture()
    const status = catalog.datasets[0].fields.find((field) => field.name === 'Status')
    const result = runExportPreflight(
      dashboard(catalog.datasets[0].id, status?.id ?? ''),
      catalog,
      profile(),
    )

    expect(result.status).toBe('ready')
    expect(result.pageCount).toBe(1)
  })

  it('blocks disconnected columns before a blank visual can be captured', async () => {
    const catalog = await fixture()
    const result = runExportPreflight(
      dashboard(catalog.datasets[0].id, 'missing-field'),
      catalog,
      profile(),
    )

    expect(result.status).toBe('blocked')
    expect(result.blockers[0].title).toMatch(/replacement column/i)
  })

  it('warns when current slicers leave a visual empty', async () => {
    const catalog = await fixture()
    const status = catalog.datasets[0].fields.find((field) => field.name === 'Status')
    const source = dashboard(catalog.datasets[0].id, status?.id ?? '')
    source.filters = [{
      id: 'status-filter',
      name: 'Status',
      fieldName: 'Status',
      value: 'Void',
      values: ['Void'],
      enabled: true,
    }]

    const result = runExportPreflight(source, catalog, profile())

    expect(result.status).toBe('warning')
    expect(result.warnings[0].title).toMatch(/no matching rows/i)
  })

  it('warns when a calculation produces a non-finite result', async () => {
    const catalog = await fixture()
    const status = catalog.datasets[0].fields.find((field) => field.name === 'Status')
    const cost = catalog.datasets[0].fields.find((field) => field.name === 'Cost')
    const source = dashboard(catalog.datasets[0].id, status?.id ?? '')
    source.pages[0].widgets[0].query.aggregation = 'sum'
    source.pages[0].widgets[0].query.measureFieldId = cost?.id ?? null
    source.pages[0].widgets[0].query.resultTransform = 'percentOfTotal'

    const result = runExportPreflight(source, catalog, profile())

    expect(result.status).toBe('warning')
    expect(result.warnings.some((warning) => /undefined results/i.test(warning.title))).toBe(true)
  })

  it('blocks page slicers whose target page no longer exists', async () => {
    const catalog = await fixture()
    const status = catalog.datasets[0].fields.find((field) => field.name === 'Status')
    const source = dashboard(catalog.datasets[0].id, status?.id ?? '')
    source.filters = [{
      id: 'missing-page-filter',
      name: 'Status',
      fieldName: 'Status',
      value: 'Open',
      values: ['Open'],
      scope: 'page',
      pageId: 'missing-page',
      enabled: true,
    }]

    const result = runExportPreflight(source, catalog, profile())

    expect(result.status).toBe('blocked')
    expect(result.blockers.some((blocker) => /no report page/i.test(blocker.title))).toBe(true)
  })

  it('blocks a slicer whose field exists only outside its page scope', async () => {
    const catalog = await profileSpreadsheetInputs([
      {
        name: 'Issues.csv',
        bytes: new TextEncoder().encode('Status\nOpen\nClosed'),
      },
      {
        name: 'Inspections.csv',
        bytes: new TextEncoder().encode('Discipline\nElectrical\nMechanical'),
      },
    ])
    const issues = catalog.datasets.find((dataset) =>
      dataset.fields.some((field) => field.name === 'Status'))
    const status = issues?.fields.find((field) => field.name === 'Status')
    if (!issues || !status) throw new Error('Issues fixture missing')
    const source = dashboard(issues.id, status.id)
    source.filters = [{
      id: 'discipline-filter',
      name: 'Discipline',
      fieldName: 'Discipline',
      value: 'Electrical',
      values: ['Electrical'],
      scope: 'page',
      pageId: source.pages[0].id,
      enabled: true,
    }]

    const result = runExportPreflight(source, catalog, profile())

    expect(result.status).toBe('blocked')
    expect(result.blockers.some((blocker) =>
      /discipline slicer is disconnected/i.test(blocker.title))).toBe(true)
  })
})
