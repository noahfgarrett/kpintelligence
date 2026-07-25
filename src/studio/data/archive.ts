import { unzip } from 'fflate'
import type {
  ArchiveProfile,
  SpreadsheetBinaryInput,
  SpreadsheetProfileInput,
} from './types'
import { SpreadsheetProfileError } from './types'

export const ARCHIVE_SAFETY_LIMITS = Object.freeze({
  maxCompressedBytes: 250 * 1024 * 1024,
  maxEntryBytes: 100 * 1024 * 1024,
  maxExpandedBytes: 400 * 1024 * 1024,
})

export const SUPPORTED_SPREADSHEET_EXTENSIONS = Object.freeze(['.xls', '.xlsx', '.csv'] as const)

export interface MaterializedInput {
  name: string
  bytes: Uint8Array
  lastModified?: number
  path: string
}

export interface ExpandedArchive {
  files: SpreadsheetBinaryInput[]
  profile: ArchiveProfile
}

function extension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : ''
}

export function isSupportedSpreadsheet(fileName: string): boolean {
  return (SUPPORTED_SPREADSHEET_EXTENSIONS as readonly string[]).includes(extension(fileName))
}

export function isZipArchive(fileName: string): boolean {
  return extension(fileName) === '.zip'
}

function isFileLike(input: SpreadsheetProfileInput): input is Exclude<
  SpreadsheetProfileInput,
  SpreadsheetBinaryInput
> {
  return 'arrayBuffer' in input && typeof input.arrayBuffer === 'function'
}

function toUint8Array(bytes: ArrayBuffer | Uint8Array): Uint8Array {
  if (bytes instanceof Uint8Array) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  return new Uint8Array(bytes)
}

export async function materializeInput(input: SpreadsheetProfileInput): Promise<MaterializedInput> {
  if (isFileLike(input)) {
    const bytes = new Uint8Array(await input.arrayBuffer())
    return {
      name: input.name,
      bytes,
      lastModified: input.lastModified,
      path: input.webkitRelativePath || input.name,
    }
  }

  return {
    name: input.name,
    bytes: toUint8Array(input.bytes),
    lastModified: input.lastModified,
    path: input.path || input.name,
  }
}

export function assertArchiveCompressedSize(size: number, fileName: string): void {
  if (size > ARCHIVE_SAFETY_LIMITS.maxCompressedBytes) {
    throw new SpreadsheetProfileError(
      'archive-too-large',
      `${fileName}: ZIP files must be smaller than 250 MB.`,
    )
  }
}

function normalizeArchivePath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '')
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === '..')) return null
  return segments.join('/')
}

function shouldIgnoreArchiveEntry(path: string): boolean {
  const parts = path.split('/')
  const baseName = parts[parts.length - 1] ?? ''
  return parts.includes('__MACOSX')
    || baseName.startsWith('._')
    || baseName.startsWith('~$')
}

function displayName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

export async function expandArchive(input: SpreadsheetProfileInput): Promise<ExpandedArchive> {
  const reportedSize = 'size' in input && typeof input.size === 'number' ? input.size : 0
  assertArchiveCompressedSize(reportedSize, input.name)
  const materialized = await materializeInput(input)
  assertArchiveCompressedSize(
    Math.max(reportedSize, materialized.bytes.byteLength),
    materialized.name,
  )

  let uncompressedSpreadsheetBytes = 0
  let ignoredEntryCount = 0
  let limitViolation = false

  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(
      materialized.bytes,
      {
        filter: (entry) => {
          const path = normalizeArchivePath(entry.name)
          if (!path || !isSupportedSpreadsheet(path) || shouldIgnoreArchiveEntry(path)) {
            ignoredEntryCount += 1
            return false
          }
          if (entry.originalSize > ARCHIVE_SAFETY_LIMITS.maxEntryBytes) {
            limitViolation = true
            return false
          }
          uncompressedSpreadsheetBytes += entry.originalSize
          if (uncompressedSpreadsheetBytes > ARCHIVE_SAFETY_LIMITS.maxExpandedBytes) {
            limitViolation = true
            return false
          }
          return true
        },
      },
      (error, result) => {
        if (error) {
          reject(new SpreadsheetProfileError(
            'archive-unreadable',
            `${materialized.name}: the ZIP archive could not be read.`,
            { cause: error },
          ))
          return
        }
        resolve(result)
      },
    )
  })

  if (limitViolation) {
    throw new SpreadsheetProfileError(
      'archive-too-large',
      `${materialized.name}: the ZIP archive is too large to import safely.`,
    )
  }

  const files = Object.entries(entries).flatMap(([entryPath, bytes]) => {
    const normalizedPath = normalizeArchivePath(entryPath)
    if (!normalizedPath) return []
    return [{
      name: displayName(normalizedPath),
      bytes,
      size: bytes.byteLength,
      lastModified: materialized.lastModified,
      path: normalizedPath,
    }]
  })

  if (files.length === 0) {
    throw new SpreadsheetProfileError(
      'archive-empty',
      `${materialized.name}: no XLS, XLSX, or CSV files were found in the ZIP.`,
    )
  }

  return {
    files,
    profile: {
      fileName: materialized.name,
      compressedBytes: materialized.bytes.byteLength,
      uncompressedSpreadsheetBytes,
      spreadsheetEntryCount: files.length,
      ignoredEntryCount,
    },
  }
}
