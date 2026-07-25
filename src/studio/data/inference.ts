import type {
  FieldSampleValue,
  FieldTypeCounts,
  InferredFieldType,
  ProfiledCell,
} from './types'
import {
  parseDateParts,
  parseDateTimeMilliseconds,
  parseFiniteNumber,
  parseWorkWeek,
} from '../domain/coercion'

const BOOLEAN_VALUES = new Set(['true', 'false', 'yes', 'no', 'y', 'n'])

export interface FieldInference {
  inferredType: InferredFieldType
  typeConfidence: number
  typeCounts: FieldTypeCounts
  nonBlankCount: number
  blankCount: number
  distinctCount: number
  sampleValues: FieldSampleValue[]
}

function emptyTypeCounts(): FieldTypeCounts {
  return {
    text: 0,
    number: 0,
    boolean: 0,
    date: 0,
    datetime: 0,
    workWeek: 0,
    blank: 0,
  }
}

function isDateAtMidnight(value: Date): boolean {
  const localMidnight = value.getHours() === 0
    && value.getMinutes() === 0
    && value.getSeconds() === 0
    && value.getMilliseconds() === 0
  const utcMidnight = value.getUTCHours() === 0
    && value.getUTCMinutes() === 0
    && value.getUTCSeconds() === 0
    && value.getUTCMilliseconds() === 0
  return localMidnight || utcMidnight
}

function formatContainsTime(numberFormat?: string): boolean {
  if (!numberFormat) return false
  const cleaned = numberFormat
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*]/g, '')
    .toLowerCase()
  return /(?:h+|s+|am\/pm|a\/p)/.test(cleaned)
}

function stringLooksNumeric(value: string): boolean {
  const trimmed = value.trim()
  if (parseFiniteNumber(trimmed, true) === null) return false
  const unsigned = trimmed.replace(/^[+-]/, '')
  return !/^0\d/.test(unsigned) || /^0(?:\.|$)/.test(unsigned)
}

function isDateText(value: string): boolean {
  return parseDateParts(value) !== null
}

function isDateTimeText(value: string): boolean {
  return parseDateTimeMilliseconds(value) !== null
}

function classifyCell(cell: ProfiledCell): InferredFieldType | 'blank' {
  if (cell.isBlank) return 'blank'
  if (cell.raw instanceof Date) {
    return formatContainsTime(cell.numberFormat) || !isDateAtMidnight(cell.raw)
      ? 'datetime'
      : 'date'
  }
  if (typeof cell.raw === 'boolean') return 'boolean'
  if (typeof cell.raw === 'number') return 'number'

  const value = String(cell.raw).trim()
  if (parseWorkWeek(value)) return 'workWeek'
  if (BOOLEAN_VALUES.has(value.toLowerCase())) return 'boolean'
  if (isDateTimeText(value)) return 'datetime'
  if (isDateText(value)) return 'date'
  if (stringLooksNumeric(value)) return 'number'
  return 'text'
}

function sampleKey(cell: ProfiledCell): string {
  if (cell.raw instanceof Date) return `date:${cell.raw.toISOString()}`
  return `${typeof cell.raw}:${String(cell.raw)}`
}

function confidenceFor(matches: number, nonBlankCount: number): number {
  if (nonBlankCount === 0) return 0
  const consistency = matches / nonBlankCount
  const evidence = 0.75 + 0.25 * Math.min(nonBlankCount / 20, 1)
  return Math.round(consistency * evidence * 1000) / 1000
}

export function inferField(
  cells: readonly ProfiledCell[],
  sampleValueLimit = 8,
): FieldInference {
  const typeCounts = emptyTypeCounts()
  const samples = new Map<string, FieldSampleValue & { firstSeen: number }>()

  cells.forEach((cell, index) => {
    const classification = classifyCell(cell)
    typeCounts[classification] += 1
    if (classification === 'blank' || cell.raw === null) return

    const key = sampleKey(cell)
    const existing = samples.get(key)
    if (existing) {
      existing.count += 1
      return
    }
    samples.set(key, {
      raw: cell.raw,
      display: cell.display,
      count: 1,
      firstSeen: index,
    })
  })

  const nonBlankCount = cells.length - typeCounts.blank
  const temporalCount = typeCounts.date + typeCounts.datetime
  const candidates: Array<{ type: InferredFieldType; count: number; precedence: number }> = [
    { type: 'workWeek', count: typeCounts.workWeek, precedence: 6 },
    {
      type: typeCounts.datetime > 0 ? 'datetime' : 'date',
      count: temporalCount,
      precedence: 5,
    },
    { type: 'boolean', count: typeCounts.boolean, precedence: 4 },
    { type: 'number', count: typeCounts.number, precedence: 3 },
    { type: 'text', count: typeCounts.text, precedence: 2 },
  ]
  candidates.sort((left, right) => right.count - left.count || right.precedence - left.precedence)

  const winner = nonBlankCount === 0
    ? { type: 'text' as const, count: 0 }
    : candidates[0]

  const sampleValues = [...samples.values()]
    .sort((left, right) => right.count - left.count || left.firstSeen - right.firstSeen)
    .slice(0, Math.max(0, sampleValueLimit))
    .map(({ firstSeen: _firstSeen, ...sample }) => sample)

  return {
    inferredType: winner.type,
    typeConfidence: confidenceFor(winner.count, nonBlankCount),
    typeCounts,
    nonBlankCount,
    blankCount: typeCounts.blank,
    distinctCount: samples.size,
    sampleValues,
  }
}
