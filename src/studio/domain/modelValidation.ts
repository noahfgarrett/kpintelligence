import type { LibraryDocumentV1 } from './model'

export interface ModelValidationIssue {
  path: string
  message: string
}

export interface ModelValidationResult {
  valid: boolean
  issues: ModelValidationIssue[]
}

type UnknownRecord = Record<string, unknown>

const COLLECTION_KINDS = {
  folders: 'libraryFolder',
  projects: 'project',
  dashboards: 'dashboard',
  pages: 'dashboardPage',
  widgets: 'dashboardWidget',
  layouts: 'dashboardLayout',
  exportProfiles: 'exportProfile',
  sources: 'spreadsheetSource',
  datasets: 'dataset',
  fields: 'field',
  filters: 'dashboardFilter',
  themes: 'theme',
} as const

type CollectionName = keyof typeof COLLECTION_KINDS

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function recordsFor(
  document: UnknownRecord,
  collection: CollectionName,
  issues: ModelValidationIssue[],
): UnknownRecord[] {
  const value = document[collection]
  if (!Array.isArray(value)) {
    issues.push({ path: collection, message: 'Expected an array.' })
    return []
  }

  const expectedKind = COLLECTION_KINDS[collection]
  const records: UnknownRecord[] = []
  const ids = new Set<string>()
  value.forEach((item, index) => {
    const path = `${collection}[${index}]`
    const record = asRecord(item)
    if (record === null) {
      issues.push({ path, message: 'Expected an object.' })
      return
    }
    records.push(record)
    if (record.schemaVersion !== 1) {
      issues.push({ path: `${path}.schemaVersion`, message: 'Expected schema version 1.' })
    }
    if (record.kind !== expectedKind) {
      issues.push({
        path: `${path}.kind`,
        message: `Expected kind "${expectedKind}".`,
      })
    }
    if (!nonEmptyString(record.id)) {
      issues.push({ path: `${path}.id`, message: 'Expected a non-empty ID.' })
    } else if (ids.has(record.id)) {
      issues.push({ path: `${path}.id`, message: `ID "${record.id}" is duplicated.` })
    } else {
      ids.add(record.id)
    }
    if (!nonEmptyString(record.name)) {
      issues.push({ path: `${path}.name`, message: 'Expected a non-empty name.' })
    }
    if (!nonEmptyString(record.createdAt)) {
      issues.push({ path: `${path}.createdAt`, message: 'Expected a timestamp.' })
    }
    if (!nonEmptyString(record.updatedAt)) {
      issues.push({ path: `${path}.updatedAt`, message: 'Expected a timestamp.' })
    }
  })
  return records
}

function idSet(records: UnknownRecord[]): Set<string> {
  return new Set(
    records
      .map((record) => record.id)
      .filter((id): id is string => typeof id === 'string'),
  )
}

function reference(
  path: string,
  value: unknown,
  availableIds: ReadonlySet<string>,
  issues: ModelValidationIssue[],
  nullable = false,
): void {
  if (nullable && value === null) return
  if (!nonEmptyString(value)) {
    issues.push({ path, message: nullable ? 'Expected an ID or null.' : 'Expected an ID.' })
  } else if (!availableIds.has(value)) {
    issues.push({ path, message: `Referenced ID "${value}" does not exist.` })
  }
}

function references(
  path: string,
  value: unknown,
  availableIds: ReadonlySet<string>,
  issues: ModelValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    issues.push({ path, message: 'Expected an array of IDs.' })
    return
  }
  value.forEach((id, index) =>
    reference(`${path}[${index}]`, id, availableIds, issues),
  )
}

function validateFolderCycles(
  folders: UnknownRecord[],
  issues: ModelValidationIssue[],
): void {
  const parentById = new Map<string, string | null>()
  for (const folder of folders) {
    if (typeof folder.id !== 'string') continue
    parentById.set(
      folder.id,
      typeof folder.parentFolderId === 'string' ? folder.parentFolderId : null,
    )
  }

  for (const folderId of parentById.keys()) {
    const visited = new Set<string>()
    let current: string | null = folderId
    while (current !== null) {
      if (visited.has(current)) {
        issues.push({
          path: `folders.${folderId}.parentFolderId`,
          message: 'Folder hierarchy contains a cycle.',
        })
        break
      }
      visited.add(current)
      current = parentById.get(current) ?? null
    }
  }
}

