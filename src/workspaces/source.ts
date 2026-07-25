import type { PlatformBridge, SourceFileDescriptor } from '@/platform'
import { expandImportFiles, importSpreadsheet } from '@/services/fileImport'
import type { SheetRole } from '@/types'
import type { WorkspaceSourceSnapshot } from './types'

const SUPPORTED_EXTENSIONS = new Set(['zip', 'xls', 'xlsx', 'csv'])
const STABILITY_DELAY_MS = 900
const STABILITY_ATTEMPTS = 4
const MAX_SOURCE_FILES = 500
const MAX_SOURCE_FILE_BYTES = 250 * 1024 * 1024
const MAX_SOURCE_TOTAL_BYTES = 750 * 1024 * 1024
const DIRECT_BATCH_WINDOW_MS = 36 * 60 * 60 * 1000
const REQUIRED_ROLES: SheetRole[] = ['bimIssues', 'mechanical', 'electrical', 'welding']

interface RoleBatchEntry {
  role: SheetRole
  modifiedAt: number
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isUsableSourceFile(file: SourceFileDescriptor): boolean {
  const segments = file.path.replace(/\\/g, '/').split('/')
  const hidden = segments.some((segment) => segment.startsWith('.') || segment === '__MACOSX')
  const temporary = file.name.startsWith('~$')
    || file.name.startsWith('._')
    || /\.(crdownload|download|part|partial|tmp)$/i.test(file.name)
  return !hidden && !temporary && file.size > 0 && SUPPORTED_EXTENSIONS.has(extension(file.name))
}

export function sourceFingerprint(files: SourceFileDescriptor[]): string {
  return files
    .filter(isUsableSourceFile)
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => `${file.path}:${file.size}:${file.modifiedAt}`)
    .join('|')
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

async function stableDescriptors(platform: PlatformBridge, rootPath: string): Promise<SourceFileDescriptor[]> {
  let previous: string | null = null
  for (let attempt = 0; attempt < STABILITY_ATTEMPTS; attempt += 1) {
    const files = (await platform.listFiles(rootPath)).filter(isUsableSourceFile)
    const fingerprint = sourceFingerprint(files)
    if (fingerprint && fingerprint === previous) return files
    previous = fingerprint
    await wait(STABILITY_DELAY_MS)
  }
  throw new Error('The synced reports are still changing. KPIntelligence kept the last good dashboard and will retry shortly.')
}

async function descriptorFile(platform: PlatformBridge, descriptor: SourceFileDescriptor): Promise<File> {
  const bytes = await platform.readFile(descriptor.path)
  return new File([bytes], descriptor.name, { lastModified: descriptor.modifiedAt })
}

async function completeZip(platform: PlatformBridge, candidates: SourceFileDescriptor[]): Promise<File | null> {
  for (const candidate of candidates) {
    const file = await descriptorFile(platform, candidate)
    try {
      const expanded = await expandImportFiles([file])
      const results = await Promise.allSettled(expanded.map(importSpreadsheet))
      const roles = results.flatMap((result) => result.status === 'fulfilled' ? [result.value.role] : [])
      if (new Set(roles).size === 4) return file
    } catch {
      // A newer incomplete export should not displace the last complete weekly package.
    }
  }
  return null
}

export function selectCoherentRoleBatch<T extends RoleBatchEntry>(
  entries: readonly T[],
  windowMilliseconds = DIRECT_BATCH_WINDOW_MS,
): T[] | null {
  const ordered = [...entries].sort((left, right) => right.modifiedAt - left.modifiedAt)
  for (const newest of ordered) {
    const candidates = ordered.filter((entry) =>
      entry.modifiedAt <= newest.modifiedAt
      && newest.modifiedAt - entry.modifiedAt <= windowMilliseconds)
    const byRole = new Map<SheetRole, T>()
    candidates.forEach((entry) => {
      if (!byRole.has(entry.role)) byRole.set(entry.role, entry)
    })
    if (REQUIRED_ROLES.every((role) => byRole.has(role))) {
      return REQUIRED_ROLES.map((role) => byRole.get(role) as T)
    }
  }
  return null
}

async function newestDirectFiles(platform: PlatformBridge, candidates: SourceFileDescriptor[]): Promise<File[]> {
  const identified: Array<RoleBatchEntry & { file: File }> = []
  for (const candidate of candidates) {
    const file = await descriptorFile(platform, candidate)
    try {
      const imported = await importSpreadsheet(file)
      identified.push({
        role: imported.role,
        file,
        modifiedAt: candidate.modifiedAt,
      })
      const coherent = selectCoherentRoleBatch(identified)
      if (coherent) return coherent.map((entry) => entry.file)
    } catch {
      // Ignore unrelated spreadsheets in a recursively scanned project folder.
    }
  }
  const roleCount = new Set(identified.map((entry) => entry.role)).size
  if (roleCount === 4) {
    throw new Error('The four required reports are from different export batches. Add the remaining current reports or use one ZIP package.')
  }
  throw new Error(`Found ${roleCount} of 4 required reports. Add the BIM, Mechanical, Electrical, and Welding exports to this folder.`)
}

export async function loadWorkspaceSource(platform: PlatformBridge, rootPath: string): Promise<WorkspaceSourceSnapshot> {
  const descriptors = await stableDescriptors(platform, rootPath)
  if (descriptors.length === 0) throw new Error('No ZIP, XLS, XLSX, or CSV reports were found in this folder.')
  if (descriptors.length > MAX_SOURCE_FILES) {
    throw new Error(`This folder contains more than ${MAX_SOURCE_FILES} spreadsheet files. Choose a narrower project folder.`)
  }
  const oversized = descriptors.find((file) => file.size > MAX_SOURCE_FILE_BYTES)
  if (oversized) throw new Error(`${oversized.name} is larger than the 250 MB per-file safety limit.`)
  if (descriptors.reduce((total, file) => total + file.size, 0) > MAX_SOURCE_TOTAL_BYTES) {
    throw new Error('The selected spreadsheets exceed the 750 MB project safety limit.')
  }

  const newestFirst = [...descriptors].sort((a, b) => b.modifiedAt - a.modifiedAt || b.size - a.size)
  const zip = await completeZip(platform, newestFirst.filter((file) => extension(file.name) === 'zip'))
  const files = zip ?? await newestDirectFiles(
    platform,
    newestFirst.filter((file) => extension(file.name) !== 'zip'),
  )
  return {
    files: Array.isArray(files) ? files : [files],
    fingerprint: sourceFingerprint(descriptors),
    displayNames: (Array.isArray(files) ? files : [files]).map((file) => file.name),
    loadedAt: new Date().toISOString(),
  }
}
