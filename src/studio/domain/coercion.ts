import type {
  FieldDataTypeV1,
  FieldV1,
  QueryScalar,
  ScalarLiteralV1,
} from './model'

export interface CoercedValue {
  value: QueryScalar
  comparable: QueryScalar
  display: string
}

export type CellCoercionResult =
  | { status: 'blank' }
  | { status: 'value'; coerced: CoercedValue }
  | { status: 'invalid'; reason: string }

function isDigit(character: string): boolean {
  return character >= '0' && character <= '9'
}

function isUnsignedInteger(value: string): boolean {
  if (value.length === 0) return false
  for (const character of value) {
    if (!isDigit(character)) return false
  }
  return true
}

function normalizeText(value: string, trim: boolean): string {
  return trim ? value.trim() : value
}

export function parseFiniteNumber(value: string, percent: boolean): number | null {
  let candidate = value.trim()
  if (candidate.length === 0) return null

  let isPercent = false
  if (candidate.endsWith('%')) {
    if (!percent) return null
    isPercent = true
    candidate = candidate.slice(0, -1).trim()
  }

  let sign = ''
  if (candidate.startsWith('+') || candidate.startsWith('-')) {
    sign = candidate[0]
    candidate = candidate.slice(1)
  }
  if (candidate.length === 0) return null

  let exponent = ''
  const exponentParts = candidate.toLowerCase().split('e')
  if (exponentParts.length > 2) return null
  if (exponentParts.length === 2) {
    candidate = exponentParts[0]
    exponent = exponentParts[1]
    if (exponent.startsWith('+') || exponent.startsWith('-')) exponent = exponent.slice(1)
    if (!isUnsignedInteger(exponent)) return null
    exponent = exponentParts[1]
  }

  const decimalParts = candidate.split('.')
  if (decimalParts.length > 2) return null
  const integerPart = decimalParts[0]
  const fractionPart = decimalParts[1]
  if (fractionPart !== undefined && fractionPart.length > 0 && !isUnsignedInteger(fractionPart)) return null

  const commaParts = integerPart.split(',')
  if (commaParts.length > 1) {
    if (
      commaParts[0].length < 1 ||
      commaParts[0].length > 3 ||
      !isUnsignedInteger(commaParts[0])
    ) {
      return null
    }
    for (let index = 1; index < commaParts.length; index += 1) {
      if (commaParts[index].length !== 3 || !isUnsignedInteger(commaParts[index])) {
        return null
      }
    }
  } else if (
    !isUnsignedInteger(integerPart)
    && !(integerPart.length === 0 && fractionPart !== undefined && fractionPart.length > 0)
  ) {
    return null
  }

  const normalized = `${sign}${commaParts.join('')}${
    fractionPart === undefined ? '' : `.${fractionPart}`
  }${exponent ? `e${exponent}` : ''}`
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return isPercent ? parsed / 100 : parsed
}

export interface DateParts {
  year: number
  month: number
  day: number
}

function validDateParts(year: number, month: number, day: number): boolean {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) return false
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= daysInMonth
}

function expandedYear(value: string): number | null {
  if (value.length === 4) return Number(value)
  if (value.length !== 2) return null
  const year = Number(value)
  return year >= 70 ? 1900 + year : 2000 + year
}

export function parseDateParts(value: string): DateParts | null {
  const candidate = value.trim()
  const separator = candidate.includes('-') ? '-' : candidate.includes('/') ? '/' : null
  if (separator === null) return null

  const parts = candidate.split(separator)
  if (parts.length !== 3 || parts.some((part) => !isUnsignedInteger(part))) return null

  const first = Number(parts[0])
  const second = Number(parts[1])
  const third = Number(parts[2])
  const trailingYear = expandedYear(parts[2])
  const dateParts =
    parts[0].length === 4
      ? { year: first, month: second, day: third }
      : trailingYear !== null
        ? { year: trailingYear, month: first, day: second }
        : null

  if (
    dateParts === null ||
    !validDateParts(dateParts.year, dateParts.month, dateParts.day)
  ) {
    return null
  }
  return dateParts
}

