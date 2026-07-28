import { strFromU8, strToU8, unzip, zipSync } from 'fflate'
import type {
  DatasetProfile,
  FieldProfile,
  SpreadsheetCatalogProfile,
} from '../data'
import { findSourceFieldRepair, rebindDashboardSources } from '../data'
import {
  createId,
  type DashboardSourceDatasetRequirement,
  type DashboardRecord,
  type ExportProfileRecord,
  type ProjectSourceRepairs,
  type SourceFieldRepairRecord,
  type StudioWidgetQuery,
} from '../library/model'
import {
  isDashboardRecord,
  isExportProfileRecord,
} from '../library/repository'
import {
  DASHBOARD_PACKAGE_EXTENSION,
  DASHBOARD_PACKAGE_KIND,
  DASHBOARD_PACKAGE_SCHEMA_VERSION,
  type DashboardPackageContentV1,
  type DashboardPackageDatasetRequirementV1,
  type DashboardPackageDocument,
  type DashboardPackageManifestV1,
  type InstalledDashboardPackage,
} from './types'

const PACKAGE_PROJECT_ID = 'package-project'
const MANIFEST_FILE = 'manifest.json'
const CONTENT_FILE = 'dashboard.json'
const MAX_PACKAGE_BYTES = 15 * 1024 * 1024
const MAX_PACKAGE_ENTRY_BYTES = 10 * 1024 * 1024
const MAX_PACKAGE_EXPANDED_BYTES = 20 * 1024 * 1024
const MAX_PACKAGE_ENTRIES = 8
const MAX_PACKAGE_PAGES = 60
const MAX_PACKAGE_WIDGETS = 500
const MAX_PACKAGE_FILTERS = 500
const MAX_PACKAGE_CONDITIONS = 5_000
const MAX_PACKAGE_TABLE_FIELDS = 500
const MAX_PACKAGE_PALETTE_COLORS = 32
const MAX_PACKAGE_SOURCE_REQUIREMENTS = 100
const MAX_PACKAGE_SOURCE_FIELDS = 1_000
const MAX_PACKAGE_CAPABILITIES = 100
const MAX_PACKAGE_STRING_LENGTH = 20_000
const MAX_PACKAGE_TOTAL_STRING_CHARACTERS = 1_000_000

type UnknownRecord = Record<string, unknown>

export class DashboardPackageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DashboardPackageError'
  }
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

function stringPayloadWithinLimits(value: unknown): boolean {
  let totalCharacters = 0
  const visit = (candidate: unknown): boolean => {
    if (typeof candidate === 'string') {
      if (candidate.length > MAX_PACKAGE_STRING_LENGTH) return false
      totalCharacters += candidate.length
      return totalCharacters <= MAX_PACKAGE_TOTAL_STRING_CHARACTERS
    }
    if (Array.isArray(candidate)) return candidate.every(visit)
    const record = asRecord(candidate)
    return !record || Object.values(record).every(visit)
  }
  return visit(value)
}

function hasOnlyKeys(value: unknown, allowed: readonly string[]): boolean {
  const record = asRecord(value)
  return Boolean(record && Object.keys(record).every((key) => allowed.includes(key)))
}

