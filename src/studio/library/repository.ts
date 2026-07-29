import type { PlatformBridge } from '@/platform/types'
import { mergeFilters } from '@/calculations/report'
import type { ReportFilters } from '@/types'
import type { WorkspaceStoreData } from '@/workspaces/types'
import {
  createId,
  LIBRARY_SCHEMA_VERSION,
  type DashboardRecord,
  type ExportProfileRecord,
  type LibraryStore,
  type ProjectRecord,
  type TeamLibraryRecord,
} from './model'

const LIBRARY_STORAGE_KEY = 'studio-library'
const LIBRARY_BACKUP_KEY = 'studio-library-backup'
const LIBRARY_RECOVERY_KEY = 'studio-library-recovery'

export class LibraryCompatibilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LibraryCompatibilityError'
  }
}

function timestamp(): string {
  return new Date().toISOString()
}

function createOacDashboard(projectId: string, name = 'Weekly QA/QC Report'): DashboardRecord {
  const now = timestamp()
  return {
    id: createId('dashboard'),
    projectId,
    name,
    description: 'Weekly OAC-ready quality report with issues, inspections, and welding signoffs.',
    kind: 'oacWeekly',
    featured: true,
    favorite: true,
    pages: [],
    filters: [],
    createdAt: now,
    updatedAt: now,
  }
}

function defaultExportProfile(projectId: string, dashboardId: string): ExportProfileRecord {
  const now = timestamp()
  return {
    id: createId('export'),
    projectId,
    dashboardId,
    name: 'OAC slide deck',
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
    createdAt: now,
    updatedAt: now,
  }
}

export function createEmptyLibrary(): LibraryStore {
  const now = timestamp()
  const projectId = createId('project')
  const project: ProjectRecord = {
    id: projectId,
    name: 'OAC Weekly Reporting',
    description: 'Featured quality reporting workspace.',
    folderId: null,
    sourceFolder: null,
    sourceWebUrl: null,
    sourceFileCount: 0,
    sourceDatasetCount: 0,
    sourceRefreshedAt: null,
    sourceRepairs: { fieldRepairs: [], reviewedDatasetIds: [] },
    createdAt: now,
    updatedAt: now,
  }
  const dashboard = createOacDashboard(projectId)
  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    revision: 1,
    folders: [],
    projects: [project],
    dashboards: [dashboard],
    teamLibraries: [],
    exportProfiles: [defaultExportProfile(project.id, dashboard.id)],
    expandedFolderIds: [],
    expandedProjectIds: [project.id],
    recentDashboardIds: [dashboard.id],
    selection: { kind: 'dashboard', id: dashboard.id },
  }
}

function migrateWorkspaceStore(workspaces: WorkspaceStoreData): LibraryStore {
  if (workspaces.workspaces.length === 0) return createEmptyLibrary()
  const projects: ProjectRecord[] = []
  const dashboards: DashboardRecord[] = []
  const exportProfiles: ExportProfileRecord[] = []

  workspaces.workspaces.forEach((workspace) => {
    const now = workspace.updatedAt || timestamp()
    const project: ProjectRecord = {
      id: createId('project'),
      name: workspace.name,
      description: 'Migrated weekly QA/QC workspace.',
      folderId: null,
      sourceFolder: workspace.sourceFolder,
      sourceWebUrl: null,
      sourceFileCount: 0,
      sourceDatasetCount: 0,
      sourceRefreshedAt: null,
      sourceRepairs: { fieldRepairs: [], reviewedDatasetIds: [] },
      reportFilters: mergeFilters(workspace.filters ?? {}),
      createdAt: workspace.createdAt || now,
      updatedAt: now,
    }
    const dashboard = createOacDashboard(project.id)
    projects.push(project)
    dashboards.push(dashboard)
    exportProfiles.push(defaultExportProfile(project.id, dashboard.id))
  })

  const activeIndex = Math.max(
    0,
    workspaces.workspaces.findIndex((workspace) => workspace.id === workspaces.activeWorkspaceId),
  )
  const activeDashboard = dashboards[activeIndex] ?? dashboards[0]
  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    revision: 1,
    folders: [],
    projects,
    dashboards,
    teamLibraries: [],
    exportProfiles,
    expandedFolderIds: [],
    expandedProjectIds: projects.map((project) => project.id),
    recentDashboardIds: activeDashboard ? [activeDashboard.id] : [],
    selection: activeDashboard
      ? { kind: 'dashboard', id: activeDashboard.id }
      : { kind: 'home', id: 'home' },
  }
}

