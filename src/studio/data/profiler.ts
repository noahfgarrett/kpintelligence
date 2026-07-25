import * as XLSX from 'xlsx'
import {
  expandArchive,
  isSupportedSpreadsheet,
  isZipArchive,
  materializeInput,
} from './archive'
import { inferField } from './inference'
import {
  normalizeStableId,
  stableSourceId,
  uniqueStableSegment,
} from './identifiers'
import type {
  ArchiveProfile,
  DatasetProfile,
  FieldProfile,
  ProfiledCell,
  ProfiledCellKind,
  ProfiledRawValue,
  SpreadsheetCatalogProfile,
  SpreadsheetFormat,
  SpreadsheetProfileInput,
  WorkbookProfile,
  WorkbookProfilerOptions,
  WorkbookSourceProfile,
  WorksheetProfile,
} from './types'
import { SpreadsheetProfileError } from './types'

const DEFAULT_HEADER_SCAN_ROWS = 50
const DEFAULT_SAMPLE_VALUE_LIMIT = 8
const MAX_WORKBOOK_WORKSHEETS = 100
const MAX_WORKSHEET_ROWS = 250_000
const MAX_WORKSHEET_COLUMNS = 10_000
const MAX_WORKSHEET_POPULATED_CELLS = 2_000_000

interface WorksheetCellMap {
  rows: Map<number, Map<number, ProfiledCell>>
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
  populatedCellCount: number
}

interface HeaderCandidate {
  rowIndex: number
  score: number
}

interface ProfileSourceContext {
  source: WorkbookSourceProfile
  locator: string
}

function extension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : ''
}

function workbookFormat(fileName: string): SpreadsheetFormat {
  const value = extension(fileName)
  if (value === '.xls') return 'xls'
  if (value === '.xlsx') return 'xlsx'
  if (value === '.csv') return 'csv'
  throw new SpreadsheetProfileError(
    'unsupported-file',
    `${fileName}: use an XLS, XLSX, CSV, or ZIP spreadsheet file.`,
  )
}

function fileStem(fileName: string): string {
  const parts = fileName.replace(/\\/g, '/').split('/')
  const baseName = parts[parts.length - 1] ?? fileName
  return baseName.replace(/\.[^.]+$/, '')
}

function safeDisplayValue(cell: XLSX.CellObject): string {
  try {
    return cell.w ?? XLSX.utils.format_cell(cell)
  } catch {
    return cell.v === undefined || cell.v === null ? '' : String(cell.v)
  }
}

function dateFromNumber(value: number): Date | null {
  const parsed = XLSX.SSF.parse_date_code(value)
  if (!parsed) return null
  return new Date(Date.UTC(
    parsed.y,
    parsed.m - 1,
    parsed.d,
    parsed.H,
    parsed.M,
    Math.floor(parsed.S),
    Math.round((parsed.S % 1) * 1000),
  ))
}

function rawCellValue(cell: XLSX.CellObject): {
  raw: ProfiledRawValue
  kind: ProfiledCellKind
} {
  if (cell.t === 'e') {
    return { raw: safeDisplayValue(cell), kind: 'error' }
  }
  if (cell.t === 'd') {
    const date = cell.v instanceof Date ? cell.v : new Date(String(cell.v))
    return Number.isNaN(date.valueOf())
      ? { raw: String(cell.v ?? ''), kind: 'text' }
      : { raw: date, kind: 'date' }
  }
  if (
    cell.t === 'n'
    && typeof cell.v === 'number'
    && typeof cell.z === 'string'
    && XLSX.SSF.is_date(cell.z)
  ) {
    const date = dateFromNumber(cell.v)
    if (date) return { raw: date, kind: 'date' }
  }
  if (cell.t === 'b') return { raw: Boolean(cell.v), kind: 'boolean' }
  if (cell.t === 'n' && typeof cell.v === 'number') return { raw: cell.v, kind: 'number' }
  if (cell.v === undefined || cell.v === null) return { raw: null, kind: 'blank' }
  return { raw: String(cell.v), kind: 'text' }
}

function profiledCell(cell: XLSX.CellObject): ProfiledCell {
  const { raw, kind } = rawCellValue(cell)
  const display = safeDisplayValue(cell)
  const isBlank = raw === null || (typeof raw === 'string' && raw.trim() === '')
  return {
    raw,
    display,
    kind: isBlank ? 'blank' : kind,
    isBlank,
    ...(typeof cell.z === 'string' ? { numberFormat: cell.z } : {}),
  }
}