function packageContentUsesKnownSchema(value: unknown): boolean {
  const content = asRecord(value)
  if (!content || !hasOnlyKeys(content, ['dashboard', 'exportProfile'])) return false
  const dashboard = asRecord(content.dashboard)
  if (!dashboard || !hasOnlyKeys(dashboard, [
    'id', 'projectId', 'name', 'description', 'kind', 'featured', 'favorite',
    'pages', 'filters', 'calculations', 'createdAt', 'updatedAt',
  ])) return false
  if (!Array.isArray(dashboard.pages) || !dashboard.pages.every((pageValue) => {
    const page = asRecord(pageValue)
    return Boolean(page
      && hasOnlyKeys(page, ['id', 'name', 'order', 'widgets', 'createdAt', 'updatedAt'])
      && Array.isArray(page.widgets)
      && page.widgets.every((widgetValue) => {
        const widget = asRecord(widgetValue)
        const query = asRecord(widget?.query)
        const appearance = asRecord(widget?.appearance)
        const layout = asRecord(widget?.layout)
        const validConditions = (conditions: unknown) => Array.isArray(conditions)
          && conditions.every((condition) => hasOnlyKeys(
            condition,
            ['id', 'fieldId', 'operator', 'value', 'values'],
          ))
        return Boolean(widget
          && hasOnlyKeys(widget, [
            'id', 'title', 'subtitle', 'visualType', 'query', 'appearance',
            'layout', 'locked', 'createdAt', 'updatedAt',
          ])
          && query
          && hasOnlyKeys(query, [
            'datasetId', 'aggregation', 'measureFieldId', 'secondaryAggregation',
            'secondaryMeasureFieldId', 'metricCalculation', 'secondaryRuleMode',
            'secondaryMatch', 'secondaryConditions', 'groupByFieldId', 'seriesFieldId',
            'tableFieldIds', 'resultTransform', 'match', 'conditions', 'sort', 'limit',
          ])
          && validConditions(query.conditions)
          && (query.secondaryConditions === undefined
            || validConditions(query.secondaryConditions))
          && appearance
          && hasOnlyKeys(appearance, [
            'palette', 'showLegend', 'showDataLabels', 'smooth', 'stacked',
            'valueFormat', 'currencyCode', 'target', 'xAxisTitle', 'yAxisTitle',
            'secondaryYAxisTitle', 'axisLabelRotation', 'showGrid', 'primaryLabel',
            'secondaryLabel', 'showReferenceLine', 'referenceLineValue',
            'referenceLineLabel', 'referenceLineColor',
          ])
          && layout
          && hasOnlyKeys(layout, ['x', 'y', 'w', 'h', 'minW', 'minH']))
      }))
  })) return false
  if (!Array.isArray(dashboard.filters) || !dashboard.filters.every((filterValue) => {
    const filter = asRecord(filterValue)
    return Boolean(filter
      && hasOnlyKeys(filter, [
        'id', 'name', 'fieldName', 'fieldType', 'bindings', 'value', 'values',
        'selectionMode', 'operator', 'scope', 'pageId', 'sourceWidgetId', 'enabled',
      ])
      && (filter.bindings === undefined
        || (Array.isArray(filter.bindings) && filter.bindings.every((binding) =>
          hasOnlyKeys(binding, ['datasetId', 'fieldId', 'fieldKey', 'fieldName', 'fieldType'])))))
  })) return false
  if (dashboard.calculations !== undefined
    && (!Array.isArray(dashboard.calculations)
      || !dashboard.calculations.every((calculationValue) => {
        const calculation = asRecord(calculationValue)
        const validConditions = (conditions: unknown) => Array.isArray(conditions)
          && conditions.every((condition) => hasOnlyKeys(
            condition,
            ['id', 'fieldId', 'operator', 'value', 'values'],
          ))
        return Boolean(calculation
          && hasOnlyKeys(calculation, [
            'id', 'name', 'datasetId', 'aggregation', 'measureFieldId',
            'secondaryAggregation', 'secondaryMeasureFieldId', 'metricCalculation',
            'secondaryRuleMode', 'secondaryMatch', 'secondaryConditions',
            'resultTransform', 'match', 'conditions', 'valueFormat', 'currencyCode',
            'createdAt', 'updatedAt',
          ])
          && validConditions(calculation.conditions)
          && validConditions(calculation.secondaryConditions))
      }))) return false
  if (content.exportProfile !== null && !hasOnlyKeys(content.exportProfile, [
    'id', 'projectId', 'dashboardId', 'name', 'format', 'pageSize', 'orientation',
    'margin', 'includeTitle', 'includeGeneratedAt', 'includePageNumbers',
    'tableOverflow', 'scale', 'headerText', 'footerText', 'createdAt', 'updatedAt',
  ])) return false
  return true
}

function containsAbsolutePath(value: unknown): boolean {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return /^[A-Za-z]:[\\/]/.test(trimmed)
      || /^\\\\[^\\]/.test(trimmed)
      || /^\/(?!\/)/.test(trimmed)
  }
  if (Array.isArray(value)) return value.some(containsAbsolutePath)
  const record = asRecord(value)
  return Boolean(record && Object.values(record).some(containsAbsolutePath))
}

function dashboardWithinSafetyLimits(dashboard: DashboardRecord): boolean {
  if (
    dashboard.pages.length > MAX_PACKAGE_PAGES
    || dashboard.filters.length > MAX_PACKAGE_FILTERS
  ) return false

  let widgetCount = 0
  let conditionCount = 0
  for (const page of dashboard.pages) {
    widgetCount += page.widgets.length
    if (widgetCount > MAX_PACKAGE_WIDGETS) return false
    for (const widget of page.widgets) {
      conditionCount += widget.query.conditions.length
        + (widget.query.secondaryConditions?.length ?? 0)
      if (
        conditionCount > MAX_PACKAGE_CONDITIONS
        || widget.query.tableFieldIds.length > MAX_PACKAGE_TABLE_FIELDS
        || widget.appearance.palette.length > MAX_PACKAGE_PALETTE_COLORS
      ) return false
    }
  }
  for (const calculation of dashboard.calculations ?? []) {
    conditionCount += calculation.conditions.length + calculation.secondaryConditions.length
    if (conditionCount > MAX_PACKAGE_CONDITIONS) return false
  }
  return stringPayloadWithinLimits(dashboard)
}

function manifestWithinSafetyLimits(manifest: DashboardPackageManifestV1): boolean {
  return manifest.sourceRequirements.length <= MAX_PACKAGE_SOURCE_REQUIREMENTS
    && manifest.sourceRequirements.every((requirement) =>
      requirement.fields.length <= MAX_PACKAGE_SOURCE_FIELDS)
    && manifest.capabilities.length <= MAX_PACKAGE_CAPABILITIES
    && stringPayloadWithinLimits(manifest)
}

