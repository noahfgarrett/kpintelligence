import { describe, expect, it } from 'vitest'
import type { SheetBundle, SheetRole } from '@/types'
import { buildReportModel, mergeFilters } from './report'

function bundleWith(role: SheetRole, rows: Record<string, unknown>[]): SheetBundle {
  const empty = { id: 'empty', name: 'Empty', rows: [] }
  return {
    source: 'files',
    sheets: {
      bimIssues: empty,
      mechanical: empty,
      electrical: empty,
      welding: empty,
      [role]: { id: role, name: role, rows },
    },
  }
}

describe('Weekly QA/QC report calculations', () => {
  it('counts electrical issues only on Final inspection rows', () => {
    const report = buildReportModel(
      bundleWith('electrical', [
        {
          'Inspection Phase': 'Final',
          'Work Week Observed': "WW28'2026",
          'Issue?': 'BIM-100',
          'General Contractor': 'Bechtel',
        },
        {
          'Inspection Phase': 'SOR',
          'Work Week Observed': "WW28'2026",
          'Issue?': 'BIM-101',
          'General Contractor': 'Bechtel',
        },
        {
          'Inspection Phase': 'In Progress',
          'Work Week Observed': "WW28'2026",
          'Issue?': 'Field correction',
          'General Contractor': 'Bechtel',
        },
        {
          'Inspection Phase': 'Final inspection',
          'Work Week Observed': "WW28'2026",
          'Issue?': 'No Issue Found',
          'General Contractor': 'Bechtel',
        },
      ]),
      mergeFilters({}),
      new Date(2026, 6, 16, 12),
    )

    const reportWeek = report.electrical.find((point) => point.workWeek === "WW28'2026")
    expect(reportWeek).toMatchObject({ finals: 2, issuesFound: 1 })
    expect(report.summary.electricalFinals).toBe(2)
    expect(report.summary.electricalIssuesFound).toBe(1)
  })
})
