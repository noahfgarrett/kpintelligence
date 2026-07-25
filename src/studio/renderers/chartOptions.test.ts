import { describe, expect, it } from 'vitest'
import { buildChartOption } from './chartOptions'

const points = [
  { category: 'WW01', value: 4, series: 'Opened' },
  { category: 'WW02', value: 6, series: 'Opened' },
  { category: 'WW01', value: 2, series: 'Closed' },
  { category: 'WW02', value: 5, series: 'Closed' },
]

describe('studio chart option builder', () => {
  it('builds grouped column series from a safe visual schema', () => {
    const option = buildChartOption('column', points)
    expect(Array.isArray(option.series)).toBe(true)
    expect(option.series).toHaveLength(2)
    expect(option.xAxis).toMatchObject({ type: 'category', data: ['WW01', 'WW02'] })
  })

  it('uses separate axes for combo visuals', () => {
    const option = buildChartOption('combo', points)
    expect(Array.isArray(option.yAxis)).toBe(true)
    expect(option.yAxis).toHaveLength(2)
  })

  it('does not expose function-valued user configuration', () => {
    const option = buildChartOption('donut', points)
    expect(JSON.stringify(option)).not.toContain('function')
  })
})