function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)
}

function semverParts(value: string): { core: number[]; prerelease: string[] | null } {
  const [core, prerelease] = value.split('-', 2)
  return {
    core: core.split('.').map((part) => Number(part)),
    prerelease: prerelease ? prerelease.split('.') : null,
  }
}

export function compareSemver(left: string, right: string): number {
  const leftParts = semverParts(left)
  const rightParts = semverParts(right)
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts.core[index] ?? 0) - (rightParts.core[index] ?? 0)
    if (difference !== 0) return difference
  }
  if (leftParts.prerelease === null && rightParts.prerelease === null) return 0
  if (leftParts.prerelease === null) return 1
  if (rightParts.prerelease === null) return -1
  const identifierCount = Math.max(leftParts.prerelease.length, rightParts.prerelease.length)
  for (let index = 0; index < identifierCount; index += 1) {
    const leftIdentifier = leftParts.prerelease[index]
    const rightIdentifier = rightParts.prerelease[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    if (leftIdentifier === rightIdentifier) continue
    const leftNumeric = /^\d+$/.test(leftIdentifier)
    const rightNumeric = /^\d+$/.test(rightIdentifier)
    if (leftNumeric && rightNumeric) return Number(leftIdentifier) - Number(rightIdentifier)
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftIdentifier.localeCompare(rightIdentifier)
  }
  return 0
}

function normalizeZipPath(value: string): string | null {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '')
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === '..')) return null
  return segments.join('/')
}

function fieldKey(fieldId: string): string {
  return fieldId.split('/field/')[1]?.split('/')[0] ?? fieldId
}

function datasetWorksheetKey(datasetId: string): string {
  return datasetId.split('/dataset/')[1]?.split('/')[0] ?? datasetId
}

