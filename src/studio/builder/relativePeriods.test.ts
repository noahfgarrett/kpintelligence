import { describe, expect, it } from 'vitest'
import { resolveWorkWeekPreset } from './relativePeriods'

describe('relative work-week presets', () => {
  it('resolves the previous completed work week', () => {
    expect(resolveWorkWeekPreset(
      '@previous-work-week',
      new Date(2026, 6, 8, 12),
    )).toEqual({
      operator: 'equals',
      value: "WW27'2026",
    })
  })

  it('builds a rolling range across a year boundary', () => {
    expect(resolveWorkWeekPreset(
      '@last-4-completed-work-weeks',
      new Date(2026, 0, 7, 12),
    )).toEqual({
      operator: 'between',
      value: "WW50'2025..WW01'2026",
    })
  })
})
