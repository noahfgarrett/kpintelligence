import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { applySourceRepairs, profileSpreadsheetInputs } from '../data'
import {
  createId,
  createWidget,
  type DashboardRecord,
  type ExportProfileRecord,
} from '../library/model'
import {
  compareSemver,
  createDashboardPackage,
  installDashboardPackage,
  readDashboardPackage,
  sourceRepairProposals,
} from './package'

async function catalog(fileName: string) {
  return profileSpreadsheetInputs([{
    name: fileName,
    bytes: strToU8([
      'Work Week,Inspection ID,Status',
      "WW27'2026,E-101,Closed",
      "WW28'2026,E-102,Open",
    ].join('\n')),
  }])
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const source = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', source)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function fixture() {
  const sourceCatalog = await catalog('Electrical_Inspection_Log.csv')
  const dataset = sourceCatalog.datasets[0]
  const workWeek = dataset.fields.find((field) => field.name === 'Work Week')
  const inspectionId = dataset.fields.find((field) => field.name === 'Inspection ID')
  if (!workWeek || !inspectionId) throw new Error('Fixture fields were not profiled.')

  const widget = createWidget('column')
  widget.title = 'Inspections by Work Week'
  widget.query = {
    ...widget.query,
    datasetId: dataset.id,
    aggregation: 'countNonEmpty',
    measureFieldId: inspectionId.id,
    groupByFieldId: workWeek.id,
  }
  const createdAt = new Date().toISOString()
  const dashboard: DashboardRecord = {
    id: createId('dashboard'),
    projectId: createId('project'),
    name: 'Inspection Performance',
    description: 'Weekly completed inspection volume.',
    kind: 'custom',
    featured: false,
    favorite: true,
    pages: [{
      id: createId('page'),
      name: 'Overview',
      order: 0,
      widgets: [widget],
      createdAt,
      updatedAt: createdAt,
    }],
    filters: [],
    createdAt,
    updatedAt: createdAt,
  }
  const exportProfile: ExportProfileRecord = {
    id: createId('export'),
    projectId: dashboard.projectId,
    dashboardId: dashboard.id,
    name: 'Weekly deck',
    format: 'pptx',
    pageSize: 'widescreen',
    orientation: 'landscape',
    margin: 0.25,
    includeTitle: true,
    includeGeneratedAt: true,
    includePageNumbers: true,
    tableOverflow: 'paginate',
    scale: 4,
    headerText: '',
    footerText: '',
    createdAt,
    updatedAt: createdAt,
  }
  return { dashboard, exportProfile, sourceCatalog, dataset, workWeek, inspectionId }
}