function normalized(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function referencedFieldIds(query: StudioWidgetQuery): string[] {
  return [
    query.measureFieldId,
    query.secondaryMeasureFieldId,
    query.groupByFieldId,
    query.seriesFieldId,
    ...query.tableFieldIds,
    ...query.conditions.map((condition) => condition.fieldId),
    ...(query.secondaryConditions ?? []).map((condition) => condition.fieldId),
  ].filter((value): value is string => Boolean(value))
}

function sourceRequirements(
  dashboard: DashboardRecord,
  catalog: SpreadsheetCatalogProfile | null,
  sourceRepairs?: ProjectSourceRepairs,
): DashboardPackageDatasetRequirementV1[] {
  const requirements = new Map<string, Set<string>>()
  dashboard.pages.forEach((page) => page.widgets.forEach((widget) => {
    if (!widget.query.datasetId) return
    const fieldIds = requirements.get(widget.query.datasetId) ?? new Set<string>()
    referencedFieldIds(widget.query).forEach((fieldId) => fieldIds.add(fieldId))
    requirements.set(widget.query.datasetId, fieldIds)
  }))
  dashboard.calculations?.forEach((calculation) => {
    const fieldIds = requirements.get(calculation.datasetId) ?? new Set<string>()
    ;[
      calculation.measureFieldId,
      calculation.secondaryMeasureFieldId,
      ...calculation.conditions.map((condition) => condition.fieldId),
      ...calculation.secondaryConditions.map((condition) => condition.fieldId),
    ].filter((value): value is string => Boolean(value))
      .forEach((fieldId) => fieldIds.add(fieldId))
    requirements.set(calculation.datasetId, fieldIds)
  })
  dashboard.filters.forEach((filter) => {
    filter.bindings?.forEach((binding) => {
      const fieldIds = requirements.get(binding.datasetId) ?? new Set<string>()
      fieldIds.add(binding.fieldId)
      requirements.set(binding.datasetId, fieldIds)
    })
    const normalizedName = filter.fieldName.trim().toLowerCase()
    requirements.forEach((fieldIds, datasetId) => {
      const dataset = catalog?.datasets.find((candidate) => candidate.id === datasetId)
      const field = dataset?.fields.find((candidate) =>
        candidate.name.trim().toLowerCase() === normalizedName
        || candidate.headerDisplay.trim().toLowerCase() === normalizedName
        || candidate.key.trim().toLowerCase() === normalizedName)
      if (field) fieldIds.add(field.id)
    })
  })

  return [...requirements.entries()].map(([datasetId, fieldIds]) => {
    const dataset = catalog?.datasets.find((candidate) => candidate.id === datasetId)
    const workbook = dataset
      ? catalog?.workbooks.find((candidate) => candidate.id === dataset.workbookId)
      : undefined
    return {
      sourceDatasetId: datasetId,
      datasetName: dataset?.name ?? datasetWorksheetKey(datasetId),
      worksheetName: dataset?.worksheetName ?? datasetWorksheetKey(datasetId),
      workbookFileName: workbook?.fileName ?? '',
      fields: [...fieldIds].map((fieldId) => {
        const field = dataset?.fields.find((candidate) => candidate.id === fieldId)
        const repair = dataset && field && catalog
          ? findSourceFieldRepair(catalog, dataset, field, sourceRepairs)
          : undefined
        return {
          sourceFieldId: fieldId,
          key: field?.key ?? fieldKey(fieldId),
          name: field?.name ?? fieldKey(fieldId),
          inferredType: field?.inferredType ?? 'text',
          sourceHeader: field?.headerDisplay,
          sourceColumnIndex: field?.sourceColumnIndex,
          ...(repair && (repair.displayName || repair.dataType) ? {
            repair: {
              displayName: repair.displayName,
              dataType: repair.dataType,
            },
          } : {}),
        }
      }),
    }
  })
}

function packageContent(
  dashboard: DashboardRecord,
  exportProfile: ExportProfileRecord | null,
): DashboardPackageContentV1 {
  const { template: _template, ...dashboardWithoutTemplate } = structuredClone(dashboard)
  const packagedDashboard: DashboardRecord = {
    ...dashboardWithoutTemplate,
    projectId: PACKAGE_PROJECT_ID,
    featured: false,
    favorite: false,
  }
  const packagedProfile = exportProfile
    ? {
        ...structuredClone(exportProfile),
        projectId: PACKAGE_PROJECT_ID,
        dashboardId: packagedDashboard.id,
      }
    : null
  return {
    dashboard: packagedDashboard,
    exportProfile: packagedProfile,
  }
}

export function configuredLiteralCount(dashboard: DashboardRecord): number {
  const conditionCount = (condition: DashboardRecord['pages'][number]['widgets'][number]['query']['conditions'][number]) =>
    condition.values?.length ?? (condition.value.trim() ? 1 : 0)
  return dashboard.filters.reduce((total, filter) =>
    total + (filter.values?.length ?? (filter.value.trim() ? 1 : 0)), 0)
    + dashboard.pages.reduce((pageTotal, page) =>
      pageTotal + page.widgets.reduce((widgetTotal, widget) =>
        widgetTotal + [
          ...widget.query.conditions,
          ...(widget.query.secondaryConditions ?? []),
        ].reduce((total, condition) => total + conditionCount(condition), 0), 0), 0)
    + (dashboard.calculations ?? []).reduce((total, calculation) =>
      total + [...calculation.conditions, ...calculation.secondaryConditions]
        .reduce((conditionTotal, condition) =>
          conditionTotal + conditionCount(condition), 0), 0)
}

function safeFileStem(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'Dashboard'
}

async function sha256(value: Uint8Array): Promise<string> {
  const source = value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', source)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export interface CreateDashboardPackageOptions {
  dashboard: DashboardRecord
  exportProfile: ExportProfileRecord | null
  catalog: SpreadsheetCatalogProfile | null
  sourceRepairs?: ProjectSourceRepairs
  templateId: string
  templateVersion: string
  author: string
  category: string
  minAppVersion: string
  capabilities?: string[]
}

export async function createDashboardPackage(
  options: CreateDashboardPackageOptions,
): Promise<{
  bytes: Uint8Array
  fileName: string
  document: DashboardPackageDocument
}> {
  const templateId = options.templateId.trim()
  const templateVersion = options.templateVersion.trim()
  const author = options.author.trim()
  if (!templateId) throw new DashboardPackageError('Enter a stable template ID.')
  if (!isSemver(templateVersion)) {
    throw new DashboardPackageError('Use a version such as 1.0.0.')
  }
  if (!author) throw new DashboardPackageError('Enter the dashboard author or publisher.')

  const content = packageContent(options.dashboard, options.exportProfile)
  if (
    !packageContentUsesKnownSchema(content)
    || containsAbsolutePath(content)
    ||
    !dashboardWithinSafetyLimits(content.dashboard)
    || !stringPayloadWithinLimits(content.exportProfile)
  ) {
    throw new DashboardPackageError('This dashboard exceeds the package safety limits.')
  }
  const contentBytes = strToU8(JSON.stringify(content))
  const manifest: DashboardPackageManifestV1 = {
    schemaVersion: DASHBOARD_PACKAGE_SCHEMA_VERSION,
    kind: DASHBOARD_PACKAGE_KIND,
    templateId,
    templateVersion,
    name: options.dashboard.name,
    description: options.dashboard.description,
    author,
    category: options.category.trim() || 'General',
    createdAt: new Date().toISOString(),
    minAppVersion: options.minAppVersion,
    dashboardKind: options.dashboard.kind,
    sourceRequirements: sourceRequirements(
      options.dashboard,
      options.catalog,
      options.sourceRepairs,
    ),
    capabilities: options.capabilities ?? [],
    privacy: {
      includesSpreadsheetRows: false,
      includesCredentials: false,
      includesAbsolutePaths: false,
      configuredLiteralCount: configuredLiteralCount(options.dashboard),
    },
    contentSha256: await sha256(contentBytes),
  }
  if (!manifestWithinSafetyLimits(manifest)) {
    throw new DashboardPackageError('This dashboard exceeds the package safety limits.')
  }
  const bytes = zipSync({
    [MANIFEST_FILE]: strToU8(JSON.stringify(manifest, null, 2)),
    [CONTENT_FILE]: contentBytes,
  }, { level: 9 })
  return {
    bytes,
    fileName: `${safeFileStem(options.dashboard.name)}-${templateVersion}.${DASHBOARD_PACKAGE_EXTENSION}`,
    document: { manifest, content, authenticity: { status: 'unsigned' } },
  }
}

function validFieldRequirement(value: unknown): boolean {
  const field = asRecord(value)
  const repair = field?.repair === undefined ? undefined : asRecord(field.repair)
  return Boolean(field
    && hasOnlyKeys(field, [
      'sourceFieldId', 'key', 'name', 'inferredType', 'sourceHeader',
      'sourceColumnIndex', 'repair',
    ])
    && isString(field.sourceFieldId)
    && isString(field.key)
    && isString(field.name)
    && ['text', 'number', 'boolean', 'date', 'datetime', 'workWeek'].includes(String(field.inferredType))
    && (field.sourceHeader === undefined || isString(field.sourceHeader))
    && (field.sourceColumnIndex === undefined
      || (typeof field.sourceColumnIndex === 'number'
        && Number.isInteger(field.sourceColumnIndex)
        && field.sourceColumnIndex >= 0))
    && (repair === undefined || (repair
      && hasOnlyKeys(repair, ['displayName', 'dataType']) && (
      (repair.displayName === null || isString(repair.displayName))
      && (repair.dataType === null
        || ['text', 'number', 'boolean', 'date', 'datetime', 'workWeek']
          .includes(String(repair.dataType)))
    ))))
}

function validDatasetRequirement(value: unknown): boolean {
  const dataset = asRecord(value)
  return Boolean(dataset
    && hasOnlyKeys(dataset, [
      'sourceDatasetId', 'datasetName', 'worksheetName', 'workbookFileName', 'fields',
    ])
    && isString(dataset.sourceDatasetId)
    && isString(dataset.datasetName)
    && isString(dataset.worksheetName)
    && isString(dataset.workbookFileName)
    && Array.isArray(dataset.fields)
    && dataset.fields.every(validFieldRequirement))
}

function isManifest(value: unknown): value is DashboardPackageManifestV1 {
  const manifest = asRecord(value)
  const privacy = asRecord(manifest?.privacy)
  return Boolean(manifest
    && hasOnlyKeys(manifest, [
      'schemaVersion', 'kind', 'templateId', 'templateVersion', 'name', 'description',
      'author', 'category', 'createdAt', 'minAppVersion', 'dashboardKind',
      'sourceRequirements', 'capabilities', 'privacy', 'contentSha256',
    ])
    && manifest.schemaVersion === DASHBOARD_PACKAGE_SCHEMA_VERSION
    && manifest.kind === DASHBOARD_PACKAGE_KIND
    && isString(manifest.templateId)
    && manifest.templateId.length > 0
    && isString(manifest.templateVersion)
    && isSemver(manifest.templateVersion)
    && isString(manifest.name)
    && isString(manifest.description)
    && isString(manifest.author)
    && isString(manifest.category)
    && isString(manifest.createdAt)
    && isString(manifest.minAppVersion)
    && isSemver(manifest.minAppVersion)
    && ['custom', 'oacWeekly'].includes(String(manifest.dashboardKind))
    && Array.isArray(manifest.sourceRequirements)
    && manifest.sourceRequirements.length <= MAX_PACKAGE_SOURCE_REQUIREMENTS
    && manifest.sourceRequirements.every(validDatasetRequirement)
    && isStringArray(manifest.capabilities)
    && manifest.capabilities.length <= MAX_PACKAGE_CAPABILITIES
    && privacy
    && hasOnlyKeys(privacy, [
      'includesSpreadsheetRows', 'includesCredentials', 'includesAbsolutePaths',
      'configuredLiteralCount',
    ])
    && privacy.includesSpreadsheetRows === false
    && privacy.includesCredentials === false
    && privacy.includesAbsolutePaths === false
    && typeof privacy.configuredLiteralCount === 'number'
    && Number.isFinite(privacy.configuredLiteralCount)
    && isString(manifest.contentSha256)
    && /^[a-f0-9]{64}$/.test(manifest.contentSha256)
    && !containsAbsolutePath(manifest.sourceRequirements)
    && manifestWithinSafetyLimits(manifest as unknown as DashboardPackageManifestV1))
}

function parseContent(value: unknown): DashboardPackageContentV1 | null {
  const content = asRecord(value)
  if (
    !content
    || !packageContentUsesKnownSchema(content)
    || containsAbsolutePath(content)
    || !isDashboardRecord(content.dashboard)
  ) return null
  if (content.exportProfile !== null && !isExportProfileRecord(content.exportProfile)) return null
  const dashboard = content.dashboard
  const exportProfile = content.exportProfile as ExportProfileRecord | null
  if (
    dashboard.projectId !== PACKAGE_PROJECT_ID
    || !dashboardWithinSafetyLimits(dashboard)
    || !stringPayloadWithinLimits(exportProfile)
    || (exportProfile && (
      exportProfile.projectId !== PACKAGE_PROJECT_ID
      || exportProfile.dashboardId !== dashboard.id
    ))
  ) return null
  return { dashboard, exportProfile }
}

async function expandPackage(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  if (bytes.byteLength > MAX_PACKAGE_BYTES) {
    throw new DashboardPackageError('Dashboard packages must be smaller than 15 MB.')
  }
  let entryCount = 0
  let expandedBytes = 0
  let unsafe = false
  return new Promise((resolve, reject) => {
    unzip(bytes, {
      filter: (entry) => {
        entryCount += 1
        const path = normalizeZipPath(entry.name)
        if (
          !path
          || entryCount > MAX_PACKAGE_ENTRIES
          || entry.originalSize > MAX_PACKAGE_ENTRY_BYTES
        ) {
          unsafe = true
          return false
        }
        expandedBytes += entry.originalSize
        if (expandedBytes > MAX_PACKAGE_EXPANDED_BYTES) {
          unsafe = true
          return false
        }
        return path === MANIFEST_FILE || path === CONTENT_FILE
      },
    }, (error, entries) => {
      if (error || unsafe) {
        reject(new DashboardPackageError('This dashboard package is damaged or exceeds the import safety limits.'))
        return
      }
      resolve(entries)
    })
  })
}

export async function readDashboardPackage(
  input: ArrayBuffer | Uint8Array,
  currentAppVersion = __APP_VERSION__,
): Promise<DashboardPackageDocument> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const entries = await expandPackage(bytes)
  const manifestBytes = entries[MANIFEST_FILE]
  const contentBytes = entries[CONTENT_FILE]
  if (!manifestBytes || !contentBytes) {
    throw new DashboardPackageError('This file is missing its dashboard manifest or content.')
  }

  let manifestValue: unknown
  let contentValue: unknown
  try {
    manifestValue = JSON.parse(strFromU8(manifestBytes))
    contentValue = JSON.parse(strFromU8(contentBytes))
  } catch {
    throw new DashboardPackageError('This dashboard package contains invalid JSON.')
  }
  if (!isManifest(manifestValue)) {
    throw new DashboardPackageError('This dashboard package uses an unsupported or invalid manifest.')
  }
  if (compareSemver(manifestValue.minAppVersion, currentAppVersion) > 0) {
    throw new DashboardPackageError(
      `${manifestValue.name} requires KPIntelligence ${manifestValue.minAppVersion} or newer.`,
    )
  }
  if (await sha256(contentBytes) !== manifestValue.contentSha256) {
    throw new DashboardPackageError('This dashboard package failed its integrity check.')
  }
  const content = parseContent(contentValue)
  if (!content || content.dashboard.kind !== manifestValue.dashboardKind) {
    throw new DashboardPackageError('This dashboard package contains invalid dashboard content.')
  }
  if (manifestValue.privacy.configuredLiteralCount !== configuredLiteralCount(content.dashboard)) {
    throw new DashboardPackageError('This dashboard package has inconsistent privacy metadata.')
  }
  return {
    manifest: manifestValue,
    content,
    authenticity: { status: 'unsigned' },
  }
}

