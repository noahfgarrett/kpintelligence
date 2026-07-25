export type SpreadsheetFormat = 'xls' | 'xlsx' | 'csv'

export type InferredFieldType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'workWeek'

export type ProfiledCellKind =
  | 'blank'
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'error'

export type ProfiledRawValue = string | number | boolean | Date | null

export interface SpreadsheetBinaryInput {
  name: string
  bytes: ArrayBuffer | Uint8Array
  lastModified?: number
  /**
   * Optional size reported by the host before bytes are read. The profiler
   * checks the larger of this value and the materialized byte length.
   */
  size?: number
  path?: string
}

export interface SpreadsheetFileLike {
  name: string
  size: number
  lastModified?: number
  webkitRelativePath?: string
  arrayBuffer: () => Promise<ArrayBuffer>
}

export type SpreadsheetProfileInput = SpreadsheetBinaryInput | SpreadsheetFileLike

export interface WorkbookSourceProfile {
  kind: 'file' | 'archiveEntry'
  fileName: string
  path: string
  byteLength: number
  lastModified?: number
  archiveName?: string
  archivePath?: string
}

export interface ProfiledCell {
  raw: ProfiledRawValue
  display: string
  kind: ProfiledCellKind
  isBlank: boolean
  numberFormat?: string
}

export interface ProfiledRow {
  sourceRowNumber: number
  cells: Record<string, ProfiledCell>
}

export interface FieldTypeCounts {
  text: number
  number: number
  boolean: number
  date: number
  datetime: number
  workWeek: number
  blank: number
}

export interface FieldSampleValue {
  raw: Exclude<ProfiledRawValue, null>
  display: string
  count: number
}

export interface FieldProfile {
  id: string
  key: string
  name: string
  sourceColumnIndex: number
  sourceColumnNumber: number
  sourceColumnLabel: string
  headerRaw: ProfiledRawValue
  headerDisplay: string
  inferredType: InferredFieldType
  typeConfidence: number
  typeCounts: FieldTypeCounts
  rowCount: number
  nonBlankCount: number
  blankCount: number
  distinctCount: number
  sampleValues: FieldSampleValue[]
}

export interface DatasetProfile {
  id: string
  name: string
  workbookId: string
  worksheetName: string
  worksheetIndex: number
  headerRowNumber: number
  headerConfidence: number
  sourceRange: string | null
  rowCount: number
  fields: FieldProfile[]
  rows: ProfiledRow[]
}

export interface WorksheetProfile {
  id: string
  name: string
  index: number
  sourceRange: string | null
  populatedCellCount: number
  dataset: DatasetProfile | null
  warnings: string[]
}

export interface WorkbookProfile {
  id: string
  fileName: string
  format: SpreadsheetFormat
  source: WorkbookSourceProfile
  worksheetCount: number
  worksheets: WorksheetProfile[]
  datasets: DatasetProfile[]
  warnings: string[]
}

export interface ArchiveProfile {
  fileName: string
  compressedBytes: number
  uncompressedSpreadsheetBytes: number
  spreadsheetEntryCount: number
  ignoredEntryCount: number
}

export interface SpreadsheetCatalogProfile {
  workbooks: WorkbookProfile[]
  datasets: DatasetProfile[]
  archives: ArchiveProfile[]
  warnings: string[]
}

export interface WorkbookProfilerOptions {
  headerScanRows?: number
  sampleValueLimit?: number
}

export type SpreadsheetProfileErrorCode =
  | 'unsupported-file'
  | 'archive-too-large'
  | 'archive-unreadable'
  | 'archive-empty'
  | 'workbook-unreadable'
  | 'workbook-empty'
  | 'workbook-too-large'

export class SpreadsheetProfileError extends Error {
  readonly code: SpreadsheetProfileErrorCode
  readonly cause?: unknown

  constructor(
    code: SpreadsheetProfileErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message)
    this.name = 'SpreadsheetProfileError'
    this.code = code
    this.cause = options?.cause
  }
}