function formatDateParts(parts: DateParts): string {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(
    2,
    '0',
  )}-${String(parts.day).padStart(2, '0')}`
}

function dateFromCell(value: unknown): CoercedValue | null {
  let parts: DateParts | null = null
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    parts = {
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
    }
  } else if (typeof value === 'string') {
    parts = parseDateParts(value)
  }
  if (parts === null) return null

  const normalized = formatDateParts(parts)
  return {
    value: normalized,
    comparable: Date.UTC(parts.year, parts.month - 1, parts.day),
    display: normalized,
  }
}

export function parseDateTimeMilliseconds(value: string): number | null {
  const candidate = value.trim()
  const iso = /^(\d{4}-\d{1,2}-\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(candidate)
  if (iso) {
    const dateParts = parseDateParts(iso[1])
    if (!dateParts) return null
    const hour = Number(iso[2])
    const minute = Number(iso[3])
    const second = Number(iso[4] ?? 0)
    if (hour > 23 || minute > 59 || second > 59) return null
    if (iso[5]) {
      const parsed = Date.parse(candidate.replace(' ', 'T'))
      return Number.isFinite(parsed) ? parsed : null
    }
    return Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, hour, minute, second)
  }

  const us = /^(\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4}))[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/i.exec(candidate)
  if (!us) return null
  const dateParts = parseDateParts(us[1])
  if (!dateParts) return null
  let hour = Number(us[2])
  const minute = Number(us[3])
  const second = Number(us[4] ?? 0)
  const meridiem = us[5]?.toUpperCase()
  if (minute > 59 || second > 59) return null
  if (meridiem) {
    if (hour < 1 || hour > 12) return null
    hour = hour % 12 + (meridiem === 'PM' ? 12 : 0)
  } else if (hour > 23) {
    return null
  }
  return Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, hour, minute, second)
}

function datetimeFromCell(value: unknown): CoercedValue | null {
  let milliseconds: number | null = null
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    milliseconds = value.getTime()
  } else if (typeof value === 'string') {
    milliseconds = parseDateTimeMilliseconds(value)
  }
  if (milliseconds === null) return null

  const normalized = new Date(milliseconds).toISOString()
  return {
    value: normalized,
    comparable: milliseconds,
    display: normalized,
  }
}

export function parseWorkWeek(value: string): { week: number; year: number } | null {
  const match = /^WW\s*(\d{1,2})\s*(?:['’/-]\s*)?(\d{2}|\d{4})$/i.exec(value.trim())
  if (!match) return null
  const week = Number(match[1])
  const year = expandedYear(match[2])
  if (week < 1 || week > 53 || year === null || year < 1000 || year > 9999) return null
  return { week, year }
}

function workWeekFromCell(value: unknown): CoercedValue | null {
  if (typeof value !== 'string') return null
  const parsed = parseWorkWeek(value)
  if (!parsed) return null

  const normalized = `WW${parsed.week}'${parsed.year}`
  return {
    value: normalized,
    comparable: parsed.year * 100 + parsed.week,
    display: normalized,
  }
}

export function isBlankCell(value: unknown, field: FieldV1): boolean {
  if (value === null || value === undefined) return true
  if (typeof value !== 'string' || !field.coercion.emptyTextIsBlank) return false
  return normalizeText(value, field.coercion.trimText).length === 0
}

