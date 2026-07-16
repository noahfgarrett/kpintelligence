import * as XLSX from 'xlsx'
import { unzip } from 'fflate'
import type { ImportedSheetFile, SheetRecord, SheetRole } from '@/types'

export const DEFAULT_ROLE_NAMES: Record<SheetRole, string> = {
  bimIssues: 'BIM Issues Log',
  mechanical: 'Mechanical / Process Inspection Log',
  electrical: 'Electrical Inspection Log',
  welding: 'Welding Signoffs by Work Week',
}

const SUPPORTED_EXTENSIONS = ['.xls', '.xlsx', '.csv']
const MAX_ZIP_BYTES = 250 * 1024 * 1024
const MAX_UNZIPPED_FILE_BYTES = 100 * 1024 * 1024
const MAX_UNZIPPED_TOTAL_BYTES = 400 * 1024 * 1024
const KNOWN_HEADERS = new Set([
  'id',
  'status',
  'createdon',
  'updatedon',
  'inspectionphase',
  'phaseofinspection',
  'inspectionstatus',
  'workweekobserved',
  'observedworkweek',
  'weekobserved',
  'wwobserved',
  'issue',
  'issues',
  'issuefound',
  'issuesfound',
  'generalcontractor',
  'no',
  'weldno',
  'weldnumber',
  'weldid',
  'weldworkweek',
  'weldww',
  'workweekwelded',
  'signature',
  'weldsignature',
  'inspectorsignature',
  'signedby',
  'issuecreatedputbimifyes',
])

interface ParsedWorksheet {
  name: string
  rows: Record<string, unknown>[]
  headers: Set<string>
  quality: number
}

interface DroppedFileEntry {
  isFile: true
  isDirectory: false
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void
}

interface DroppedDirectoryReader {
  readEntries: (success: (entries: DroppedEntry[]) => void, error?: (error: DOMException) => void) => void
}

interface DroppedDirectoryEntry {
  isFile: false
  isDirectory: true
  createReader: () => DroppedDirectoryReader
}

type DroppedEntry = DroppedFileEntry | DroppedDirectoryEntry

interface EntryDataTransferItem {
  webkitGetAsEntry?: () => DroppedEntry | null
}

function normalized(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function extension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : ''
}

function isSpreadsheet(fileName: string): boolean {
  return SUPPORTED_EXTENSIONS.includes(extension(fileName))
}

function baseName(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? filePath
}

function unzipArchive(file: File): Promise<File[]> {
  if (file.size > MAX_ZIP_BYTES) {
    throw new Error(`${file.name}: ZIP files must be smaller than 250 MB.`)
  }

  return file.arrayBuffer().then((buffer) => new Promise<File[]>((resolve, reject) => {
    let totalBytes = 0
    let oversized = false
    unzip(
      new Uint8Array(buffer),
      {
        filter: (entry) => {
          const name = entry.name.replace(/\\/g, '/')
          const include = isSpreadsheet(name)
            && !name.startsWith('__MACOSX/')
            && !baseName(name).startsWith('._')
          if (!include) return false
          if (entry.originalSize > MAX_UNZIPPED_FILE_BYTES) {
            oversized = true
            return false
          }
          totalBytes += entry.originalSize
          if (totalBytes > MAX_UNZIPPED_TOTAL_BYTES) {
            oversized = true
            return false
          }
          return true
        },
      },
      (error, entries) => {
        if (error) {
          reject(new Error(`${file.name}: the ZIP archive could not be read.`))
          return
        }
        if (oversized) {
          reject(new Error(`${file.name}: the ZIP archive is too large to import safely.`))
          return
        }
        const files = Object.entries(entries).map(([path, bytes]) => new File(
          [bytes],
          baseName(path),
          { lastModified: file.lastModified },
        ))
        if (files.length === 0) {
          reject(new Error(`${file.name}: no XLS, XLSX, or CSV reports were found in the ZIP.`))
          return
        }
        resolve(files)
      },
    )
  }))
}

export async function expandImportFiles(files: File[]): Promise<File[]> {
  const expanded: File[] = []
  for (const file of files) {
    if (extension(file.name) === '.zip') expanded.push(...await unzipArchive(file))
    else if (isSpreadsheet(file.name)) expanded.push(file)
  }
  if (expanded.length === 0) {
    throw new Error('No XLS, XLSX, CSV, or ZIP report files were found.')
  }
  return expanded
}

function droppedFile(entry: DroppedFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

async function directoryEntries(reader: DroppedDirectoryReader): Promise<DroppedEntry[]> {
  const entries: DroppedEntry[] = []
  while (true) {
    const batch = await new Promise<DroppedEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) return entries
    entries.push(...batch)
  }
}

async function filesFromEntry(entry: DroppedEntry): Promise<File[]> {
  if (entry.isFile) return [await droppedFile(entry)]
  const children = await directoryEntries(entry.createReader())
  return (await Promise.all(children.map(filesFromEntry))).flat()
}

