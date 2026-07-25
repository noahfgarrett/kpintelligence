import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  ARCHIVE_SAFETY_LIMITS,
  SpreadsheetProfileError,
  profileSpreadsheetInputs,
  profileWorkbook,
} from './index'
import type {
  DatasetProfile,
  FieldProfile,
  SpreadsheetBinaryInput,
} from './types'

function toUint8Array(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value)
}

function workbookInput(
  name: string,
  sheets: Array<{ name: string; rows: unknown[][] }>,
): SpreadsheetBinaryInput {
  const workbook = XLSX.utils.book_new()
  sheets.forEach((sheetDefinition) => {
    const worksheet = XLSX.utils.aoa_to_sheet(sheetDefinition.rows, { cellDates: true })
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetDefinition.name)
  })
  const bytes = XLSX.write(workbook, {
    type: 'array',
    bookType: name.toLowerCase().endsWith('.xls') ? 'xls' : 'xlsx',
    cellDates: true,
  }) as ArrayBuffer
  return { name, bytes }
}

function csvInput(name: string, csv: string): SpreadsheetBinaryInput {
  return {
    name,
    bytes: new TextEncoder().encode(csv),
  }
}

function findField(dataset: DatasetProfile, name: string): FieldProfile {
  const field = dataset.fields.find((candidate) => candidate.name === name)
  if (!field) throw new Error(`Missing test field: ${name}`)
  return field
}