type UnknownRecord = Record<string, unknown>

const VISUAL_TYPES = new Set([
  'kpi', 'splitKpi', 'table', 'bar', 'column', 'stackedBar', 'line', 'area', 'combo',
  'donut', 'pie', 'scatter', 'radar', 'gauge', 'funnel', 'heatmap',
  'treemap', 'progress', 'text',
])
const AGGREGATIONS = new Set([
  'countRows', 'countNonEmpty', 'distinctCount', 'sum', 'average', 'min', 'max',
  'first', 'last',
])
const RESULT_TRANSFORMS = new Set(['none', 'percentOfTotal', 'runningTotal'])
const FIELD_TYPES = new Set(['text', 'number', 'boolean', 'date', 'datetime', 'workWeek'])
const SORTS = new Set([
  'categoryAscending', 'categoryDescending', 'valueAscending', 'valueDescending',
])
const OPERATORS = new Set([
  'equals', 'notEquals', 'contains', 'notContains', 'startsWith', 'endsWith',
  'isBlank', 'isNotBlank', 'greaterThan', 'greaterThanOrEqual', 'lessThan',
  'lessThanOrEqual', 'between', 'oneOf', 'notOneOf',
])

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function hasIdentity(value: UnknownRecord): boolean {
  return isString(value.id)
    && value.id.length > 0
    && isString(value.name)
    && isString(value.createdAt)
    && isString(value.updatedAt)
}

function hasEntityTimestamps(value: UnknownRecord): boolean {
  return isString(value.id)
    && value.id.length > 0
    && isString(value.createdAt)
    && isString(value.updatedAt)
}

function validCondition(value: unknown): boolean {
  const condition = asRecord(value)
  return Boolean(condition
    && isString(condition.id)
    && isString(condition.fieldId)
    && OPERATORS.has(String(condition.operator))
    && isString(condition.value)
    && (condition.values === undefined || isStringArray(condition.values)))
}

function validSourceRepairs(value: unknown): boolean {
  if (value === undefined) return true
  const repairs = asRecord(value)
  return Boolean(repairs
    && Array.isArray(repairs.fieldRepairs)
    && repairs.fieldRepairs.every((candidate) => {
      const repair = asRecord(candidate)
      return Boolean(repair
        && isString(repair.id)
        && isString(repair.datasetId)
        && isString(repair.fieldId)
        && (repair.workbookFileName === undefined || isString(repair.workbookFileName))
        && (repair.datasetName === undefined || isString(repair.datasetName))
        && (repair.worksheetName === undefined || isString(repair.worksheetName))
        && (repair.fieldKey === undefined || isString(repair.fieldKey))
        && (repair.sourceHeader === undefined || isString(repair.sourceHeader))
        && (repair.sourceColumnIndex === undefined
          || (isFiniteNumber(repair.sourceColumnIndex)
            && Number.isInteger(repair.sourceColumnIndex)
            && repair.sourceColumnIndex >= 0))
        && isNullableString(repair.displayName)
        && (repair.dataType === null
          || ['text', 'number', 'boolean', 'date', 'datetime', 'workWeek'].includes(String(repair.dataType)))
        && isString(repair.updatedAt))
    })
    && isStringArray(repairs.reviewedDatasetIds))
}

