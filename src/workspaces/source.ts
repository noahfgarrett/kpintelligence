import type { PlatformBridge, SourceFileDescriptor } from '@/platform'
import { expandImportFiles, importSpreadsheet } from '@/services/fileImport'
import type { SheetRole } from '@/types'
import type { WorkspaceSourceSnapshot } from './types'

const SUPPORTED_EXTENSIONS = new Set(['zip', 'xls', 'xlsx', 'csv'])
const STABILITY_DELAY_MS = 900
const STABILITY_ATTEMPTS = 4

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
  throw new Error('The synced reports are still changing. QCx kept the last good dashboard and will retry shortly.')
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

async function newestDirectFiles(platform: PlatformBridge, candidates: SourceFileDescriptor[]): Promise<File[]> {
  const byRole = new Map<SheetRole, File>()
  for (const candidate of candidates) {
    if (byRole.size === 4) break
    const file = await descriptorFile(platform, candidate)
    try {
      const imported = await importSpreadsheet(file)
      if (!byRole.has(imported.role)) byRole.set(imported.role, file)
    } catch {
      // Ignore unrelated spreadsheets in a recursively scanned project folder.
    }
  }
  if (byRole.size !== 4) {
    throw new Error(`Found ${byRole.size} of 4 required reports. Add the BIM, Mechanical, Electrical, and Welding exports to this folder.`)
  }
  return Array.from(byRole.values())
}

export async function loadWorkspaceSource(platform: PlatformBridge, rootPath: string): Promise<WorkspaceSourceSnapshot> {
  const descriptors = await stableDescriptors(platform, rootPath)
  if (descriptors.length === 0) throw new Error('No ZIP, XLS, XLSX, or CSV reports were found in this folder.')

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
