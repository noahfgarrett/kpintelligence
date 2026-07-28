import { strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { PlatformBridge, SourceFileDescriptor } from '@/platform/types'
import { profileSpreadsheetInputs } from '../data'
import {
  createId,
  createWidget,
  type DashboardRecord,
  type TeamLibraryRecord,
} from '../library/model'
import { createDashboardPackage } from './package'
import { scanTeamLibrary } from './teamLibrary'

async function packageBytes(version: string): Promise<Uint8Array> {
  const source = await profileSpreadsheetInputs([{
    name: 'Issues.csv',
    bytes: strToU8('Work Week,ID\nWW27,1001'),
  }])
  const dataset = source.datasets[0]
  const widget = createWidget('column')
  widget.query.datasetId = dataset.id
  widget.query.groupByFieldId = dataset.fields[0].id
  widget.query.aggregation = 'countNonEmpty'
  widget.query.measureFieldId = dataset.fields[1].id
  const timestamp = new Date().toISOString()
  const dashboard: DashboardRecord = {
    id: createId('dashboard'),
    projectId: createId('project'),
    name: 'Weekly Issues',
    description: 'Issue movement by week.',
    kind: 'custom',
    featured: false,
    favorite: false,
    pages: [{
      id: createId('page'),
      name: 'Overview',
      order: 0,
      widgets: [widget],
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    filters: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  return (await createDashboardPackage({
    dashboard,
    exportProfile: null,
    catalog: source,
    templateId: 'weekly-issues',
    templateVersion: version,
    author: 'Noah Garrett',
    category: 'Quality',
    minAppVersion: '0.2.0',
  })).bytes
}

describe('Team Library scanning', () => {
  it('keeps every unsigned version visible and isolates corrupt files', async () => {
    const first = await packageBytes('1.0.0')
    const second = await packageBytes('1.2.0')
    const files = new Map<string, Uint8Array>([
      ['/library/Weekly-Issues-1.0.0.kpidashboard', first],
      ['/library/Weekly-Issues-1.2.0.kpidashboard', second],
      ['/library/Broken.kpidashboard', strToU8('not a zip')],
    ])
    const descriptors: SourceFileDescriptor[] = [...files].map(([path, bytes], index) => ({
      path,
      name: path.split('/').pop() ?? path,
      size: bytes.byteLength,
      modifiedAt: index,
    }))
    const platform: PlatformBridge = {
      kind: 'tauri',
      supportsPersistentFolders: true,
      async chooseDirectory() { return null },
      async listFiles() { return descriptors },
      async readFile(path) { return files.get(path) ?? new Uint8Array() },
      async watchDirectory() { return () => undefined },
      async loadState() { return null },
      async saveState() { return undefined },
      async saveFile() { return null },
      async checkForUpdate() { return null },
      async installUpdate() { return undefined },
    }
    const timestamp = new Date().toISOString()
    const library: TeamLibraryRecord = {
      id: 'team-library',
      name: 'Company dashboards',
      folderPath: '/library',
      enabled: true,
      packageCount: 0,
      lastScannedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    const catalog = await scanTeamLibrary(platform, library, '0.2.0')

    expect(catalog.packages).toHaveLength(2)
    expect(catalog.packages[0].document.manifest.templateVersion).toBe('1.2.0')
    expect(catalog.packages[1].document.manifest.templateVersion).toBe('1.0.0')
    expect(catalog.packages.every((file) =>
      file.document.authenticity.status === 'unsigned')).toBe(true)
    expect(catalog.warnings).toHaveLength(1)
    expect(catalog.warnings[0]).toMatch(/Broken\.kpidashboard/i)
  })
})