function validSavedCalculation(value: unknown): boolean {
  const calculation = asRecord(value)
  return Boolean(calculation
    && isString(calculation.id)
    && isString(calculation.name)
    && isString(calculation.datasetId)
    && AGGREGATIONS.has(String(calculation.aggregation))
    && isNullableString(calculation.measureFieldId)
    && (calculation.secondaryAggregation === null
      || AGGREGATIONS.has(String(calculation.secondaryAggregation)))
    && isNullableString(calculation.secondaryMeasureFieldId)
    && ['none', 'difference', 'ratioPercent'].includes(String(calculation.metricCalculation))
    && ['same', 'custom'].includes(String(calculation.secondaryRuleMode))
    && (calculation.secondaryMatch === 'all' || calculation.secondaryMatch === 'any')
    && Array.isArray(calculation.secondaryConditions)
    && calculation.secondaryConditions.every(validCondition)
    && (calculation.resultTransform === undefined
      || RESULT_TRANSFORMS.has(String(calculation.resultTransform)))
    && (calculation.match === 'all' || calculation.match === 'any')
    && Array.isArray(calculation.conditions)
    && calculation.conditions.every(validCondition)
    && ['number', 'percent', 'currency'].includes(String(calculation.valueFormat))
    && isString(calculation.currencyCode)
    && isString(calculation.createdAt)
    && isString(calculation.updatedAt))
}

function validWidget(value: unknown): boolean {
  const widget = asRecord(value)
  const query = asRecord(widget?.query)
  const appearance = asRecord(widget?.appearance)
  const layout = asRecord(widget?.layout)
  return Boolean(widget
    && hasEntityTimestamps(widget)
    && isString(widget.title)
    && isString(widget.subtitle)
    && VISUAL_TYPES.has(String(widget.visualType))
    && typeof widget.locked === 'boolean'
    && query
    && isNullableString(query.datasetId)
    && AGGREGATIONS.has(String(query.aggregation))
    && isNullableString(query.measureFieldId)
    && (query.secondaryAggregation === null || AGGREGATIONS.has(String(query.secondaryAggregation)))
    && isNullableString(query.secondaryMeasureFieldId)
    && (query.metricCalculation === undefined
      || ['none', 'difference', 'ratioPercent'].includes(String(query.metricCalculation)))
    && (query.secondaryRuleMode === undefined
      || ['same', 'custom'].includes(String(query.secondaryRuleMode)))
    && (query.secondaryMatch === undefined
      || query.secondaryMatch === 'all'
      || query.secondaryMatch === 'any')
    && (query.secondaryConditions === undefined
      || (Array.isArray(query.secondaryConditions) && query.secondaryConditions.every(validCondition)))
    && isNullableString(query.groupByFieldId)
    && isNullableString(query.seriesFieldId)
    && isStringArray(query.tableFieldIds)
    && RESULT_TRANSFORMS.has(String(query.resultTransform))
    && (query.match === 'all' || query.match === 'any')
    && Array.isArray(query.conditions)
    && query.conditions.every(validCondition)
    && SORTS.has(String(query.sort))
    && isFiniteNumber(query.limit)
    && appearance
    && Array.isArray(appearance.palette)
    && appearance.palette.every(isString)
    && typeof appearance.showLegend === 'boolean'
    && typeof appearance.showDataLabels === 'boolean'
    && typeof appearance.smooth === 'boolean'
    && typeof appearance.stacked === 'boolean'
    && ['number', 'percent', 'currency'].includes(String(appearance.valueFormat))
    && isString(appearance.currencyCode)
    && isFiniteNumber(appearance.target)
    && isString(appearance.xAxisTitle)
    && isString(appearance.yAxisTitle)
    && (appearance.secondaryYAxisTitle === undefined || isString(appearance.secondaryYAxisTitle))
    && [0, 30, 45, 90].includes(Number(appearance.axisLabelRotation))
    && typeof appearance.showGrid === 'boolean'
    && (appearance.primaryLabel === undefined || isString(appearance.primaryLabel))
    && (appearance.secondaryLabel === undefined || isString(appearance.secondaryLabel))
    && (appearance.showReferenceLine === undefined || typeof appearance.showReferenceLine === 'boolean')
    && (appearance.referenceLineValue === undefined || isFiniteNumber(appearance.referenceLineValue))
    && (appearance.referenceLineLabel === undefined || isString(appearance.referenceLineLabel))
    && (appearance.referenceLineColor === undefined || isString(appearance.referenceLineColor))
    && layout
    && ['x', 'y', 'w', 'h', 'minW', 'minH'].every((key) => isFiniteNumber(layout[key])))
}

