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

  it('routes the named secondary series to the right axis', () => {
    const option = buildChartOption('combo', [
      { category: "WW27'2026", value: 50, series: 'Total welds' },
      { category: "WW27'2026", value: 80, series: 'Sign-off %' },
    ], {
      secondarySeriesName: 'Sign-off %',
      secondaryYAxisTitle: 'Sign-off %',
    })
    const series = option.series as Array<{ name?: string; type?: string; yAxisIndex?: number }>
    expect(series.find((item) => item.name === 'Total welds')).toMatchObject({
      type: 'bar',
    })
    expect(series.find((item) => item.name === 'Sign-off %')).toMatchObject({
      type: 'line',
      yAxisIndex: 1,
    })
    expect((option.yAxis as Array<{ name?: string }>)[1].name).toBe('Sign-off %')
  })

  it('adds an adaptive 30-category window and a labeled reference line', () => {
    const manyPoints = Array.from({ length: 35 }, (_, index) => ({
      category: `WW${String(index + 1).padStart(2, '0')}'2026`,
      value: index,
      series: 'Value',
    }))
    const option = buildChartOption('line', manyPoints, {
      showReferenceLine: true,
      referenceLineValue: 10,
      referenceLineLabel: '10% baseline',
    })
    const series = option.series as Array<{
      markLine?: { data?: Array<{ yAxis?: number }> }
    }>
    expect(option.dataZoom).toHaveLength(2)
    expect(series[0].markLine?.data?.[0]).toMatchObject({ yAxis: 10 })
    expect((option.yAxis as { max?: number }).max).toBeGreaterThan(10)
    const xAxis = option.xAxis as {
      axisLabel?: { formatter?: (value: string) => string }
    }
    expect(xAxis.axisLabel?.formatter?.("WW27'2026")).toBe('WW27')
  })

  it('does not expose function-valued user configuration', () => {
    const option = buildChartOption('donut', points)
    expect(JSON.stringify(option)).not.toContain('function')
  })

  it('keeps raw work-week categories behind compact pie labels', () => {
    const option = buildChartOption('donut', [{
      category: "WW27'2026",
      value: 5,
      series: 'Opened',
    }])
    const series = option.series as Array<{
      data?: Array<{ name?: string; rawCategory?: string }>
    }>
    expect(series[0].data?.[0]).toMatchObject({
      name: 'WW27',
      rawCategory: "WW27'2026",
    })
  })
})