export function validateLibraryDocument(document: unknown): ModelValidationResult {
  const issues: ModelValidationIssue[] = []
  const root = asRecord(document)
  if (root === null) {
    return {
      valid: false,
      issues: [{ path: 'document', message: 'Expected an object.' }],
    }
  }

  if (root.kind !== 'kpintelligence.library') {
    issues.push({
      path: 'kind',
      message: 'Expected kind "kpintelligence.library".',
    })
  }
  if (root.schemaVersion !== 1) {
    issues.push({ path: 'schemaVersion', message: 'Only schema version 1 is supported.' })
  }
  if (!Number.isInteger(root.revision) || Number(root.revision) < 0) {
    issues.push({ path: 'revision', message: 'Expected a non-negative integer.' })
  }
  if (!nonEmptyString(root.id)) {
    issues.push({ path: 'id', message: 'Expected a non-empty ID.' })
  }
  if (!nonEmptyString(root.name)) {
    issues.push({ path: 'name', message: 'Expected a non-empty name.' })
  }
  if (!nonEmptyString(root.createdAt)) {
    issues.push({ path: 'createdAt', message: 'Expected a timestamp.' })
  }
  if (!nonEmptyString(root.updatedAt)) {
    issues.push({ path: 'updatedAt', message: 'Expected a timestamp.' })
  }

  const collections = Object.fromEntries(
    (Object.keys(COLLECTION_KINDS) as CollectionName[]).map((collection) => [
      collection,
      recordsFor(root, collection, issues),
    ]),
  ) as Record<CollectionName, UnknownRecord[]>

  const ids = Object.fromEntries(
    (Object.keys(collections) as CollectionName[]).map((collection) => [
      collection,
      idSet(collections[collection]),
    ]),
  ) as Record<CollectionName, Set<string>>

  collections.folders.forEach((folder, index) => {
    reference(
      `folders[${index}].parentFolderId`,
      folder.parentFolderId,
      ids.folders,
      issues,
      true,
    )
    references(
      `folders[${index}].childFolderIds`,
      folder.childFolderIds,
      ids.folders,
      issues,
    )
    references(
      `folders[${index}].projectIds`,
      folder.projectIds,
      ids.projects,
      issues,
    )
  })
  validateFolderCycles(collections.folders, issues)

  collections.projects.forEach((project, index) => {
    reference(
      `projects[${index}].folderId`,
      project.folderId,
      ids.folders,
      issues,
      true,
    )
    references(
      `projects[${index}].dashboardIds`,
      project.dashboardIds,
      ids.dashboards,
      issues,
    )
    references(
      `projects[${index}].sourceIds`,
      project.sourceIds,
      ids.sources,
      issues,
    )
    references(
      `projects[${index}].datasetIds`,
      project.datasetIds,
      ids.datasets,
      issues,
    )
    references(
      `projects[${index}].filterIds`,
      project.filterIds,
      ids.filters,
      issues,
    )
    references(
      `projects[${index}].themeIds`,
      project.themeIds,
      ids.themes,
      issues,
    )
    references(
      `projects[${index}].exportProfileIds`,
      project.exportProfileIds,
      ids.exportProfiles,
      issues,
    )
    reference(
      `projects[${index}].defaultThemeId`,
      project.defaultThemeId,
      ids.themes,
      issues,
      true,
    )
  })

  collections.dashboards.forEach((dashboard, index) => {
    reference(
      `dashboards[${index}].projectId`,
      dashboard.projectId,
      ids.projects,
      issues,
    )
    references(
      `dashboards[${index}].pageIds`,
      dashboard.pageIds,
      ids.pages,
      issues,
    )
    references(
      `dashboards[${index}].filterIds`,
      dashboard.filterIds,
      ids.filters,
      issues,
    )
    reference(
      `dashboards[${index}].themeId`,
      dashboard.themeId,
      ids.themes,
      issues,
      true,
    )
    reference(
      `dashboards[${index}].defaultExportProfileId`,
      dashboard.defaultExportProfileId,
      ids.exportProfiles,
      issues,
      true,
    )
  })

  collections.pages.forEach((page, index) => {
    reference(`pages[${index}].dashboardId`, page.dashboardId, ids.dashboards, issues)
    references(`pages[${index}].widgetIds`, page.widgetIds, ids.widgets, issues)
    references(`pages[${index}].filterIds`, page.filterIds, ids.filters, issues)
    references(`pages[${index}].layoutIds`, page.layoutIds, ids.layouts, issues)
  })

  collections.widgets.forEach((widget, index) => {
    reference(`widgets[${index}].pageId`, widget.pageId, ids.pages, issues)
  })

  collections.layouts.forEach((layout, index) => {
    reference(`layouts[${index}].pageId`, layout.pageId, ids.pages, issues)
    const items = Array.isArray(layout.items) ? layout.items : []
    if (!Array.isArray(layout.items)) {
      issues.push({ path: `layouts[${index}].items`, message: 'Expected an array.' })
    }
    items.forEach((item, itemIndex) => {
      const itemRecord = asRecord(item)
      if (itemRecord === null) {
        issues.push({
          path: `layouts[${index}].items[${itemIndex}]`,
          message: 'Expected an object.',
        })
      } else {
        reference(
          `layouts[${index}].items[${itemIndex}].widgetId`,
          itemRecord.widgetId,
          ids.widgets,
          issues,
        )
      }
    })
  })

  collections.exportProfiles.forEach((profile, index) => {
    reference(
      `exportProfiles[${index}].projectId`,
      profile.projectId,
      ids.projects,
      issues,
    )
    references(
      `exportProfiles[${index}].pageIds`,
      profile.pageIds,
      ids.pages,
      issues,
    )
  })

  collections.sources.forEach((source, index) => {
    reference(`sources[${index}].projectId`, source.projectId, ids.projects, issues)
  })

  collections.datasets.forEach((dataset, index) => {
    reference(`datasets[${index}].projectId`, dataset.projectId, ids.projects, issues)
    reference(`datasets[${index}].sourceId`, dataset.sourceId, ids.sources, issues)
    references(`datasets[${index}].fieldIds`, dataset.fieldIds, ids.fields, issues)
    references(
      `datasets[${index}].rowIdentityFieldIds`,
      dataset.rowIdentityFieldIds,
      ids.fields,
      issues,
    )
  })

  collections.fields.forEach((field, index) => {
    reference(`fields[${index}].datasetId`, field.datasetId, ids.datasets, issues)
  })

  collections.filters.forEach((filter, index) => {
    reference(`filters[${index}].projectId`, filter.projectId, ids.projects, issues)
    references(`filters[${index}].fieldIds`, filter.fieldIds, ids.fields, issues)
    const scope = asRecord(filter.scope)
    if (scope === null) {
      issues.push({ path: `filters[${index}].scope`, message: 'Expected an object.' })
    } else {
      references(
        `filters[${index}].scope.dashboardIds`,
        scope.dashboardIds,
        ids.dashboards,
        issues,
      )
      references(
        `filters[${index}].scope.pageIds`,
        scope.pageIds,
        ids.pages,
        issues,
      )
      references(
        `filters[${index}].scope.widgetIds`,
        scope.widgetIds,
        ids.widgets,
        issues,
      )
    }
  })

  collections.themes.forEach((theme, index) => {
    reference(`themes[${index}].projectId`, theme.projectId, ids.projects, issues)
  })

  return { valid: issues.length === 0, issues }
}

export function isLibraryDocumentV1(document: unknown): document is LibraryDocumentV1 {
  return validateLibraryDocument(document).valid
}