function validPage(value: unknown): boolean {
  const page = asRecord(value)
  return Boolean(page
    && hasIdentity(page)
    && isFiniteNumber(page.order)
    && Array.isArray(page.widgets)
    && page.widgets.every(validWidget))
}

function validDashboardFilter(value: unknown): boolean {
  const filter = asRecord(value)
  const validFieldType = (candidate: unknown) => FIELD_TYPES.has(String(candidate))
  const validBinding = (candidate: unknown) => {
    const binding = asRecord(candidate)
    return Boolean(binding
      && isString(binding.datasetId)
      && isString(binding.fieldId)
      && isString(binding.fieldKey)
      && isString(binding.fieldName)
      && validFieldType(binding.fieldType))
  }
  return Boolean(filter
    && isString(filter.id)
    && isString(filter.name)
    && isString(filter.fieldName)
    && (filter.fieldType === undefined || validFieldType(filter.fieldType))
    && (filter.bindings === undefined
      || (Array.isArray(filter.bindings)
        && filter.bindings.every(validBinding)
        && new Set(filter.bindings.map((binding) =>
          String(asRecord(binding)?.datasetId))).size === filter.bindings.length))
    && isString(filter.value)
    && (filter.values === undefined || isStringArray(filter.values))
    && (filter.selectionMode === undefined
      || filter.selectionMode === 'single'
      || filter.selectionMode === 'multiple')
    && (filter.operator === undefined
      || filter.operator === 'include'
      || filter.operator === 'exclude')
    && (filter.scope === undefined
      || filter.scope === 'dashboard'
      || filter.scope === 'page')
    && (filter.pageId === undefined || isNullableString(filter.pageId))
    && (filter.sourceWidgetId === undefined || isNullableString(filter.sourceWidgetId))
    && typeof filter.enabled === 'boolean')
}

function validSourceRequirement(value: unknown): boolean {
  const requirement = asRecord(value)
  if (!requirement
    || !isString(requirement.sourceDatasetId)
    || !isString(requirement.datasetName)
    || !isString(requirement.worksheetName)
    || !isString(requirement.workbookFileName)
    || !Array.isArray(requirement.fields)) return false
  return requirement.fields.every((candidate) => {
    const field = asRecord(candidate)
    const repair = field?.repair === undefined ? undefined : asRecord(field.repair)
    return Boolean(field
      && isString(field.sourceFieldId)
      && isString(field.key)
      && isString(field.name)
      && FIELD_TYPES.has(String(field.inferredType))
      && (field.sourceHeader === undefined || isString(field.sourceHeader))
      && (field.sourceColumnIndex === undefined
        || (isFiniteNumber(field.sourceColumnIndex) && Number(field.sourceColumnIndex) >= 0))
      && (repair === undefined || (repair && (
        isNullableString(repair.displayName)
        && (repair.dataType === null || FIELD_TYPES.has(String(repair.dataType)))
      ))))
  })
}

function validDashboardTemplate(value: unknown): boolean {
  if (value === undefined) return true
  const template = asRecord(value)
  return Boolean(template
    && isString(template.id)
    && template.id.length > 0
    && isString(template.version)
    && isString(template.author)
    && ['builtIn', 'package', 'teamLibrary'].includes(String(template.source))
    && isString(template.installedAt)
    && typeof template.detached === 'boolean'
    && (template.sourceRequirements === undefined
      || (Array.isArray(template.sourceRequirements)
        && template.sourceRequirements.every(validSourceRequirement))))
}