export function coerceCell(value: unknown, field: FieldV1): CellCoercionResult {
  if (isBlankCell(value, field)) return { status: 'blank' }

  switch (field.dataType) {
    case 'text': {
      let text: string
      if (typeof value === 'string') {
        text = normalizeText(value, field.coercion.trimText)
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        text = String(value)
      } else if (typeof value === 'boolean') {
        text = value ? 'true' : 'false'
      } else if (value instanceof Date && Number.isFinite(value.getTime())) {
        text = value.toISOString()
      } else {
        return { status: 'invalid', reason: 'Value cannot be safely converted to text.' }
      }
      return {
        status: 'value',
        coerced: { value: text, comparable: text, display: text },
      }
    }

    case 'number': {
      const number =
        typeof value === 'number' && Number.isFinite(value)
          ? value
          : typeof value === 'string'
            ? parseFiniteNumber(value, field.format?.numberStyle === 'percent')
            : null
      if (number === null) {
        return { status: 'invalid', reason: 'Value is not an unambiguous finite number.' }
      }
      return {
        status: 'value',
        coerced: { value: number, comparable: number, display: String(number) },
      }
    }

    case 'boolean': {
      let boolean: boolean | null = null
      if (typeof value === 'boolean') {
        boolean = value
      } else if (typeof value === 'number' && (value === 0 || value === 1)) {
        boolean = value === 1
      } else if (typeof value === 'string') {
        const candidate = value.trim().toLowerCase()
        if (['true', 'yes', 'y', '1'].includes(candidate)) boolean = true
        if (['false', 'no', 'n', '0'].includes(candidate)) boolean = false
      }
      if (boolean === null) {
        return { status: 'invalid', reason: 'Value is not a recognized boolean.' }
      }
      return {
        status: 'value',
        coerced: {
          value: boolean,
          comparable: boolean,
          display: boolean ? 'Yes' : 'No',
        },
      }
    }

    case 'date': {
      const date = dateFromCell(value)
      return date === null
        ? { status: 'invalid', reason: 'Value is not a supported calendar date.' }
        : { status: 'value', coerced: date }
    }

    case 'datetime': {
      const datetime = datetimeFromCell(value)
      return datetime === null
        ? { status: 'invalid', reason: 'Value is not an ISO date and time.' }
        : { status: 'value', coerced: datetime }
    }

    case 'workWeek': {
      const workWeek = workWeekFromCell(value)
      return workWeek === null
        ? { status: 'invalid', reason: "Value is not in the WW27'2026 work-week format." }
        : { status: 'value', coerced: workWeek }
    }
  }
}

export function coerceLiteral(literal: ScalarLiteralV1): CoercedValue | null {
  switch (literal.dataType) {
    case 'text':
      return {
        value: literal.value,
        comparable: literal.value,
        display: literal.value,
      }
    case 'number':
      return Number.isFinite(literal.value)
        ? {
            value: literal.value,
            comparable: literal.value,
            display: String(literal.value),
          }
        : null
    case 'boolean':
      return {
        value: literal.value,
        comparable: literal.value,
        display: literal.value ? 'Yes' : 'No',
      }
    case 'date':
      return dateFromCell(literal.value)
    case 'datetime':
      return datetimeFromCell(literal.value)
    case 'workWeek':
      return workWeekFromCell(literal.value)
  }
}

export function compareCoerced(
  left: CoercedValue,
  right: CoercedValue,
  dataType: FieldDataTypeV1,
  caseSensitive = false,
): number {
  let leftComparable = left.comparable
  let rightComparable = right.comparable
  if (dataType === 'text' && !caseSensitive) {
    leftComparable = String(leftComparable).toLowerCase()
    rightComparable = String(rightComparable).toLowerCase()
  }

  if (leftComparable === rightComparable) return 0
  if (typeof leftComparable === 'number' && typeof rightComparable === 'number') {
    return leftComparable < rightComparable ? -1 : 1
  }
  if (typeof leftComparable === 'boolean' && typeof rightComparable === 'boolean') {
    return leftComparable ? 1 : -1
  }
  return String(leftComparable).localeCompare(String(rightComparable), 'en-US')
}

export function coercedKey(
  value: CoercedValue,
  dataType: FieldDataTypeV1,
): string {
  return `${dataType}:${typeof value.comparable}:${String(value.comparable)}`
}