describe('generic workbook profiling', () => {
  it('detects a header below report titles and preserves typed and display values', async () => {
    const createdDate = new Date(2026, 6, 6)
    const updatedDate = new Date(2026, 6, 6, 14, 30)
    const input = workbookInput('anything-at-all.xlsx', [
      {
        name: 'Raw Data',
        rows: [
          ['Quarterly project snapshot'],
          [],
          ['Asset ID', 'Amount', 'Approved?', 'Created On', 'Updated At', 'Work Week'],
          ['A-001', 12.5, true, createdDate, updatedDate, "WW28'2026"],
          ['A-002', 12.5, false, new Date(2026, 6, 7), new Date(2026, 6, 7, 9), "WW28'2026"],
          ['A-003', null, true, new Date(2026, 6, 8), new Date(2026, 6, 8, 10), "WW28'2026"],
        ],
      },
      { name: 'Notes', rows: [] },
    ])

    const profile = await profileWorkbook(input)
    expect(profile.fileName).toBe('anything-at-all.xlsx')
    expect(profile.worksheetCount).toBe(2)
    expect(profile.datasets).toHaveLength(1)
    expect(profile.worksheets[1].dataset).toBeNull()

    const dataset = profile.datasets[0]
    expect(dataset.headerRowNumber).toBe(3)
    expect(dataset.headerConfidence).toBeGreaterThanOrEqual(0.9)
    expect(dataset.rowCount).toBe(3)
    expect(dataset.fields.map((field) => field.inferredType)).toEqual([
      'text',
      'number',
      'boolean',
      'date',
      'datetime',
      'workWeek',
    ])

    const amount = findField(dataset, 'Amount')
    expect(amount.sampleValues[0]).toMatchObject({ raw: 12.5, count: 2 })
    expect(amount.nonBlankCount).toBe(2)
    expect(amount.blankCount).toBe(1)
    expect(amount.distinctCount).toBe(1)
    expect(amount.typeConfidence).toBeGreaterThan(0.75)

    const created = findField(dataset, 'Created On')
    const createdCell = dataset.rows[0].cells[created.id]
    expect(createdCell.raw).toBeInstanceOf(Date)
    expect(createdCell.display).not.toBe('')
    expect(createdCell.kind).toBe('date')

    const approved = findField(dataset, 'Approved?')
    expect(dataset.rows[0].cells[approved.id]).toMatchObject({
      raw: true,
      display: 'TRUE',
      kind: 'boolean',
    })
  })

  it('profiles arbitrary CSVs and infers string-backed scalar types', async () => {
    const profile = await profileWorkbook(csvInput(
      'customer_upload.csv',
      [
        'Project,Enabled,Budget,Start Date,Last Synced,Work Week,Bad Date',
        "North,true,1250.50,2026-07-06,2026-07-06T15:45:00,WW28'2026,2026-02-30",
        "South,false,800,2026-07-07,2026-07-07T09:00:00,WW28'2026,2026-13-01",
      ].join('\n'),
    ))

    const dataset = profile.datasets[0]
    expect(profile.format).toBe('csv')
    expect(dataset.headerRowNumber).toBe(1)
    expect(dataset.fields.map((field) => [field.name, field.inferredType])).toEqual([
      ['Project', 'text'],
      ['Enabled', 'boolean'],
      ['Budget', 'number'],
      ['Start Date', 'date'],
      ['Last Synced', 'datetime'],
      ['Work Week', 'workWeek'],
      ['Bad Date', 'text'],
    ])
    const budget = findField(dataset, 'Budget')
    expect(dataset.rows[0].cells[budget.id]).toMatchObject({
      raw: '1250.50',
      display: '1250.50',
    })
  })

  it('creates readable deterministic field IDs for duplicate and blank headers', async () => {
    const input = csvInput(
      'odd headers.csv',
      [
        'Status,Status,,Café & Owner',
        'Open,Reviewed,42,Ada',
        'Closed,Reviewed,43,Grace',
      ].join('\n'),
    )

    const [first, second] = await Promise.all([
      profileWorkbook(input),
      profileWorkbook(input),
    ])
    const firstFields = first.datasets[0].fields
    const secondFields = second.datasets[0].fields

    expect(firstFields.map((field) => field.key)).toEqual([
      'status',
      'status-2',
      'column-c',
      'cafe-and-owner',
    ])
    expect(firstFields.map((field) => field.id)).toEqual(
      secondFields.map((field) => field.id),
    )
    expect(firstFields[2]).toMatchObject({
      name: 'Column C',
      sourceColumnLabel: 'C',
      inferredType: 'number',
    })
  })

  it('supports legacy XLS files and keeps field IDs stable when worksheets reorder', async () => {
    const legacy = await profileWorkbook(workbookInput('legacy.xls', [{
      name: 'Legacy Data',
      rows: [
        ['Reference', 'Quantity'],
        ['L-001', 3],
      ],
    }]))
    expect(legacy.format).toBe('xls')
    expect(legacy.datasets[0].fields.map((field) => field.inferredType)).toEqual([
      'text',
      'number',
    ])

    const sheets = [
      {
        name: 'Data',
        rows: [
          ['Name', 'Value'],
          ['Example', 1],
        ],
      },
      {
        name: 'Notes',
        rows: [
          ['Note'],
          ['Review'],
        ],
      },
    ]
    const first = await profileWorkbook(workbookInput('reordered.xlsx', sheets))
    const second = await profileWorkbook(workbookInput('reordered.xlsx', [...sheets].reverse()))
    const firstData = first.datasets.find((dataset) => dataset.name === 'Data')
    const secondData = second.datasets.find((dataset) => dataset.name === 'Data')

    expect(firstData?.id).toBe(secondData?.id)
    expect(firstData?.fields.map((field) => field.id)).toEqual(
      secondData?.fields.map((field) => field.id),
    )
  })

  it('exposes every workbook and dataset in a ZIP while retaining nested paths', async () => {
    const schedule = workbookInput('schedule.xlsx', [
      {
        name: 'Milestones',
        rows: [
          ['Milestone', 'Complete'],
          ['Foundations', true],
        ],
      },
    ])
    const costs = csvInput('costs.csv', 'Trade,Cost\nElectrical,2500')
    const archiveBytes = zipSync({
      'Project A/costs.csv': toUint8Array(costs.bytes),
      'Project B/schedule.xlsx': toUint8Array(schedule.bytes),
      '__MACOSX/._costs.csv': new Uint8Array([1, 2, 3]),
      'readme.txt': new TextEncoder().encode('not a spreadsheet'),
    })

    const catalog = await profileSpreadsheetInputs([{
      name: 'weekly exports.zip',
      bytes: archiveBytes,
      size: archiveBytes.byteLength,
    }])

    expect(catalog.archives).toHaveLength(1)
    expect(catalog.archives[0]).toMatchObject({
      spreadsheetEntryCount: 2,
      ignoredEntryCount: 2,
    })
    expect(catalog.workbooks).toHaveLength(2)
    expect(catalog.datasets).toHaveLength(2)
    expect(catalog.workbooks.map((workbook) => workbook.source.archivePath).sort()).toEqual([
      'Project A/costs.csv',
      'Project B/schedule.xlsx',
    ])
    expect(catalog.workbooks.every((workbook) => workbook.source.kind === 'archiveEntry')).toBe(true)
  })

  it('keeps usable workbooks when another folder file is corrupt', async () => {
    const catalog = await profileSpreadsheetInputs([
      csvInput('good.csv', 'Trade,Cost\nElectrical,2500'),
      {
        name: 'broken.zip',
        bytes: new Uint8Array([1]),
        size: ARCHIVE_SAFETY_LIMITS.maxCompressedBytes + 1,
      },
    ])

    expect(catalog.workbooks).toHaveLength(1)
    expect(catalog.datasets[0].fields.map((field) => field.name)).toEqual(['Trade', 'Cost'])
    expect(catalog.warnings.some((warning) => warning.includes('broken.zip'))).toBe(true)
  })

  it('rejects archives above the existing compressed-size limit before reading them', async () => {
    const oversized: SpreadsheetBinaryInput = {
      name: 'too-large.zip',
      bytes: new Uint8Array([1]),
      size: ARCHIVE_SAFETY_LIMITS.maxCompressedBytes + 1,
    }

    await expect(profileSpreadsheetInputs([oversized])).rejects.toMatchObject({
      name: 'SpreadsheetProfileError',
      code: 'archive-too-large',
    })

    try {
      await profileSpreadsheetInputs([oversized])
    } catch (error) {
      expect(error).toBeInstanceOf(SpreadsheetProfileError)
      expect((error as SpreadsheetProfileError).message).toContain('250 MB')
    }
  })

  it('rejects workbooks with unsafe worksheet counts before profiling cells', async () => {
    const sheets = Array.from({ length: 101 }, (_, index) => ({
      name: `Sheet ${index + 1}`,
      rows: [
        ['Value'],
        [index],
      ],
    }))

    await expect(profileWorkbook(workbookInput('too-many-sheets.xlsx', sheets))).rejects.toMatchObject({
      name: 'SpreadsheetProfileError',
      code: 'workbook-too-large',
    })
  })
})