describe('.kpidashboard packages', () => {
  it('orders stable and prerelease template versions using semantic version precedence', () => {
    expect(compareSemver('1.0.0', '1.0.0-beta.2')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0-beta.11', '1.0.0-beta.2')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0-beta', '1.0.0-alpha')).toBeGreaterThan(0)
    expect(compareSemver('1.2.0', '1.10.0')).toBeLessThan(0)
  })

  it('round-trips dashboard logic without embedding spreadsheet rows or source paths', async () => {
    const source = await fixture()
    const packaged = await createDashboardPackage({
      dashboard: source.dashboard,
      exportProfile: source.exportProfile,
      catalog: source.sourceCatalog,
      templateId: 'inspection-performance',
      templateVersion: '1.0.0',
      author: 'Noah Garrett',
      category: 'Quality',
      minAppVersion: '0.2.0',
    })

    expect(packaged.fileName).toBe('Inspection-Performance-1.0.0.kpidashboard')
    expect(packaged.document.manifest.sourceRequirements).toHaveLength(1)
    expect(packaged.document.manifest.sourceRequirements[0].fields.map((field) => field.name))
      .toEqual(['Inspection ID', 'Work Week'])
    expect(packaged.document.manifest.privacy).toEqual({
      includesSpreadsheetRows: false,
      includesCredentials: false,
      includesAbsolutePaths: false,
      configuredLiteralCount: 0,
    })

    const entries = unzipSync(packaged.bytes)
    const rawContent = strFromU8(entries['dashboard.json'])
    expect(Object.keys(entries).sort()).toEqual(['dashboard.json', 'manifest.json'])
    expect(rawContent).not.toContain("WW27'2026")
    expect(rawContent).not.toContain('/Users/')

    const read = await readDashboardPackage(packaged.bytes, '0.2.0')
    expect(read.manifest.templateId).toBe('inspection-performance')
    expect(read.content.dashboard.favorite).toBe(false)
  })

  it('installs as a fresh copy and semantically rebinds renamed workbook sources', async () => {
    const source = await fixture()
    const packaged = await createDashboardPackage({
      dashboard: source.dashboard,
      exportProfile: source.exportProfile,
      catalog: source.sourceCatalog,
      templateId: 'inspection-performance',
      templateVersion: '1.2.0',
      author: 'Noah Garrett',
      category: 'Quality',
      minAppVersion: '0.2.0',
    })
    const targetCatalog = await catalog('Project_52_Inspections.csv')
    const installed = installDashboardPackage(
      await readDashboardPackage(packaged.bytes, '0.2.0'),
      'target-project',
      'teamLibrary',
      targetCatalog,
    )

    const installedWidget = installed.dashboard.pages[0].widgets[0]
    const targetDataset = targetCatalog.datasets[0]
    expect(installed.dashboard.id).not.toBe(source.dashboard.id)
    expect(installed.dashboard.projectId).toBe('target-project')
    expect(installed.dashboard.template).toMatchObject({
      id: 'inspection-performance',
      version: '1.2.0',
      source: 'teamLibrary',
    })
    expect(installedWidget.id).not.toBe(source.dashboard.pages[0].widgets[0].id)
    expect(installedWidget.query.datasetId).toBe(targetDataset.id)
    expect(installedWidget.query.groupByFieldId)
      .toBe(targetDataset.fields.find((field) => field.name === 'Work Week')?.id)
    expect(installed.unresolvedVisualCount).toBe(0)
    expect(installed.exportProfile).toMatchObject({
      projectId: 'target-project',
      dashboardId: installed.dashboard.id,
    })
  })

  it('round-trips page slicers and reusable calculations with fresh local IDs', async () => {
    const source = await fixture()
    const sourcePageId = source.dashboard.pages[0].id
    const timestamp = new Date().toISOString()
    source.dashboard.filters = [{
      id: 'source-filter',
      name: 'Work Week',
      fieldName: 'Work Week',
      fieldType: source.workWeek.inferredType,
      bindings: [{
        datasetId: source.dataset.id,
        fieldId: source.workWeek.id,
        fieldKey: source.workWeek.key,
        fieldName: source.workWeek.name,
        fieldType: source.workWeek.inferredType,
      }],
      value: "WW27'2026",
      values: ["WW27'2026"],
      selectionMode: 'multiple',
      operator: 'include',
      scope: 'page',
      pageId: sourcePageId,
      enabled: true,
    }]
    source.dashboard.calculations = [{
      id: 'source-calculation',
      name: 'Completed inspections',
      datasetId: source.dataset.id,
      aggregation: 'countNonEmpty',
      measureFieldId: source.inspectionId.id,
      secondaryAggregation: null,
      secondaryMeasureFieldId: null,
      metricCalculation: 'none',
      secondaryRuleMode: 'same',
      secondaryMatch: 'all',
      secondaryConditions: [],
      resultTransform: 'none',
      match: 'all',
      conditions: [{
        id: 'source-condition',
        fieldId: source.workWeek.id,
        operator: 'equals',
        value: '@previous-work-week',
      }],
      valueFormat: 'number',
      currencyCode: 'USD',
      createdAt: timestamp,
      updatedAt: timestamp,
    }]
    const packaged = await createDashboardPackage({
      dashboard: source.dashboard,
      exportProfile: source.exportProfile,
      catalog: source.sourceCatalog,
      templateId: 'inspection-recipes',
      templateVersion: '1.0.0',
      author: 'Noah Garrett',
      category: 'Quality',
      minAppVersion: '0.3.0',
    })
    const targetCatalog = await catalog('Electrical_Inspection_Log.csv')
    const installed = installDashboardPackage(
      await readDashboardPackage(packaged.bytes, '0.3.0'),
      'target-project',
      'package',
      targetCatalog,
    )
    const installedPage = installed.dashboard.pages[0]
    const installedFilter = installed.dashboard.filters[0]
    const installedCalculation = installed.dashboard.calculations?.[0]

    expect(packaged.document.manifest.privacy.configuredLiteralCount).toBe(2)
    expect(installedFilter.id).not.toBe('source-filter')
    expect(installedFilter.pageId).toBe(installedPage.id)
    expect(installedFilter.pageId).not.toBe(sourcePageId)
    expect(installedFilter.bindings?.[0]).toMatchObject({
      datasetId: targetCatalog.datasets[0].id,
      fieldId: targetCatalog.datasets[0].fields.find((field) =>
        field.name === 'Work Week')?.id,
    })
    expect(installedCalculation?.id).not.toBe('source-calculation')
    expect(installedCalculation?.conditions[0].id).not.toBe('source-condition')
    expect(installedCalculation?.datasetId).toBe(targetCatalog.datasets[0].id)
    expect(installedCalculation?.measureFieldId)
      .toBe(targetCatalog.datasets[0].fields.find((field) => field.name === 'Inspection ID')?.id)
  })

  it('retains and reapplies source-repair contracts on a clean target project', async () => {
    const source = await fixture()
    const repairs = {
      reviewedDatasetIds: [],
      fieldRepairs: [{
        id: 'reporting-week-repair',
        datasetId: source.dataset.id,
        fieldId: source.workWeek.id,
        displayName: 'Reporting Week',
        dataType: 'text' as const,
        updatedAt: new Date().toISOString(),
      }],
    }
    const repairedSource = applySourceRepairs(source.sourceCatalog, repairs)
    const packaged = await createDashboardPackage({
      dashboard: source.dashboard,
      exportProfile: source.exportProfile,
      catalog: repairedSource,
      sourceRepairs: repairs,
      templateId: 'repaired-inspections',
      templateVersion: '1.0.0',
      author: 'Noah Garrett',
      category: 'Quality',
      minAppVersion: '0.3.0',
    })
    const targetRaw = await catalog('Moved_Electrical_Inspection_Log.csv')
    const proposals = sourceRepairProposals(
      packaged.document.manifest.sourceRequirements,
      targetRaw,
    )
    const targetRepaired = applySourceRepairs(targetRaw, {
      reviewedDatasetIds: [],
      fieldRepairs: proposals,
    })
    const installed = installDashboardPackage(
      await readDashboardPackage(packaged.bytes, '0.3.0'),
      'target-project',
      'package',
      targetRepaired,
    )

    expect(packaged.document.manifest.sourceRequirements[0].fields
      .find((field) => field.sourceFieldId === source.workWeek.id)?.repair)
      .toEqual({ displayName: 'Reporting Week', dataType: 'text' })
    expect(proposals[0]).toMatchObject({
      displayName: 'Reporting Week',
      dataType: 'text',
    })
    expect(installed.unresolvedVisualCount).toBe(0)
    expect(installed.dashboard.template?.sourceRequirements).toHaveLength(1)
  })

  it('rejects packages for newer app versions and modified package content', async () => {
    const source = await fixture()
    const packaged = await createDashboardPackage({
      dashboard: source.dashboard,
      exportProfile: null,
      catalog: source.sourceCatalog,
      templateId: 'inspection-performance',
      templateVersion: '2.0.0',
      author: 'Noah Garrett',
      category: 'Quality',
      minAppVersion: '9.0.0',
    })

    await expect(readDashboardPackage(packaged.bytes, '0.2.0'))
      .rejects.toThrow(/requires KPIntelligence 9\.0\.0/i)

    const entries = unzipSync(packaged.bytes)
    const content = JSON.parse(strFromU8(entries['dashboard.json'])) as {
      dashboard: DashboardRecord
    }
    content.dashboard.name = 'Modified after publication'
    const modified = zipSync({
      'manifest.json': entries['manifest.json'],
      'dashboard.json': strToU8(JSON.stringify(content)),
    })
    await expect(readDashboardPackage(modified, '9.0.0'))
      .rejects.toThrow(/integrity check/i)
  })

  it('rejects unknown payloads, local paths, and false privacy metadata', async () => {
    const source = await fixture()
    const packaged = await createDashboardPackage({
      dashboard: source.dashboard,
      exportProfile: null,
      catalog: source.sourceCatalog,
      templateId: 'privacy-test',
      templateVersion: '1.0.0',
      author: 'Noah Garrett',
      category: 'Quality',
      minAppVersion: '0.3.0',
    })
    const entries = unzipSync(packaged.bytes)
    const manifest = JSON.parse(strFromU8(entries['manifest.json'])) as {
      contentSha256: string
      privacy: { configuredLiteralCount: number }
    }
    const content = JSON.parse(strFromU8(entries['dashboard.json'])) as {
      dashboard: DashboardRecord & { rows?: unknown[] }
    }
    content.dashboard.rows = []
    let contentBytes = strToU8(JSON.stringify(content))
    manifest.contentSha256 = await sha256(contentBytes)
    const unknownPayload = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'dashboard.json': contentBytes,
    })
    await expect(readDashboardPackage(unknownPayload, '0.3.0'))
      .rejects.toThrow(/invalid dashboard content/i)

    delete content.dashboard.rows
    content.dashboard.description = '/Users/noah/private/report.xlsx'
    contentBytes = strToU8(JSON.stringify(content))
    manifest.contentSha256 = await sha256(contentBytes)
    const pathPayload = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'dashboard.json': contentBytes,
    })
    await expect(readDashboardPackage(pathPayload, '0.3.0'))
      .rejects.toThrow(/invalid dashboard content/i)

    content.dashboard.description = 'Safe description'
    contentBytes = strToU8(JSON.stringify(content))
    manifest.contentSha256 = await sha256(contentBytes)
    manifest.privacy.configuredLiteralCount = 999
    const falsePrivacyPayload = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'dashboard.json': contentBytes,
    })
    await expect(readDashboardPackage(falsePrivacyPayload, '0.3.0'))
      .rejects.toThrow(/privacy metadata/i)
  })

  it('rejects dashboards that exceed package structure safety limits', async () => {
    const source = await fixture()
    const seedWidget = source.dashboard.pages[0].widgets[0]
    const oversizedDashboard: DashboardRecord = {
      ...source.dashboard,
      pages: [{
        ...source.dashboard.pages[0],
        widgets: Array.from({ length: 501 }, (_, index) => ({
          ...structuredClone(seedWidget),
          id: `widget-${index}`,
        })),
      }],
    }

    await expect(createDashboardPackage({
      dashboard: oversizedDashboard,
      exportProfile: null,
      catalog: source.sourceCatalog,
      templateId: 'oversized-dashboard',
      templateVersion: '1.0.0',
      author: 'Noah Garrett',
      category: 'Quality',
      minAppVersion: '0.2.0',
    })).rejects.toThrow(/package safety limits/i)
  })
})
