import type { WorkWeek } from '@/types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function cleanDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0)
}

export function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return cleanDate(value)
  if (typeof value === 'number') {
    const numeric = new Date(value)
    return Number.isNaN(numeric.getTime()) ? null : cleanDate(numeric)
  }
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  const isoDateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoDateOnly) {
    const parsed = new Date(
      Number(isoDateOnly[1]),
      Number(isoDateOnly[2]) - 1,
      Number(isoDateOnly[3]),
      12,
      0,
      0,
      0,
    )
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const iso = new Date(trimmed)
  if (!Number.isNaN(iso.getTime())) return cleanDate(iso)

  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (match) {
    const month = Number(match[1]) - 1
    const day = Number(match[2])
    const yearRaw = Number(match[3])
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw
    const parsed = new Date(year, month, day, 12, 0, 0, 0)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  return null
}

export function formatDate(value: Date | null): string {
  if (!value) return ''
  return value.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
  })
}

export function toIsoWorkWeek(dateInput: Date): WorkWeek {
  const date = cleanDate(dateInput)
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNumber = utc.getUTCDay() || 7
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNumber)
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / MS_PER_DAY) + 1) / 7)
  const year = utc.getUTCFullYear()
  return {
    week,
    year,
    label: `WW${String(week).padStart(2, '0')}'${year}`,
    key: year * 100 + week,
  }
}

export function parseWorkWeek(label: unknown): WorkWeek | null {
  if (label instanceof Date && !Number.isNaN(label.getTime())) return toIsoWorkWeek(label)
  if (typeof label !== 'string' && typeof label !== 'number') return null
  const text = String(label).trim()
  if (!text) return null

  // Smartsheet/Excel exports vary between WW27'2026, WW 27 - 2026,
  // Week 27 2026, and two-digit years. Normalize all of those here.
  const match = text.match(/^(?:WW|WK|WEEK)?\s*(\d{1,2})\s*(?:['’/_,.\-]|\s)\s*(\d{2,4})$/i)
  if (!match) return null
  const week = Number(match[1])
  const yearValue = Number(match[2])
  const year = yearValue < 100 ? 2000 + yearValue : yearValue
  if (week < 1 || week > 53) return null
  return {
    week,
    year,
    label: `WW${String(week).padStart(2, '0')}'${year}`,
    key: year * 100 + week,
  }
}

export function workWeekStart(week: WorkWeek): Date {
  const jan4 = new Date(week.year, 0, 4, 12, 0, 0, 0)
  const day = jan4.getDay() || 7
  const monday = new Date(jan4)
  monday.setDate(jan4.getDate() - day + 1 + (week.week - 1) * 7)
  return cleanDate(monday)
}

export function workWeekEnd(week: WorkWeek): Date {
  const end = workWeekStart(week)
  end.setDate(end.getDate() + 6)
  return cleanDate(end)
}

export function previousWorkWeek(week: WorkWeek): WorkWeek {
  const start = workWeekStart(week)
  start.setDate(start.getDate() - 1)
  return toIsoWorkWeek(start)
}

export function compareWorkWeeks(a: string | WorkWeek, b: string | WorkWeek): number {
  const aa = typeof a === 'string' ? parseWorkWeek(a) : a
  const bb = typeof b === 'string' ? parseWorkWeek(b) : b
  if (!aa || !bb) return 0
  return aa.key - bb.key
}

export function enumerateWorkWeeks(startLabel: string, endWeek: WorkWeek): WorkWeek[] {
  const start = parseWorkWeek(startLabel)
  if (!start) return []
  const weeks: WorkWeek[] = []
  let cursor = workWeekStart(start)
  const end = workWeekStart(endWeek)
  while (cursor <= end) {
    weeks.push(toIsoWorkWeek(cursor))
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7, 12)
  }
  return weeks
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    month: 'short',
    year: '2-digit',
  })
}

export function daysBetween(start: Date, end: Date): number {
  const a = cleanDate(start)
  const b = cleanDate(end)
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / MS_PER_DAY))
}

export function isOnOrBefore(a: Date | null, b: Date): boolean {
  return !!a && cleanDate(a).getTime() <= cleanDate(b).getTime()
}