function blankCell(): ProfiledCell {
  return {
    raw: null,
    display: '',
    kind: 'blank',
    isBlank: true,
  }
}

function worksheetCells(
  worksheet: XLSX.WorkSheet,
  worksheetName: string,
): WorksheetCellMap | null {
  if (worksheet['!ref']) {
    try {
      const range = XLSX.utils.decode_range(worksheet['!ref'])
      const rowCount = range.e.r - range.s.r + 1
      const columnCount = range.e.c - range.s.c + 1
      if (rowCount > MAX_WORKSHEET_ROWS || columnCount > MAX_WORKSHEET_COLUMNS) {
        throw new SpreadsheetProfileError(
          'workbook-too-large',
          `${worksheetName}: the worksheet range exceeds the ${MAX_WORKSHEET_ROWS.toLocaleString()} row or ${MAX_WORKSHEET_COLUMNS.toLocaleString()} column safety limit.`,
        )
      }
    } catch (error) {
      if (error instanceof SpreadsheetProfileError) throw error
    }
  }

  const rows = new Map<number, Map<number, ProfiledCell>>()
  let minRow = Number.POSITIVE_INFINITY
  let maxRow = -1
  let minColumn = Number.POSITIVE_INFINITY
  let maxColumn = -1
  let populatedCellCount = 0

  Object.entries(worksheet).forEach(([address, value]) => {
    if (address.startsWith('!') || !value || typeof value !== 'object') return
    let coordinate: XLSX.CellAddress
    try {
      coordinate = XLSX.utils.decode_cell(address)
    } catch {
      return
    }

    const cell = profiledCell(value as XLSX.CellObject)
    if (cell.isBlank) return
    const row = rows.get(coordinate.r) ?? new Map<number, ProfiledCell>()
    row.set(coordinate.c, cell)
    rows.set(coordinate.r, row)
    minRow = Math.min(minRow, coordinate.r)
    maxRow = Math.max(maxRow, coordinate.r)
    minColumn = Math.min(minColumn, coordinate.c)
    maxColumn = Math.max(maxColumn, coordinate.c)
    populatedCellCount += 1
    if (populatedCellCount > MAX_WORKSHEET_POPULATED_CELLS) {
      throw new SpreadsheetProfileError(
        'workbook-too-large',
        `${worksheetName}: the worksheet contains more than ${MAX_WORKSHEET_POPULATED_CELLS.toLocaleString()} populated cells.`,
      )
    }
  })

  if (populatedCellCount === 0) return null
  return {
    rows,
    minRow,
    maxRow,
    minColumn,
    maxColumn,
    populatedCellCount,
  }
}

function headerValue(cell: ProfiledCell): string {
  return cell.display.trim() || String(cell.raw ?? '').trim()
}

