import { describe, expect, it } from 'vitest'
import {
  STUDIO_SCHEMA_VERSION,
  type LibraryDocumentV1,
} from './model'
import {
  isLibraryDocumentV1,
  validateLibraryDocument,
} from './modelValidation'

const timestamp = '2026-07-25T12:00:00.000Z'
const entity = {
  schemaVersion: STUDIO_SCHEMA_VERSION,
  createdAt: timestamp,
  updatedAt: timestamp,
}

const document: LibraryDocumentV1 = {
  kind: 'kpintelligence.library',
  schemaVersion: STUDIO_SCHEMA_VERSION,
  revision: 1,
  id: 'library',
  name: 'KPIntelligence',
  createdAt: timestamp,
  updatedAt: timestamp,
  folders: [
    {
      ...entity,
      kind: 'libraryFolder',
      id: 'folder',
      name: 'North Campus',
      parentFolderId: null,
      childFolderIds: [],
      projectIds: ['project'],
      order: 0,
    },
  ],
  projects: [
    {
      ...entity,
      kind: 'project',
      id: 'project',
      name: 'Central Utility Plant',
      folderId: 'folder',
      dashboardIds: ['dashboard'],
      sourceIds: ['source'],
      datasetIds: ['dataset'],
      filterIds: ['filter'],
      themeIds: ['theme'],
      exportProfileIds: ['export'],
      defaultThemeId: 'theme',
    },
  ],
  dashboards: [
    {
      ...entity,
      kind: 'dashboard',
      id: 'dashboard',
      name: 'Weekly QA/QC',
      projectId: 'project',
      pageIds: ['page'],
      filterIds: ['filter'],
      themeId: 'theme',
      defaultExportProfileId: 'export',
      featured: true,
      template: {
        id: 'oac-weekly-qaqc',
        version: '1.0.0',
        detached: false,
      },
    },
  ],
  pages: [
    {
      ...entity,
      kind: 'dashboardPage',
      id: 'page',
      name: 'Overview',
      dashboardId: 'dashboard',
      order: 0,
      widgetIds: ['widget'],
      filterIds: ['filter'],
      layoutIds: ['layout'],
      presentationTitle: 'Weekly QA/QC Overview',
    },
  ],
  widgets: [
    {
      ...entity,
      kind: 'dashboardWidget',
      id: 'widget',
      name: 'Narrative',
      pageId: 'page',
      rendererSpecVersion: 1,
      query: null,
      visual: {
        kind: 'text',
        markdown: 'Weekly quality overview',
      },
      title: 'Overview',
      showTitle: true,
      showSourceFreshness: false,
    },
  ],
  layouts: [
    {
      ...entity,
      kind: 'dashboardLayout',
      id: 'layout',
      name: 'Presentation',
      pageId: 'page',
      profile: 'presentation',
      columns: 12,
      rowHeight: 24,
      gap: 16,
      items: [
        {
          widgetId: 'widget',
          x: 0,
          y: 0,
          width: 12,
          height: 8,
        },
      ],
    },
  ],
  exportProfiles: [
    {
      ...entity,
      kind: 'exportProfile',
      id: 'export',
      name: 'GC PowerPoint',
      projectId: 'project',
      format: 'pptx',
      pageSize: {
        widthInches: 13.333,
        heightInches: 7.5,
        orientation: 'landscape',
      },
      margins: { top: 0.35, right: 0.35, bottom: 0.35, left: 0.35 },
      layoutProfile: 'presentation',
      pageIds: ['page'],
      includePageTitles: true,
      includeGeneratedAt: true,
      chartOutput: 'vectorPreferred',
      tableOverflow: 'paginate',
      header: { enabled: true, text: '', heightInches: 0.4 },
      footer: { enabled: true, text: '', heightInches: 0.4 },
    },
  ],
  sources: [
    {
      ...entity,
      kind: 'spreadsheetSource',
      id: 'source',
      name: 'BIM Issues Log',
      projectId: 'project',
      bindingKey: 'bim-issues',
      fileSelector: {
        fileNamePattern: 'BIM Issues Log',
        worksheet: 'auto',
      },
      refresh: {
        mode: 'watch',
        settleMilliseconds: 1500,
        consistencyGroup: 'weekly-report',
      },
    },
  ],
  datasets: [
    {
      ...entity,
      kind: 'dataset',
      id: 'dataset',
      name: 'BIM Issues',
      projectId: 'project',
      sourceId: 'source',
      headerRow: 'auto',
      fieldIds: ['field'],
      rowIdentityFieldIds: ['field'],
      includeRowNumbers: false,
    },
  ],
  fields: [
    {
      ...entity,
      kind: 'field',
      id: 'field',
      name: 'ID',
      datasetId: 'dataset',
      sourceColumn: 'ID',
      aliases: ['Issue ID'],
      dataType: 'text',
      nullable: false,
      coercion: {
        trimText: true,
        emptyTextIsBlank: true,
      },
    },
  ],
  filters: [
    {
      ...entity,
      kind: 'dashboardFilter',
      id: 'filter',
      name: 'Issue',
      projectId: 'project',
      semanticKey: 'issue-id',
      fieldIds: ['field'],
      control: 'multiSelect',
      predicate: null,
      scope: {
        dashboardIds: ['dashboard'],
        pageIds: ['page'],
        widgetIds: ['widget'],
      },
      defaultValue: null,
    },
  ],
  themes: [
    {
      ...entity,
      kind: 'theme',
      id: 'theme',
      name: 'KP Default',
      projectId: 'project',
      fonts: {
        body: 'Inter',
        heading: 'Inter',
        mono: 'JetBrains Mono',
      },
      colors: {
        canvas: '#f5f7fa',
        surface: '#ffffff',
        surfaceMuted: '#edf1f5',
        text: '#111827',
        textMuted: '#607083',
        border: '#dce3ea',
        positive: '#0f9f6e',
        warning: '#e58b19',
        negative: '#d14343',
        accent: '#147bd1',
      },
      chartPalette: ['#147bd1', '#0f9f6e', '#e58b19', '#d14343'],
      radii: { small: 4, medium: 8, large: 12 },
      shadows: {
        card: '0 2px 8px rgba(17, 24, 39, 0.08)',
        elevated: '0 12px 32px rgba(17, 24, 39, 0.16)',
      },
      spacing: { compact: 8, normal: 16, spacious: 24 },
    },
  ],
}