export async function filesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
  const entries = Array.from(dataTransfer.items)
    .map((item) => (item as unknown as EntryDataTransferItem).webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is DroppedEntry => entry !== null)
  if (entries.length === 0) return Array.from(dataTransfer.files)
  return (await Promise.all(entries.map(filesFromEntry))).flat()
}

function headerScore(row: unknown[]): number {
  return row.reduce<number>((score, cell) => score + (KNOWN_HEADERS.has(normalized(cell)) ? 1 : 0), 0)
}

function parseWorksheet(name: string, worksheet: XLSX.WorkSheet): ParsedWorksheet | null {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: '',
    raw: false,
  })
  if (matrix.length === 0) return null

  let headerRow = 0
  let bestScore = -1
  matrix.slice(0, 20).forEach((row, index) => {
    const score = headerScore(row)
    if (score > bestScore) {
      headerRow = index
      bestScore = score
    }
  })

  const headers = new Set((matrix[headerRow] ?? []).map(normalized).filter(Boolean))
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    range: headerRow,
    defval: '',
    raw: false,
  }).map((row, index) => ({ ...row, __rowNumber: headerRow + index + 2 }))

  if (rows.length === 0) return null
  return {
    name,
    rows,
    headers,
    quality: bestScore * 100 + Math.min(rows.length, 99),
  }
}

function includesAll(headers: Set<string>, values: string[]): boolean {
  return values.every((header) => headers.has(header))
}

function includesAny(headers: Set<string>, values: string[]): boolean {
  return values.some((header) => headers.has(header))
}

function roleScores(fileName: string, headers: Set<string>): Record<SheetRole, number> {
  const name = normalized(fileName.replace(/\.[^.]+$/, ''))
  const inspectionHeaders = includesAny(headers, ['inspectionphase', 'phaseofinspection', 'inspectionstatus'])
    && includesAny(headers, ['workweekobserved', 'observedworkweek', 'weekobserved', 'wwobserved', 'workweek'])
  const weldingHeaders = includesAny(headers, ['no', 'weldno', 'weldnumber', 'weldid'])
    && includesAny(headers, ['weldworkweek', 'weldww', 'workweekwelded'])
    && includesAny(headers, ['signature', 'weldsignature', 'inspectorsignature', 'signedby', 'signed'])
  const scores: Record<SheetRole, number> = {
    bimIssues: includesAll(headers, ['id', 'status', 'createdon']) ? 12 : 0,
    mechanical: inspectionHeaders ? 7 : 0,
    electrical: inspectionHeaders ? 7 : 0,
    welding: weldingHeaders ? 12 : 0,
  }

  if (name.includes('bim') && name.includes('issue')) scores.bimIssues += 14
  if ((name.includes('mechanical') || name.includes('process')) && name.includes('inspection')) scores.mechanical += 14
  if (name.includes('electrical') && name.includes('inspection')) scores.electrical += 14
  if (name.includes('weld')) scores.welding += name.includes('sign') ? 14 : 10
  return scores
}

function identifyRole(fileName: string, headers: Set<string>): SheetRole {
  const scores = roleScores(fileName, headers)
  const ordered = (Object.entries(scores) as Array<[SheetRole, number]>).sort((a, b) => b[1] - a[1])
  const [best, next] = ordered
  if (best[1] < 10) {
    throw new Error(`${fileName}: could not match this export to one of the four required logs.`)
  }
  if (best[1] === next[1]) {
    throw new Error(`${fileName}: inspection exports need "Mechanical", "Process", or "Electrical" in the filename.`)
  }
  return best[0]
}

export async function importSpreadsheet(file: File): Promise<ImportedSheetFile> {
  if (!SUPPORTED_EXTENSIONS.includes(extension(file.name))) {
    throw new Error(`${file.name}: use an .xls, .xlsx, or .csv Smartsheet export.`)
  }

  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(await file.arrayBuffer(), {
      type: 'array',
      cellDates: false,
      dense: true,
    })
  } catch {
    throw new Error(`${file.name}: the spreadsheet could not be read.`)
  }

  const worksheets = workbook.SheetNames
    .map((name) => parseWorksheet(name, workbook.Sheets[name]))
    .filter((sheet): sheet is ParsedWorksheet => sheet !== null)

  if (worksheets.length === 0) {
    throw new Error(`${file.name}: no populated worksheet was found.`)
  }

  const candidates = worksheets.map((worksheet) => {
    const scores = roleScores(file.name, worksheet.headers)
    return {
      worksheet,
      roleScore: Math.max(...Object.values(scores)),
    }
  }).sort((a, b) => b.roleScore - a.roleScore || b.worksheet.quality - a.worksheet.quality)

  const worksheet = candidates[0].worksheet
  const role = identifyRole(file.name, worksheet.headers)
  const sheet: SheetRecord = {
    id: `${file.name}:${worksheet.name}`,
    name: DEFAULT_ROLE_NAMES[role],
    rows: worksheet.rows,
  }

  return {
    role,
    fileName: file.name,
    worksheetName: worksheet.name,
    rowCount: worksheet.rows.length,
    sheet,
  }
}