function isPlausibleHeaderLabel(cell: ProfiledCell): boolean {
  if (cell.isBlank || typeof cell.raw !== 'string') return false
  const value = cell.raw.trim()
  return value.length > 0 && value.length <= 120
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function scoreHeaderCandidate(
  cells: WorksheetCellMap,
  rowIndex: number,
): number {
  const row = cells.rows.get(rowIndex)
  if (!row || row.size === 0) return 0

  const values = [...row.values()]
  const labels = values.map(headerValue).filter(Boolean)
  const normalizedLabels = labels.map((label) => normalizeStableId(label, 'column'))
  const uniqueRatio = normalizedLabels.length === 0
    ? 0
    : new Set(normalizedLabels).size / normalizedLabels.length
  const textRatio = values.filter((cell) => typeof cell.raw === 'string').length / values.length
  const labelRatio = values.filter(isPlausibleHeaderLabel).length / values.length
  const multiColumnEvidence = Math.min(values.length / 3, 1)

  const followingRows = [...cells.rows.entries()]
    .filter(([candidateRow]) => candidateRow > rowIndex)
    .sort(([left], [right]) => left - right)
    .slice(0, 10)
    .map(([, candidateRow]) => candidateRow)

  const headerColumns = [...row.keys()]
  const supportedColumns = headerColumns.filter((column) =>
    followingRows.some((candidateRow) => !candidateRow.get(column)?.isBlank),
  ).length
  const columnSupport = headerColumns.length === 0 ? 0 : supportedColumns / headerColumns.length

  const minimumSupportedCells = Math.max(1, Math.ceil(headerColumns.length * 0.25))
  const rowSupport = followingRows.length === 0
    ? 0
    : followingRows.filter((candidateRow) => {
      const matchingCells = headerColumns.filter((column) => !candidateRow.get(column)?.isBlank).length
      return matchingCells >= minimumSupportedCells
    }).length / followingRows.length

  const fullWidth = cells.maxColumn - cells.minColumn + 1
  const likelyTitlePenalty = values.length === 1 && fullWidth > 1 ? 0.25 : 0
  const duplicatePenalty = (1 - uniqueRatio) * 0.2

  return clamp(
    textRatio * 0.24
    + labelRatio * 0.16
    + uniqueRatio * 0.14
    + multiColumnEvidence * 0.12
    + columnSupport * 0.2
    + rowSupport * 0.14
    - likelyTitlePenalty
    - duplicatePenalty,
  )
}

function detectHeader(
  cells: WorksheetCellMap,
  scanRows: number,
): HeaderCandidate {
  const finalCandidateRow = Math.min(cells.maxRow, cells.minRow + Math.max(1, scanRows) - 1)
  const candidates: HeaderCandidate[] = []
  for (let rowIndex = cells.minRow; rowIndex <= finalCandidateRow; rowIndex += 1) {
    if (!cells.rows.has(rowIndex)) continue
    candidates.push({
      rowIndex,
      score: scoreHeaderCandidate(cells, rowIndex),
    })
  }
  candidates.sort((left, right) => right.score - left.score || left.rowIndex - right.rowIndex)
  const strongest = candidates[0]
  if (!strongest) return { rowIndex: cells.minRow, score: 0 }

  // Data rows can score marginally higher than headers when headers contain
  // duplicates or blanks. Within a small quality band, the earliest candidate
  // is the safer and more predictable header choice.
  return candidates
    .filter((candidate) => candidate.score >= strongest.score - 0.12)
    .sort((left, right) => left.rowIndex - right.rowIndex || right.score - left.score)[0]
}

function dataColumns(cells: WorksheetCellMap, headerRowIndex: number): number[] {
  const columns = new Set<number>()
  cells.rows.get(headerRowIndex)?.forEach((_cell, column) => columns.add(column))
  cells.rows.forEach((row, rowIndex) => {
    if (rowIndex <= headerRowIndex) return
    row.forEach((_cell, column) => columns.add(column))
  })
  return [...columns].sort((left, right) => left - right)
}

function sourceRange(cells: WorksheetCellMap | null): string | null {
  if (!cells) return null
  return XLSX.utils.encode_range({
    s: { r: cells.minRow, c: cells.minColumn },
    e: { r: cells.maxRow, c: cells.maxColumn },
  })
}

function profileDataset(
  workbookId: string,
  worksheetName: string,
  worksheetIndex: number,
  worksheetKey: string,
  worksheet: XLSX.WorkSheet,
  options: Required<WorkbookProfilerOptions>,
): { worksheet: WorksheetProfile; dataset: DatasetProfile | null } {
  const cells = worksheetCells(worksheet, worksheetName)
  const worksheetId = `${workbookId}/worksheet/${worksheetKey}`
  if (!cells) {
    return {
      worksheet: {
        id: worksheetId,
        name: worksheetName,
        index: worksheetIndex,
        sourceRange: null,
        populatedCellCount: 0,
        dataset: null,
        warnings: ['This worksheet is empty.'],
      },
      dataset: null,
    }
  }

  const header = detectHeader(cells, options.headerScanRows)
  const columns = dataColumns(cells, header.rowIndex)
  const datasetId = `${workbookId}/dataset/${worksheetKey}`
  const occupiedKeys = new Set<string>()
  const headerCells = cells.rows.get(header.rowIndex) ?? new Map<number, ProfiledCell>()

  const fieldSeeds = columns.map((column, fieldIndex) => {
    const headerCell = headerCells.get(column) ?? blankCell()
    const explicitName = headerValue(headerCell)
    const name = explicitName || `Column ${XLSX.utils.encode_col(column)}`
    const key = uniqueStableSegment(name, occupiedKeys, `column-${fieldIndex + 1}`)
    return {
      id: `${datasetId}/field/${key}`,
      key,
      name,
      column,
      headerCell,
    }
  })

  const rows = [...cells.rows.entries()]
    .filter(([rowIndex]) => rowIndex > header.rowIndex)
    .sort(([left], [right]) => left - right)
    .flatMap(([rowIndex, row]) => {
      const rowCells = Object.fromEntries(fieldSeeds.map((field) => [
        field.id,
        row.get(field.column) ?? blankCell(),
      ]))
      const hasValue = Object.values(rowCells).some((cell) => !cell.isBlank)
      return hasValue
        ? [{ sourceRowNumber: rowIndex + 1, cells: rowCells }]
        : []
    })

  const fields: FieldProfile[] = fieldSeeds.map((field) => {
    const inference = inferField(
      rows.map((row) => row.cells[field.id]),
      options.sampleValueLimit,
    )
    return {
      id: field.id,
      key: field.key,
      name: field.name,
      sourceColumnIndex: field.column,
      sourceColumnNumber: field.column + 1,
      sourceColumnLabel: XLSX.utils.encode_col(field.column),
      headerRaw: field.headerCell.raw,
      headerDisplay: field.headerCell.display,
      inferredType: inference.inferredType,
      typeConfidence: inference.typeConfidence,
      typeCounts: inference.typeCounts,
      rowCount: rows.length,
      nonBlankCount: inference.nonBlankCount,
      blankCount: inference.blankCount,
      distinctCount: inference.distinctCount,
      sampleValues: inference.sampleValues,
    }
  })

  const dataset: DatasetProfile = {
    id: datasetId,
    name: worksheetName,
    workbookId,
    worksheetName,
    worksheetIndex,
    headerRowNumber: header.rowIndex + 1,
    headerConfidence: Math.round(header.score * 1000) / 1000,
    sourceRange: sourceRange(cells),
    rowCount: rows.length,
    fields,
    rows,
  }
  return {
    worksheet: {
      id: worksheetId,
      name: worksheetName,
      index: worksheetIndex,
      sourceRange: sourceRange(cells),
      populatedCellCount: cells.populatedCellCount,
      dataset,
      warnings: header.score < 0.55
        ? ['The detected header row has low confidence and should be reviewed.']
        : [],
    },
    dataset,
  }
}

function requiredOptions(options?: WorkbookProfilerOptions): Required<WorkbookProfilerOptions> {
  return {
    headerScanRows: options?.headerScanRows ?? DEFAULT_HEADER_SCAN_ROWS,
    sampleValueLimit: options?.sampleValueLimit ?? DEFAULT_SAMPLE_VALUE_LIMIT,
  }
}

async function profileMaterializedWorkbook(
  input: SpreadsheetProfileInput,
  context: ProfileSourceContext,
  options?: WorkbookProfilerOptions,
): Promise<WorkbookProfile> {
  const materialized = await materializeInput(input)
  const format = workbookFormat(materialized.name)
  let workbook: XLSX.WorkBook
  try {
    const sharedReadOptions: XLSX.ParsingOptions = {
      cellDates: true,
      cellNF: true,
      cellText: true,
      dense: false,
    }
    workbook = format === 'csv'
      ? XLSX.read(new TextDecoder('utf-8').decode(materialized.bytes), {
          ...sharedReadOptions,
          type: 'string',
          raw: true,
        })
      : XLSX.read(materialized.bytes, {
          ...sharedReadOptions,
          type: 'array',
        })
  } catch (error) {
    throw new SpreadsheetProfileError(
      'workbook-unreadable',
      `${materialized.name}: the spreadsheet could not be read.`,
      { cause: error },
    )
  }

  if (workbook.SheetNames.length === 0) {
    throw new SpreadsheetProfileError(
      'workbook-empty',
      `${materialized.name}: no worksheets were found.`,
    )
  }
  if (workbook.SheetNames.length > MAX_WORKBOOK_WORKSHEETS) {
    throw new SpreadsheetProfileError(
      'workbook-too-large',
      `${materialized.name}: the workbook contains more than ${MAX_WORKBOOK_WORKSHEETS} worksheets.`,
    )
  }

  const workbookId = stableSourceId(context.locator, fileStem(materialized.name))
  const configuredOptions = requiredOptions(options)
  const occupiedWorksheetKeys = new Set<string>()
  const profiledWorksheets = workbook.SheetNames.map((worksheetName, worksheetIndex) => {
    const worksheetKey = uniqueStableSegment(
      worksheetName,
      occupiedWorksheetKeys,
      `sheet-${worksheetIndex + 1}`,
    )
    return profileDataset(
      workbookId,
      worksheetName,
      worksheetIndex,
      worksheetKey,
      workbook.Sheets[worksheetName],
      configuredOptions,
    )
  })
  const worksheets = profiledWorksheets.map((profile) => profile.worksheet)
  const datasets = profiledWorksheets.flatMap((profile) =>
    profile.dataset ? [profile.dataset] : [],
  )

  return {
    id: workbookId,
    fileName: materialized.name,
    format,
    source: context.source,
    worksheetCount: worksheets.length,
    worksheets,
    datasets,
    warnings: datasets.length === 0 ? ['No populated worksheets were found.'] : [],
  }
}

export async function profileWorkbook(
  input: SpreadsheetProfileInput,
  options?: WorkbookProfilerOptions,
): Promise<WorkbookProfile> {
  if (!isSupportedSpreadsheet(input.name)) {
    throw new SpreadsheetProfileError(
      'unsupported-file',
      `${input.name}: use an XLS, XLSX, or CSV spreadsheet file.`,
    )
  }
  const materialized = await materializeInput(input)
  const source: WorkbookSourceProfile = {
    kind: 'file',
    fileName: materialized.name,
    path: materialized.path,
    byteLength: materialized.bytes.byteLength,
    lastModified: materialized.lastModified,
  }
  return profileMaterializedWorkbook(
    {
      name: materialized.name,
      bytes: materialized.bytes,
      size: materialized.bytes.byteLength,
      lastModified: materialized.lastModified,
      path: materialized.path,
    },
    { source, locator: materialized.path },
    options,
  )
}

export async function profileSpreadsheetInputs(
  inputs: readonly SpreadsheetProfileInput[],
  options?: WorkbookProfilerOptions,
): Promise<SpreadsheetCatalogProfile> {
  const workbooks: WorkbookProfile[] = []
  const archives: ArchiveProfile[] = []
  const inputWarnings: string[] = []
  const inputErrors: unknown[] = []

  for (const input of inputs) {
    try {
      if (isZipArchive(input.name)) {
        const expanded = await expandArchive(input)
        archives.push(expanded.profile)
        for (const entry of expanded.files) {
          const archivePath = entry.path || entry.name
          const source: WorkbookSourceProfile = {
            kind: 'archiveEntry',
            fileName: entry.name,
            path: `${input.name}/${archivePath}`,
            byteLength: entry.size ?? entry.bytes.byteLength,
            lastModified: entry.lastModified,
            archiveName: input.name,
            archivePath,
          }
          try {
            workbooks.push(await profileMaterializedWorkbook(
              entry,
              {
                source,
                locator: `${input.name}/${archivePath}`,
              },
              options,
            ))
          } catch (error) {
            inputErrors.push(error)
            inputWarnings.push(error instanceof Error
              ? error.message
              : `${input.name}/${archivePath}: the spreadsheet could not be read.`)
          }
        }
        continue
      }

      if (!isSupportedSpreadsheet(input.name)) {
        throw new SpreadsheetProfileError(
          'unsupported-file',
          `${input.name}: use an XLS, XLSX, CSV, or ZIP spreadsheet file.`,
        )
      }
      workbooks.push(await profileWorkbook(input, options))
    } catch (error) {
      inputErrors.push(error)
      inputWarnings.push(error instanceof Error
        ? error.message
        : `${input.name}: the spreadsheet could not be read.`)
    }
  }

  if (workbooks.length === 0) {
    const firstError = inputErrors[0]
    if (firstError instanceof SpreadsheetProfileError) throw firstError
    throw new SpreadsheetProfileError(
      'workbook-empty',
      'No XLS, XLSX, CSV, or ZIP spreadsheet files were provided.',
    )
  }

  return {
    workbooks,
    datasets: workbooks.flatMap((workbook) => workbook.datasets),
    archives,
    warnings: [
      ...inputWarnings,
      ...workbooks.flatMap((workbook) =>
        workbook.warnings.map((warning) => `${workbook.fileName}: ${warning}`)),
    ],
  }
}