export function isDashboardRecord(value: unknown): value is DashboardRecord {
  const dashboard = asRecord(value)
  const structurallyValid = Boolean(dashboard
    && hasIdentity(dashboard)
    && isString(dashboard.projectId)
    && isString(dashboard.description)
    && ['oacWeekly', 'custom'].includes(String(dashboard.kind))
    && typeof dashboard.featured === 'boolean'
    && typeof dashboard.favorite === 'boolean'
    && Array.isArray(dashboard.pages)
    && dashboard.pages.every(validPage)
    && Array.isArray(dashboard.filters)
    && dashboard.filters.every(validDashboardFilter)
    && (dashboard.calculations === undefined
      || (Array.isArray(dashboard.calculations)
        && dashboard.calculations.every(validSavedCalculation)))
    && validDashboardTemplate(dashboard.template))
  if (!structurallyValid || !dashboard) return false
  const pages = dashboard.pages as UnknownRecord[]
  const filters = dashboard.filters as UnknownRecord[]
  const calculations = (dashboard.calculations ?? []) as UnknownRecord[]
  const pageIdList = pages.map((page) => String(page.id))
  const pageIds = new Set(pageIdList)
  const widgetIds = pages.flatMap((page) =>
    (page.widgets as UnknownRecord[]).map((widget) => String(widget.id)))
  const unique = (values: string[]) => new Set(values).size === values.length
  return unique(pageIdList)
    && unique(widgetIds)
    && unique(filters.map((filter) => String(filter.id)))
    && unique(calculations.map((calculation) => String(calculation.id)))
    && filters.every((filter) =>
      (filter.scope !== 'page'
        || (typeof filter.pageId === 'string' && pageIds.has(filter.pageId)))
      && (filter.sourceWidgetId === undefined
        || filter.sourceWidgetId === null
        || widgetIds.includes(String(filter.sourceWidgetId))))
}

export function isExportProfileRecord(value: unknown): value is ExportProfileRecord {
  const profile = asRecord(value)
  return Boolean(profile
    && hasIdentity(profile)
    && isString(profile.projectId)
    && isNullableString(profile.dashboardId)
    && ['pdf', 'pptx', 'png'].includes(String(profile.format))
    && ['widescreen', 'standard', 'letter', 'a4'].includes(String(profile.pageSize))
    && ['landscape', 'portrait'].includes(String(profile.orientation))
    && isFiniteNumber(profile.margin)
    && typeof profile.includeTitle === 'boolean'
    && typeof profile.includeGeneratedAt === 'boolean'
    && typeof profile.includePageNumbers === 'boolean'
    && ['paginate', 'shrink'].includes(String(profile.tableOverflow))
    && [1, 2, 3, 4].includes(Number(profile.scale))
    && isString(profile.headerText)
    && isString(profile.footerText))
}

function validReportFilters(value: unknown): boolean {
  if (value === undefined) return true
  const filters = asRecord(value)
  return Boolean(filters
    && isStringArray(filters.workWeeks)
    && isStringArray(filters.disciplines)
    && isStringArray(filters.contractors)
    && isStringArray(filters.subtypes)
    && isStringArray(filters.statuses)
    && typeof filters.oac === 'boolean')
}