function placeholderField(
  requirement: DashboardPackageDatasetRequirementV1['fields'][number],
  datasetId: string,
  index: number,
): FieldProfile {
  return {
    id: requirement.sourceFieldId,
    key: requirement.key,
    name: requirement.name,
    sourceColumnIndex: index,
    sourceColumnNumber: index + 1,
    sourceColumnLabel: String(index + 1),
    headerRaw: requirement.name,
    headerDisplay: requirement.name,
    inferredType: requirement.inferredType,
    typeConfidence: 1,
    typeCounts: {
      text: 0,
      number: 0,
      boolean: 0,
      date: 0,
      datetime: 0,
      workWeek: 0,
      blank: 0,
    },
    rowCount: 0,
    nonBlankCount: 0,
    blankCount: 0,
    distinctCount: 0,
    sampleValues: [],
  }
}

function previousCatalogFromManifest(
  manifest: DashboardPackageManifestV1,
): SpreadsheetCatalogProfile {
  const datasets: DatasetProfile[] = manifest.sourceRequirements.map((requirement, datasetIndex) => ({
    id: requirement.sourceDatasetId,
    name: requirement.datasetName,
    workbookId: `package-workbook-${datasetIndex}`,
    worksheetName: requirement.worksheetName,
    worksheetIndex: datasetIndex,
    headerRowNumber: 1,
    headerConfidence: 1,
    sourceRange: null,
    rowCount: 0,
    fields: requirement.fields.map((field, index) =>
      placeholderField(field, requirement.sourceDatasetId, index)),
    rows: [],
  }))
  return {
    workbooks: [],
    datasets,
    archives: [],
    warnings: [],
  }
}

