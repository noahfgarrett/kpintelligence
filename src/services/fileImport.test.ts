import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { importSpreadsheet } from './fileImport'

function workbookFile(name: string, rows: Record<string, string>[]): File {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Sheet1')
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
  return new File([bytes], name, { lastModified: 1 })
}

describe('Smartsheet export identification', () => {
  it('maps underscore-separated Electrical export names', async () => {
    const imported = await importSpreadsheet(workbookFile('Electrical_Inspection_Log.xlsx', [{
      'Inspection Phase': 'Final',
      'Work Week Observed': "WW27'2026",
      'General Contractor': 'Bechtel',
      'Issue?': 'No Issue Found',
    }]))
    expect(imported.role).toBe('electrical')
  })

  it('maps welding exports from their required columns', async () => {
    const imported = await importSpreadsheet(workbookFile('Welding_Signoffs_by_Work_Week.xlsx', [{
      NO: 'W-001',
      'WELD WORK WEEK': "WW27'2026",
      SIGNATURE: 'Inspector',
    }]))
    expect(imported.role).toBe('welding')
  })
})