function validLibrary(value: unknown): boolean {
  const candidate = asRecord(value)
  const storedSchemaVersion = Number(candidate?.schemaVersion)
  if (
    !candidate
    || ![1, 2, 3, LIBRARY_SCHEMA_VERSION].includes(storedSchemaVersion)
    || !Number.isInteger(candidate.revision)
    || Number(candidate.revision) < 1
    || !Array.isArray(candidate.folders)
    || !Array.isArray(candidate.projects)
    || !Array.isArray(candidate.dashboards)
    || (storedSchemaVersion >= 2 && !Array.isArray(candidate.teamLibraries))
    || !Array.isArray(candidate.exportProfiles)
    || !isStringArray(candidate.expandedFolderIds)
    || !isStringArray(candidate.expandedProjectIds)
    || !isStringArray(candidate.recentDashboardIds)
  ) return false

  const folders = candidate.folders.map(asRecord)
  const projects = candidate.projects.map(asRecord)
  const dashboards = candidate.dashboards.map(asRecord)
  const teamLibraries = storedSchemaVersion === 1
    ? []
    : (candidate.teamLibraries as unknown[]).map(asRecord)
  const exportProfiles = candidate.exportProfiles.map(asRecord)
  if (
    folders.some((folder) => !folder
      || !hasIdentity(folder)
      || !isNullableString(folder.parentId)
      || !isFiniteNumber(folder.order))
    || projects.some((project) => !project
      || !hasIdentity(project)
      || !isString(project.description)
      || !isNullableString(project.folderId)
      || !isNullableString(project.sourceFolder)
      || (project.sourceWebUrl !== undefined && !isNullableString(project.sourceWebUrl))
      || !isFiniteNumber(project.sourceFileCount)
      || !isFiniteNumber(project.sourceDatasetCount)
      || !isNullableString(project.sourceRefreshedAt)
      || !validSourceRepairs(project.sourceRepairs)
      || !validReportFilters(project.reportFilters))
    || candidate.dashboards.some((dashboard) => !isDashboardRecord(dashboard))
    || teamLibraries.some((library) => !library
      || !hasIdentity(library)
      || !isString(library.folderPath)
      || library.folderPath.length === 0
      || typeof library.enabled !== 'boolean'
      || !isFiniteNumber(library.packageCount)
      || !isNullableString(library.lastScannedAt))
    || candidate.exportProfiles.some((profile) => !isExportProfileRecord(profile))
  ) return false

  const uniqueIds = (records: Array<UnknownRecord | null>) => {
    const ids = records.map((record) => String(record?.id))
    return new Set(ids).size === ids.length
  }
  if (![folders, projects, dashboards, teamLibraries, exportProfiles].every(uniqueIds)) return false

  const folderIds = new Set(folders.map((folder) => String(folder?.id)))
  const projectIds = new Set(projects.map((project) => String(project?.id)))
  const dashboardIds = new Set(dashboards.map((dashboard) => String(dashboard?.id)))
  const teamLibraryIds = new Set(teamLibraries.map((library) => String(library?.id)))
  const dashboardProjectIds = new Map(dashboards.map((dashboard) => [
    String(dashboard?.id),
    String(dashboard?.projectId),
  ]))
  if (
    folders.some((folder) => folder?.parentId !== null && !folderIds.has(String(folder?.parentId)))
    || projects.some((project) => project?.folderId !== null && !folderIds.has(String(project?.folderId)))
    || dashboards.some((dashboard) => !projectIds.has(String(dashboard?.projectId)))
    || exportProfiles.some((profile) =>
      !projectIds.has(String(profile?.projectId))
      || (profile?.dashboardId !== null && (
        !dashboardIds.has(String(profile?.dashboardId))
        || dashboardProjectIds.get(String(profile?.dashboardId)) !== String(profile?.projectId)
      )))
    || candidate.expandedFolderIds.some((id) => !folderIds.has(id))
    || candidate.expandedProjectIds.some((id) => !projectIds.has(id))
    || candidate.recentDashboardIds.some((id) => !dashboardIds.has(id))
  ) return false

  const parentByFolder = new Map(folders.map((folder) => [
    String(folder?.id),
    folder?.parentId === null ? null : String(folder?.parentId),
  ]))
  for (const folderId of folderIds) {
    const visited = new Set<string>()
    let cursor: string | null = folderId
    while (cursor !== null) {
      if (visited.has(cursor)) return false
      visited.add(cursor)
      cursor = parentByFolder.get(cursor) ?? null
    }
  }

  const selection = asRecord(candidate.selection)
  if (!selection || !isString(selection.kind) || !isString(selection.id)) return false
  if (selection.kind === 'home') return selection.id === 'home'
  if (selection.kind === 'folder') return folderIds.has(selection.id)
  if (selection.kind === 'project') return projectIds.has(selection.id)
  if (selection.kind === 'dashboard') return dashboardIds.has(selection.id)
  if (selection.kind === 'teamLibrary') return teamLibraryIds.has(selection.id)
  return false
}