function requirementDataset(
  requirement: DashboardSourceDatasetRequirement,
  catalog: SpreadsheetCatalogProfile,
): DatasetProfile | null {
  const exact = catalog.datasets.find((dataset) => dataset.id === requirement.sourceDatasetId)
  if (exact) return exact
  const ranked = catalog.datasets.map((dataset) => {
    const workbook = catalog.workbooks.find((candidate) => candidate.id === dataset.workbookId)
    const worksheetMatch = normalized(dataset.worksheetName) === normalized(requirement.worksheetName)
    const datasetMatch = normalized(dataset.name) === normalized(requirement.datasetName)
    const workbookMatch = Boolean(requirement.workbookFileName
      && normalized(workbook?.fileName ?? '') === normalized(requirement.workbookFileName))
    const matchingFields = requirement.fields.filter((required) =>
      dataset.fields.some((field) =>
        field.key === required.key
        || normalized(field.headerDisplay) === normalized(required.sourceHeader ?? required.name)))
      .length
    return {
      dataset,
      score: (worksheetMatch ? 40 : 0)
        + (datasetMatch ? 25 : 0)
        + (workbookMatch ? 40 : 0)
        + (requirement.fields.length > 0
          ? matchingFields / requirement.fields.length * 20
          : 0),
      identityEvidence: worksheetMatch || datasetMatch || workbookMatch,
    }
  }).filter((candidate) => candidate.identityEvidence)
    .sort((left, right) => right.score - left.score)
  if (!ranked[0] || ranked[0].score < 40) return null
  if (ranked[1] && ranked[0].score - ranked[1].score < 10) return null
  return ranked[0].dataset
}

