import { describe, expect, it, vi } from 'vitest'
import { coerceCell, coerceLiteral, compareCoerced, isBlankCell } from './coercion'
import type { FieldDataTypeV1, FieldV1 } from './model'

const timestamp = '2026-07-25T12:00:00.000Z'

function field(
  dataType: FieldDataTypeV1,
  overrides: Partial<FieldV1> = {},
): FieldV1 {
  return {
    kind: 'field',
    schemaVersion: 1,
    id: `field-${dataType}`,
    name: dataType,
    createdAt: timestamp,
    updatedAt: timestamp,
    datasetId: 'dataset',
    sourceColumn: dataType,
    aliases: [],
    dataType,
    nullable: true,
    coercion: {
      trimText: true,
      emptyTextIsBlank: true,
    },
    ...overrides,
  }
}

describe('safe cell coercion', () => {
  it('normalizes supported primitive text and honors blank policy', () => {
    const textField = field('text')
    expect(coerceCell('  Final  ', textField)).toEqual({
      status: 'value',
      coerced: { value: 'Final', comparable: 'Final', display: 'Final' },
    })
    expect(coerceCell(42, textField)).toMatchObject({
      status: 'value',
      coerced: { value: '42' },
    })
    expect(isBlankCell('   ', textField)).toBe(true)
    expect(coerceCell('   ', textField)).toEqual({ status: 'blank' })

    const literalWhitespace = field('text', {
      coercion: { trimText: false, emptyTextIsBlank: false },
    })
    expect(isBlankCell('', literalWhitespace)).toBe(false)
    expect(coerceCell('', literalWhitespace)).toMatchObject({
      status: 'value',
      coerced: { value: '' },
    })
  })

  it('never invokes object conversion hooks', () => {
    const toString = vi.fn(() => {
      throw new Error('must not execute')
    })
    const result = coerceCell({ toString }, field('text'))
    expect(result).toEqual({
      status: 'invalid',
      reason: 'Value cannot be safely converted to text.',
    })
    expect(toString).not.toHaveBeenCalled()
  })

  it('accepts unambiguous finite and scientific numbers without JavaScript coercion', () => {
    const numberField = field('number')
    expect(coerceCell('1,234.50', numberField)).toMatchObject({
      status: 'value',
      coerced: { value: 1234.5 },
    })
    expect(coerceCell('-0.25', numberField)).toMatchObject({
      status: 'value',
      coerced: { value: -0.25 },
    })
    expect(coerceCell('1e3', numberField)).toMatchObject({
      status: 'value',
      coerced: { value: 1000 },
    })
    expect(coerceCell('.5', numberField)).toMatchObject({
      status: 'value',
      coerced: { value: 0.5 },
    })

    for (const unsafe of ['0x10', '12,34', 'Infinity', 'NaN', '$20']) {
      expect(coerceCell(unsafe, numberField).status).toBe('invalid')
    }
    expect(coerceCell(Number.POSITIVE_INFINITY, numberField).status).toBe('invalid')
  })

  it('converts explicit percentage text only for percentage fields', () => {
    const percentField = field('number', {
      format: { numberStyle: 'percent', decimalPlaces: 1 },
    })
    expect(coerceCell('50%', percentField)).toMatchObject({
      status: 'value',
      coerced: { value: 0.5 },
    })
    expect(coerceCell('50%', field('number')).status).toBe('invalid')
  })

  it('coerces only recognized boolean values', () => {
    const booleanField = field('boolean')
    for (const truthy of [true, 1, 'YES', 'y', 'true']) {
      expect(coerceCell(truthy, booleanField)).toMatchObject({
        status: 'value',
        coerced: { value: true },
      })
    }
    for (const falsey of [false, 0, 'No', 'n', 'false']) {
      expect(coerceCell(falsey, booleanField)).toMatchObject({
        status: 'value',
        coerced: { value: false },
      })
    }
    expect(coerceCell('sometimes', booleanField).status).toBe('invalid')
  })

  it('parses deterministic calendar dates and rejects impossible dates', () => {
    const dateField = field('date')
    expect(coerceCell('2028-02-29', dateField)).toMatchObject({
      status: 'value',
      coerced: { value: '2028-02-29' },
    })
    expect(coerceCell('7/25/2026', dateField)).toMatchObject({
      status: 'value',
      coerced: { value: '2026-07-25' },
    })
    expect(coerceCell('7/6/26', dateField)).toMatchObject({
      status: 'value',
      coerced: { value: '2026-07-06' },
    })
    expect(coerceCell(new Date('2026-07-06T00:00:00.000Z'), dateField)).toMatchObject({
      status: 'value',
      coerced: { value: '2026-07-06' },
    })
    expect(coerceCell('2026-02-29', dateField).status).toBe('invalid')
    expect(coerceCell('25/7/2026', dateField).status).toBe('invalid')
  })

  it('accepts ISO and Smartsheet-style US datetimes without arbitrary date strings', () => {
    const datetimeField = field('datetime')
    expect(coerceCell('2026-07-25T14:30:00-05:00', datetimeField)).toMatchObject({
      status: 'value',
      coerced: { value: '2026-07-25T19:30:00.000Z' },
    })
    expect(coerceCell('7/25/26 2:30 PM', datetimeField)).toMatchObject({
      status: 'value',
      coerced: { value: '2026-07-25T14:30:00.000Z' },
    })
    expect(coerceCell('July 25, 2026 2:30 PM', datetimeField).status).toBe('invalid')
  })

  it('normalizes and orders work-week values', () => {
    const workWeekField = field('workWeek')
    const week9 = coerceCell("ww 9 ' 2026", workWeekField)
    const week27 = coerceCell("WW27'2026", workWeekField)
    expect(week9).toMatchObject({
      status: 'value',
      coerced: { value: "WW9'2026", comparable: 202609 },
    })
    expect(week27).toMatchObject({
      status: 'value',
      coerced: { value: "WW27'2026", comparable: 202627 },
    })
    expect(coerceCell('WW28-26', workWeekField)).toMatchObject({
      status: 'value',
      coerced: { value: "WW28'2026", comparable: 202628 },
    })
    expect(coerceCell("WW54'2026", workWeekField).status).toBe('invalid')

    if (week9.status === 'value' && week27.status === 'value') {
      expect(compareCoerced(week9.coerced, week27.coerced, 'workWeek')).toBeLessThan(0)
    }
  })

  it('rejects non-finite and malformed typed literals', () => {
    expect(coerceLiteral({ dataType: 'number', value: Number.NaN })).toBeNull()
    expect(coerceLiteral({ dataType: 'date', value: '2026-13-01' })).toBeNull()
    expect(coerceLiteral({ dataType: 'workWeek', value: "WW0'2026" })).toBeNull()
  })
})