function cloneDocument(): LibraryDocumentV1 {
  return JSON.parse(JSON.stringify(document)) as LibraryDocumentV1
}

describe('versioned studio model validation', () => {
  it('accepts a complete, internally linked version 1 library', () => {
    expect(validateLibraryDocument(document)).toEqual({ valid: true, issues: [] })
    expect(isLibraryDocumentV1(document)).toBe(true)
  })

  it('rejects unsupported root and entity versions', () => {
    const invalid = cloneDocument() as unknown as Record<string, unknown>
    invalid.schemaVersion = 2
    const projects = invalid.projects as Array<Record<string, unknown>>
    projects[0].schemaVersion = 2

    const result = validateLibraryDocument(invalid)
    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        { path: 'schemaVersion', message: 'Only schema version 1 is supported.' },
        {
          path: 'projects[0].schemaVersion',
          message: 'Expected schema version 1.',
        },
      ]),
    )
  })

  it('finds duplicate IDs and broken references', () => {
    const invalid = cloneDocument()
    invalid.themes.push({ ...invalid.themes[0], name: 'Duplicate theme' })
    invalid.projects[0].dashboardIds = ['missing-dashboard']

    const messages = validateLibraryDocument(invalid).issues.map(
      (issue) => issue.message,
    )
    expect(messages).toContain('ID "theme" is duplicated.')
    expect(messages).toContain('Referenced ID "missing-dashboard" does not exist.')
  })

  it('detects folder hierarchy cycles', () => {
    const invalid = cloneDocument()
    invalid.folders[0].parentFolderId = 'folder'
    expect(validateLibraryDocument(invalid).issues).toContainEqual(
      expect.objectContaining({
        message: 'Folder hierarchy contains a cycle.',
      }),
    )
  })

  it('fails safely for non-object input', () => {
    expect(validateLibraryDocument(null)).toEqual({
      valid: false,
      issues: [{ path: 'document', message: 'Expected an object.' }],
    })
    expect(isLibraryDocumentV1([])).toBe(false)
  })
})