function requirementField(
  requirement: DashboardSourceDatasetRequirement['fields'][number],
  dataset: DatasetProfile,
): FieldProfile | null {
  const exact = dataset.fields.find((field) => field.id === requirement.sourceFieldId)
  if (exact) return exact
  const keyed = dataset.fields.filter((field) => field.key === requirement.key)
  if (keyed.length === 1) return keyed[0]
  const sourceHeader = normalized(requirement.sourceHeader ?? requirement.name)
  const headed = dataset.fields.filter((field) =>
    normalized(field.headerDisplay) === sourceHeader)
  if (headed.length === 1) return headed[0]
  const positional = dataset.fields.filter((field) =>
    requirement.sourceColumnIndex !== undefined
    && field.sourceColumnIndex === requirement.sourceColumnIndex
    && normalized(field.headerDisplay) === sourceHeader)
  return positional.length === 1 ? positional[0] : null
}

export function sourceRepairProposals(
  requirements: DashboardSourceDatasetRequirement[],
  catalog: SpreadsheetCatalogProfile,
  configured?: ProjectSourceRepairs,
): SourceFieldRepairRecord[] {
  const existing = configured ?? { fieldRepairs: [], reviewedDatasetIds: [] }
  const proposals = new Map<string, SourceFieldRepairRecord | null>()
  requirements.forEach((datasetRequirement) => {
    const dataset = requirementDataset(datasetRequirement, catalog)
    if (!dataset) return
    const workbook = catalog.workbooks.find((candidate) => candidate.id === dataset.workbookId)
    datasetRequirement.fields.forEach((fieldRequirement) => {
      if (!fieldRequirement.repair) return
      const field = requirementField(fieldRequirement, dataset)
      if (!field) return
      if (findSourceFieldRepair(catalog, dataset, field, existing)) return
      const displayName = fieldRequirement.repair.displayName?.trim() || null
      const dataType = fieldRequirement.repair.dataType
      if (!displayName && !dataType) return
      const targetKey = `${dataset.id}\u0000${field.id}`
      const previous = proposals.get(targetKey)
      if (previous !== undefined) {
        if (
          previous
          && previous.displayName === displayName
          && previous.dataType === dataType
        ) return
        proposals.set(targetKey, null)
        return
      }
      proposals.set(targetKey, {
        id: createId('field-repair'),
        datasetId: dataset.id,
        fieldId: field.id,
        workbookFileName: workbook?.fileName,
        datasetName: dataset.name,
        worksheetName: dataset.worksheetName,
        fieldKey: field.key,
        sourceHeader: field.headerDisplay,
        sourceColumnIndex: field.sourceColumnIndex,
        displayName,
        dataType,
        updatedAt: new Date().toISOString(),
      })
    })
  })
  return [...proposals.values()]
    .filter((proposal): proposal is SourceFieldRepairRecord => proposal !== null)
}

function dashboardBindingsResolve(
  dashboard: DashboardRecord,
  catalog: SpreadsheetCatalogProfile,
): number {
  return dashboard.pages.reduce((total, page) =>
    total + page.widgets.filter((widget) => {
      if (widget.visualType === 'text' || !widget.query.datasetId) return false
      const dataset = catalog.datasets.find((candidate) => candidate.id === widget.query.datasetId)
      if (!dataset) return true
      const fieldIds = new Set(dataset.fields.map((field) => field.id))
      return referencedFieldIds(widget.query).some((fieldId) => !fieldIds.has(fieldId))
    }).length, 0)
}

