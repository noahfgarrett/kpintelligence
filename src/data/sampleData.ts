import type { SheetBundle, SheetRecord } from '@/types'
import { enumerateWorkWeeks, parseWorkWeek, toIsoWorkWeek, workWeekStart } from '@/utils/workWeeks'

const contractors = ['Apex Mechanical', 'Northline Electric', 'Vector BIM', 'Summit Fab', 'FieldTech']
const subtypes = ['Coordination', 'Install Conflict', 'Clearance', 'Access', 'Documentation', 'Quality']
const disciplines = ['Mechanical', 'Process', 'Electrical', 'BIM', 'Welding']
const statuses = ['Open', 'In Progress', 'Closed', 'Closed', 'Closed', 'Open']

let seed = 42

function rand(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

function pick<T>(items: T[]): T {
  return items[Math.floor(rand() * items.length)]
}

function dateInWorkWeek(label: string, offset = Math.floor(rand() * 5)): Date {
  const week = parseWorkWeek(label)
  const start = week ? workWeekStart(week) : new Date(2026, 0, 1, 12)
  start.setDate(start.getDate() + offset)
  return start
}

function fmt(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function makeSheet(name: string, rows: Record<string, unknown>[]): SheetRecord {
  return {
    id: name,
    name,
    rows,
  }
}

function buildIssues(): Record<string, unknown>[] {
  const weeks = enumerateWorkWeeks('WW51\'2025', toIsoWorkWeek(new Date(2026, 6, 9)))
  const rows: Record<string, unknown>[] = []
  let id = 1200

  weeks.forEach((week, weekIndex) => {
    const createdCount = 3 + Math.floor(rand() * 8) + (weekIndex % 5 === 0 ? 4 : 0)
    for (let i = 0; i < createdCount; i += 1) {
      const created = dateInWorkWeek(week.label)
      const status = rand() < 0.04 ? 'Void' : pick(statuses)
      const shouldClose = status === 'Closed'
      const closureDays = 5 + Math.floor(rand() * 46)
      const updated = new Date(created)
      updated.setDate(created.getDate() + closureDays)
      const due = new Date(created)
      due.setDate(created.getDate() + 21 + Math.floor(rand() * 28))
      rows.push({
        ID: `BIM-${id}`,
        Status: status,
        Subtype: pick(subtypes),
        Title: `${pick(['Pipe rack', 'Panel', 'Sleeve', 'Access zone', 'Model'])} ${pick(['clash', 'clearance review', 'layout correction', 'coordination item'])}`,
        Contractor: pick(contractors),
        Discipline: pick(disciplines.slice(0, 4)),
        'Created On': fmt(created),
        'Updated On': shouldClose ? fmt(updated) : fmt(created),
        'Due Date': fmt(due),
      })
      id += 1
    }
  })

  // Make sure the current/reporting edge cases are represented for WW27/WW28.
  rows.push(
    {
      ID: 'BIM-1991',
      Status: 'Closed',
      Subtype: 'Coordination',
      Title: 'Ceiling access conflict resolved',
      Contractor: 'Vector BIM',
      Discipline: 'BIM',
      'Created On': '2026-06-30',
      'Updated On': '2026-07-02',
      'Due Date': '2026-07-14',
    },
    {
      ID: 'BIM-1992',
      Status: 'Closed',
      Subtype: 'Quality',
      Title: 'Support bracket correction closed after cutoff',
      Contractor: 'Apex Mechanical',
      Discipline: 'Mechanical',
      'Created On': '2026-06-26',
      'Updated On': '2026-07-07',
      'Due Date': '2026-07-18',
    },
    {
      ID: 'BIM-1993',
      Status: 'Open',
      Subtype: 'Access',
      Title: 'Valve bank access review',
      Contractor: 'Apex Mechanical',
      Discipline: 'Process',
      'Created On': '2026-07-01',
      'Updated On': '2026-07-01',
      'Due Date': '2026-07-21',
    },
  )

  return rows
}

function buildInspectionRows(sheet: 'mechanical' | 'electrical'): Record<string, unknown>[] {
  const weeks = enumerateWorkWeeks('WW51\'2025', toIsoWorkWeek(new Date(2026, 6, 9)))
  const rows: Record<string, unknown>[] = []
  weeks.forEach((week, index) => {
    const finals = sheet === 'electrical'
      ? 5 + Math.floor(rand() * 10) + (index % 6 === 0 ? 5 : 0)
      : 4 + Math.floor(rand() * 8) + (index % 7 === 0 ? 3 : 0)
    const sors = sheet === 'electrical' ? Math.floor(rand() * 3) : Math.floor(rand() * 4)
    for (let i = 0; i < finals; i += 1) {
      rows.push({
        ID: `${sheet === 'electrical' ? 'EI' : 'MI'}-${week.week}-${i}`,
        'Inspection Phase': 'Final',
        'Work Week Observed': week.label,
        'Issue?': sheet === 'electrical' && rand() < 0.16 ? pick(['BIM issue created', 'Field correction required']) : 'No Issue Found',
        Contractor: sheet === 'electrical' ? 'Northline Electric' : pick(['Apex Mechanical', 'FieldTech']),
        Discipline: sheet === 'electrical' ? 'Electrical' : pick(['Mechanical', 'Process']),
        Subtype: pick(['Rough-in', 'Final', 'Equipment', 'Controls']),
      })
    }
    for (let i = 0; i < sors; i += 1) {
      rows.push({
        ID: `${sheet === 'electrical' ? 'EI' : 'MI'}-SOR-${week.week}-${i}`,
        'Inspection Phase': 'SOR',
        'Work Week Observed': week.label,
        'Issue?': 'BIM issue created',
        Contractor: sheet === 'electrical' ? 'Northline Electric' : pick(['Apex Mechanical', 'FieldTech']),
        Discipline: sheet === 'electrical' ? 'Electrical' : pick(['Mechanical', 'Process']),
        Subtype: 'SOR',
      })
    }
  })
  return rows
}

function buildWeldingRows(): Record<string, unknown>[] {
  const weeks = enumerateWorkWeeks('WW51\'2025', toIsoWorkWeek(new Date(2026, 6, 9)))
  const rows: Record<string, unknown>[] = []
  let no = 800
  weeks.forEach((week, index) => {
    const total = 12 + Math.floor(rand() * 32) + (index % 8 === 0 ? 15 : 0)
    const rate = 0.2 + rand() * 0.6
    for (let i = 0; i < total; i += 1) {
      rows.push({
        NO: `W-${no}`,
        'WELD WORK WEEK': week.label,
        SIGNATURE: rand() < rate ? pick(['N. Clark', 'J. Rivera', 'M. Patel']) : '',
        'ISSUE CREATED? (Put BIM # If Yes)': rand() < 0.08 ? `BIM-${1300 + Math.floor(rand() * 400)}` : '',
        Contractor: 'Summit Fab',
        Discipline: 'Welding',
        Subtype: pick(['Pipe', 'Support', 'Spool', 'Field weld']),
      })
      no += 1
    }
  })
  return rows
}

export function buildSampleBundle(): SheetBundle {
  seed = 42
  return {
    source: 'demo',
    sheets: {
      bimIssues: makeSheet('BIM Issues Log', buildIssues()),
      mechanical: makeSheet('Mechanical / Process Inspection Log', buildInspectionRows('mechanical')),
      electrical: makeSheet('Electrical Inspection Log', buildInspectionRows('electrical')),
      welding: makeSheet('Welding Signoffs by Work Week', buildWeldingRows()),
    },
  }
}