function normalizeLibrary(value: unknown): LibraryStore | null {
  if (!validLibrary(value)) return null
  const candidate = value as LibraryStore & { schemaVersion: number; teamLibraries?: TeamLibraryRecord[] }
  const dashboards = candidate.dashboards.map((dashboard) => ({
    ...dashboard,
    calculations: dashboard.calculations?.map((calculation) => ({
      ...calculation,
      resultTransform: calculation.resultTransform ?? 'none',
    })),
  }))
  const calculationsNeedMigration = candidate.dashboards.some((dashboard) =>
    dashboard.calculations?.some((calculation) => calculation.resultTransform === undefined))
  if (candidate.schemaVersion === LIBRARY_SCHEMA_VERSION && !calculationsNeedMigration) {
    return candidate
  }
  return {
    ...candidate,
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    teamLibraries: candidate.teamLibraries ?? [],
    dashboards,
  }
}

export async function loadLibrary(platform: PlatformBridge): Promise<LibraryStore> {
  const current = await platform.loadState<unknown>(LIBRARY_STORAGE_KEY)
  if (current !== null) {
    const normalized = normalizeLibrary(current)
    if (normalized) {
      if (normalized !== current) {
        await platform.saveState(LIBRARY_BACKUP_KEY, current)
        await platform.saveState(LIBRARY_STORAGE_KEY, normalized)
      }
      return normalized
    }
    const schemaVersion = typeof current === 'object' && current
      ? Number((current as { schemaVersion?: unknown }).schemaVersion)
      : Number.NaN
    if (Number.isFinite(schemaVersion) && schemaVersion > LIBRARY_SCHEMA_VERSION) {
      throw new LibraryCompatibilityError(
        `This library was created by a newer KPIntelligence data format (v${schemaVersion}). Update the app before opening it.`,
      )
    }
    throw new LibraryCompatibilityError(
      'The local dashboard library could not be validated. Its stored data was left untouched.',
    )
  }

  const legacy = await platform.loadState<WorkspaceStoreData>('workspaces')
  const migrated = legacy ? migrateWorkspaceStore(legacy) : createEmptyLibrary()
  await platform.saveState(LIBRARY_STORAGE_KEY, migrated)
  return migrated
}

export async function saveLibrary(platform: PlatformBridge, store: LibraryStore): Promise<void> {
  if (store.schemaVersion !== LIBRARY_SCHEMA_VERSION || !validLibrary(store)) {
    throw new LibraryCompatibilityError(
      'KPIntelligence refused to save an invalid dashboard library. The previous local copy was left untouched.',
    )
  }
  const previous = await platform.loadState<unknown>(LIBRARY_STORAGE_KEY)
  const normalizedPrevious = normalizeLibrary(previous)
  if (
    normalizedPrevious
    && normalizedPrevious.revision !== store.revision
  ) {
    await platform.saveState(LIBRARY_BACKUP_KEY, previous)
  }
  await platform.saveState(LIBRARY_STORAGE_KEY, store)
}

export async function loadLibraryBackup(platform: PlatformBridge): Promise<LibraryStore | null> {
  return normalizeLibrary(await platform.loadState<unknown>(LIBRARY_BACKUP_KEY))
}

export async function restoreLibraryBackup(platform: PlatformBridge): Promise<LibraryStore> {
  const backup = await loadLibraryBackup(platform)
  if (!backup) throw new Error('No valid dashboard library backup is available.')
  const current = await platform.loadState<unknown>(LIBRARY_STORAGE_KEY)
  if (current !== null) await platform.saveState(LIBRARY_RECOVERY_KEY, current)
  await platform.saveState(LIBRARY_STORAGE_KEY, backup)
  return backup
}

export async function loadLegacyFilters(platform: PlatformBridge): Promise<Record<string, ReportFilters>> {
  const legacy = await platform.loadState<WorkspaceStoreData>('workspaces')
  if (!legacy) return {}
  return Object.fromEntries(legacy.workspaces.map((workspace) => [workspace.name, workspace.filters]))
}