function calculationBindingsResolve(
  dashboard: DashboardRecord,
  catalog: SpreadsheetCatalogProfile,
): number {
  return (dashboard.calculations ?? []).filter((calculation) => {
    const dataset = catalog.datasets.find((candidate) => candidate.id === calculation.datasetId)
    if (!dataset) return true
    const fieldIds = new Set(dataset.fields.map((field) => field.id))
    return [
      calculation.measureFieldId,
      calculation.secondaryMeasureFieldId,
      ...calculation.conditions.map((condition) => condition.fieldId),
      ...calculation.secondaryConditions.map((condition) => condition.fieldId),
    ].filter((fieldId): fieldId is string => Boolean(fieldId))
      .some((fieldId) => !fieldIds.has(fieldId))
  }).length
}

function slicerBindingsResolve(
  dashboard: DashboardRecord,
  catalog: SpreadsheetCatalogProfile,
): number {
  return dashboard.filters.filter((filter) => {
    if (filter.bindings?.length) {
      return !filter.bindings.some((binding) => {
        const dataset = catalog.datasets.find((candidate) => candidate.id === binding.datasetId)
        return Boolean(dataset?.fields.some((field) =>
          field.id === binding.fieldId
          || (field.key === binding.fieldKey && field.inferredType === binding.fieldType)))
      })
    }
    const normalizedName = filter.fieldName.trim().toLowerCase()
    return !catalog.datasets.some((dataset) => dataset.fields.some((field) =>
      field.name.trim().toLowerCase() === normalizedName
      || field.headerDisplay.trim().toLowerCase() === normalizedName
      || field.key.trim().toLowerCase() === normalizedName))
  }).length
}

export function installDashboardPackage(
  document: DashboardPackageDocument,
  projectId: string,
  source: 'package' | 'teamLibrary',
  catalog: SpreadsheetCatalogProfile | null,
): InstalledDashboardPackage {
  const installedAt = new Date().toISOString()
  const dashboardId = createId('dashboard')
  const pageIds = new Map(document.content.dashboard.pages.map((page) => [
    page.id,
    createId('page'),
  ]))
  const dashboard: DashboardRecord = {
    ...structuredClone(document.content.dashboard),
    id: dashboardId,
    projectId,
    name: document.manifest.name,
    description: document.manifest.description,
    featured: false,
    favorite: false,
    template: {
      id: document.manifest.templateId,
      version: document.manifest.templateVersion,
      author: document.manifest.author,
      source,
      installedAt,
      detached: false,
      sourceRequirements: structuredClone(document.manifest.sourceRequirements),
    },
    filters: document.content.dashboard.filters.map((filter) => ({
      ...structuredClone(filter),
      id: createId('filter'),
      pageId: filter.pageId ? pageIds.get(filter.pageId) ?? null : null,
    })),
    calculations: (document.content.dashboard.calculations ?? []).map((calculation) => ({
      ...structuredClone(calculation),
      id: createId('calculation'),
      conditions: calculation.conditions.map((condition) => ({
        ...condition,
        id: createId('condition'),
      })),
      secondaryConditions: calculation.secondaryConditions.map((condition) => ({
        ...condition,
        id: createId('condition'),
      })),
      createdAt: installedAt,
      updatedAt: installedAt,
    })),
    pages: document.content.dashboard.pages.map((page) => ({
      ...structuredClone(page),
      id: pageIds.get(page.id) ?? createId('page'),
      widgets: page.widgets.map((widget) => ({
        ...structuredClone(widget),
        id: createId('widget'),
        query: {
          ...structuredClone(widget.query),
          conditions: widget.query.conditions.map((condition) => ({
            ...condition,
            id: createId('condition'),
          })),
          secondaryConditions: (widget.query.secondaryConditions ?? []).map((condition) => ({
            ...condition,
            id: createId('condition'),
          })),
        },
        createdAt: installedAt,
        updatedAt: installedAt,
      })),
      createdAt: installedAt,
      updatedAt: installedAt,
    })),
    createdAt: installedAt,
    updatedAt: installedAt,
  }
  const rebound = catalog
    ? rebindDashboardSources(
        dashboard,
        catalog,
        previousCatalogFromManifest(document.manifest),
      )
    : dashboard
  const exportProfile = document.content.exportProfile
    ? {
        ...structuredClone(document.content.exportProfile),
        id: createId('export'),
        projectId,
        dashboardId,
        createdAt: installedAt,
        updatedAt: installedAt,
      }
    : null
  return {
    dashboard: rebound,
    exportProfile,
    unresolvedVisualCount: catalog ? dashboardBindingsResolve(rebound, catalog) : 0,
    unresolvedCalculationCount: catalog ? calculationBindingsResolve(rebound, catalog) : 0,
    unresolvedSlicerCount: catalog ? slicerBindingsResolve(rebound, catalog) : 0,
  }
}
