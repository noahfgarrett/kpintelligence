import { describe, expect, it } from 'vitest'
import { profileSpreadsheetInputs } from '../data'
import {
  createWidget,
  type DashboardRecord,
  type ExportProfileRecord,
} from '../library/model'
import { buildExportSegments } from './DashboardExportStage'

async function largeCatalog(rowCount: number) {
  const rows = [
    'ID,Status',
    ...Array.from({ length: rowCount }, (_, index) => `${index + 1},Open`),
  ]
  return profileSpreadsheetInputs([{
    name: 'Issues.csv',
    bytes: new TextEncoder().encode(rows.join('\n')),
  }])
}

function exportProfile(dashboardId: string): ExportProfileRecord {
  const timestamp = new Date().toISOString()
  return {
    id: 'export-1',
    projectId: 'project-1',
    dashboardId,
    name: 'Report',
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

describe('custom dashboard export planning', () => {
  it('rejects a table export before it can mount an unsafe number of pages', async () => {
    const catalog = await largeCatalog(1700)
    const timestamp = new Date().toISOString()
    const table = createWidget('table')
    table.query.datasetId = catalog.datasets[0].id
    const dashboard: DashboardRecord = {
      id: 'dashboard-1',
      projectId: 'project-1',
      name: 'Issue detail',
      description: '',
      kind: 'custom',
      featured: false,
      favorite: false,
      pages: [{
        id: 'page-1',
        name: 'Issues',
        order: 0,
        widgets: [table],
        createdAt: timestamp,
        updatedAt: timestamp,
      }],
      filters: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    expect(() => buildExportSegments(
      dashboard,
      catalog,
      exportProfile(dashboard.id),
    )).toThrow(/more than 60 pages/i)
  })
})
