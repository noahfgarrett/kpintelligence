import type { EChartsOption, SeriesOption } from 'echarts'
import type { StudioVisualType } from './catalog'

export interface ChartDataPoint {
  category: string
  value: number
  secondaryValue?: number
  series?: string
  x?: number
  y?: number
}

export interface ChartAppearance {
  title?: string
  showLegend?: boolean
  showLabels?: boolean
  smooth?: boolean
  primaryColor?: string
  secondaryColor?: string
  target?: number
  valueFormat?: 'number' | 'percent' | 'currency'
  currencyCode?: string
  xAxisTitle?: string
  yAxisTitle?: string
  axisLabelRotation?: number
  showGrid?: boolean
}

const COLORS = ['#2E5AAC', '#0D6331', '#C2870B', '#EC6152', '#6B5CA5', '#27808C']
const AXIS = {
  axisLine: { lineStyle: { color: '#DCE3EC' } },
  axisTick: { show: false },
  axisLabel: { color: '#6A7583', fontSize: 11 },
}

function chartColors(appearance: ChartAppearance): string[] {
  return [
    appearance.primaryColor ?? COLORS[0],
    appearance.secondaryColor ?? COLORS[1],
    ...COLORS.slice(2),
  ]
}

function formatValue(
  value: number,
  format: ChartAppearance['valueFormat'],
  currencyCode = 'USD',
): string {
  if (format === 'percent') return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
  if (format === 'currency') {
    return value.toLocaleString(undefined, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 0,
    })
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function cartesianBase(appearance: ChartAppearance): EChartsOption {
  return {
    animationDuration: 280,
    color: chartColors(appearance),
    aria: { enabled: true, decal: { show: true } },
    tooltip: { trigger: 'axis', confine: true },
    legend: {
      show: appearance.showLegend ?? true,
      top: 2,
      right: 8,
      textStyle: { color: '#45505F', fontSize: 11 },
    },
    grid: { top: 36, right: 24, bottom: 34, left: 48, containLabel: true },
    xAxis: {
      type: 'category',
      ...AXIS,
      name: appearance.xAxisTitle,
      nameLocation: 'middle',
      nameGap: 28,
      axisLabel: { ...AXIS.axisLabel, rotate: appearance.axisLabelRotation ?? 0 },
    },
    yAxis: {
      type: 'value',
      ...AXIS,
      name: appearance.yAxisTitle,
      nameLocation: 'middle',
      nameGap: 38,
      splitLine: { show: appearance.showGrid ?? true, lineStyle: { color: '#EBEEF3' } },
    },
  }
}

function lineSeries(name: string, values: number[], appearance: ChartAppearance, area = false): SeriesOption {
  return {
    type: 'line',
    name,
    data: values,
    smooth: appearance.smooth ?? true,
    symbolSize: 7,
    lineStyle: { width: 2.4 },
    itemStyle: { borderColor: '#FDFEFF', borderWidth: 2 },
    areaStyle: area ? { opacity: 0.1 } : undefined,
    label: {
      show: appearance.showLabels ?? true,
      position: 'top',
      color: '#45505F',
      fontSize: 10,
      formatter: ({ value }) => formatValue(
        Number(value),
        appearance.valueFormat,
        appearance.currencyCode,
      ),
    },
    labelLayout: { hideOverlap: true },
  }
}

function grouped(points: ChartDataPoint[]): Map<string, ChartDataPoint[]> {
  const groups = new Map<string, ChartDataPoint[]>()
  points.forEach((point) => {
    const name = point.series || 'Value'
    groups.set(name, [...(groups.get(name) ?? []), point])
  })
  return groups
}

export function buildChartOption(
  type: Exclude<StudioVisualType, 'kpi' | 'table' | 'text' | 'progress'>,
  points: ChartDataPoint[],
  appearance: ChartAppearance = {},
): EChartsOption {
  const categories = [...new Set(points.map((point) => point.category))]
  const groups = grouped(points)
  const valuesFor = (items: ChartDataPoint[]) =>
    categories.map((category) => items.find((point) => point.category === category)?.value ?? 0)

  if (type === 'pie' || type === 'donut') {
    return {
      animationDuration: 280,
      color: chartColors(appearance),
      aria: { enabled: true, decal: { show: true } },
      tooltip: { trigger: 'item', confine: true },
      legend: { show: appearance.showLegend ?? true, bottom: 0, textStyle: { color: '#45505F', fontSize: 11 } },
      series: [{
        type: 'pie',
        radius: type === 'donut' ? ['46%', '70%'] : '70%',
        center: ['50%', '45%'],
        avoidLabelOverlap: true,
        padAngle: 2,
        itemStyle: { borderColor: '#FDFEFF', borderWidth: 2, borderRadius: 4 },
        label: {
          show: appearance.showLabels ?? true,
          formatter: ({ name, value }) =>
            `${name}\n${formatValue(Number(value), appearance.valueFormat, appearance.currencyCode)}`,
          color: '#45505F',
          fontSize: 10,
        },
        data: points.map((point) => ({ name: point.category, value: point.value })),
      }],
    }
  }

  if (type === 'gauge') {
    const value = points[0]?.value ?? 0
    const max = appearance.target && appearance.target > value ? appearance.target : Math.max(100, value)
    return {
      animationDuration: 280,
      aria: { enabled: true },
      series: [{
        type: 'gauge',
        min: 0,
        max,
        startAngle: 205,
        endAngle: -25,
        progress: { show: true, width: 14, roundCap: true, itemStyle: { color: appearance.primaryColor ?? COLORS[0] } },
        axisLine: { lineStyle: { width: 14, color: [[1, '#E8EDF4']] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        anchor: { show: false },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, '10%'],
          formatter: (current: number) =>
            formatValue(current, appearance.valueFormat, appearance.currencyCode),
          color: '#1B2530',
          fontSize: 27,
          fontWeight: 650,
        },
        data: [{ value }],
      }],
    }
  }

  if (type === 'funnel') {
    return {
      animationDuration: 280,
      color: chartColors(appearance),
      aria: { enabled: true, decal: { show: true } },
      tooltip: { trigger: 'item', confine: true },
      series: [{
        type: 'funnel',
        top: 10,
        bottom: 10,
        left: '8%',
        width: '84%',
        minSize: '16%',
        maxSize: '100%',
        sort: 'descending',
        gap: 3,
        label: {
          show: true,
          position: 'inside',
          color: '#FFFFFF',
          formatter: ({ name, value }) =>
            `${name}  ${formatValue(Number(value), appearance.valueFormat, appearance.currencyCode)}`,
        },
        itemStyle: { borderColor: '#FDFEFF', borderWidth: 1, borderRadius: 3 },
        data: [...points]
          .sort((a, b) => b.value - a.value)
          .map((point) => ({ name: point.category, value: point.value })),
      }],
    }
  }

  if (type === 'treemap') {
    return {
      animationDuration: 280,
      color: chartColors(appearance),
      aria: { enabled: true, decal: { show: true } },
      tooltip: { confine: true },
      series: [{
        type: 'treemap',
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        label: {
          show: true,
          formatter: ({ name, value }) =>
            `${name}\n${formatValue(Number(value), appearance.valueFormat, appearance.currencyCode)}`,
          color: '#FFFFFF',
          fontSize: 11,
        },
        upperLabel: { show: false },
        itemStyle: { borderColor: '#FDFEFF', borderWidth: 3, gapWidth: 2 },
        data: points.map((point) => ({ name: point.category, value: point.value })),
      }],
    }
  }

  if (type === 'radar') {
    const max = Math.max(1, ...points.map((point) => point.value))
    return {
      animationDuration: 280,
      color: chartColors(appearance),
      aria: { enabled: true, decal: { show: true } },
      tooltip: { confine: true },
      legend: { show: appearance.showLegend ?? true, bottom: 0 },
      radar: {
        radius: '62%',
        center: ['50%', '47%'],
        indicator: points.map((point) => ({ name: point.category, max: max * 1.15 })),
        splitLine: { lineStyle: { color: '#DCE3EC' } },
        splitArea: { areaStyle: { color: ['#FDFEFF', '#F7F9FC'] } },
        axisName: { color: '#6A7583', fontSize: 10 },
      },
      series: [{
        type: 'radar',
        data: [{ name: appearance.title ?? 'Value', value: points.map((point) => point.value) }],
        areaStyle: { opacity: 0.12 },
        lineStyle: { width: 2.2 },
        symbolSize: 6,
      }],
    }
  }

  if (type === 'scatter') {
    const base = cartesianBase(appearance)
    return {
      ...base,
      tooltip: { trigger: 'item', confine: true },
      legend: {
        show: (appearance.showLegend ?? true) && groups.size > 1,
        top: 2,
        right: 8,
        textStyle: { color: '#45505F', fontSize: 11 },
      },
      xAxis: {
        type: 'value',
        ...AXIS,
        name: appearance.xAxisTitle,
        nameLocation: 'middle',
        nameGap: 28,
        splitLine: { show: appearance.showGrid ?? true, lineStyle: { color: '#EBEEF3' } },
      },
      yAxis: {
        type: 'value',
        ...AXIS,
        name: appearance.yAxisTitle,
        nameLocation: 'middle',
        nameGap: 38,
        splitLine: { show: appearance.showGrid ?? true, lineStyle: { color: '#EBEEF3' } },
      },
      series: [...groups.entries()].map(([name, items]) => ({
        type: 'scatter',
        name,
        symbolSize: 11,
        data: items.map((point) => [
          point.x ?? point.value,
          point.y ?? point.secondaryValue ?? 0,
          point.category,
        ]),
        label: {
          show: appearance.showLabels ?? false,
          formatter: ({ data }) => Array.isArray(data) ? String(data[2] ?? '') : '',
          position: 'top',
          color: '#45505F',
        },
        labelLayout: { hideOverlap: true },
      })),
    }
  }

  if (type === 'heatmap') {
    const xValues = [...new Set(points.map((point) => point.category))]
    const yValues = [...new Set(points.map((point) => point.series ?? 'Value'))]
    const max = Math.max(1, ...points.map((point) => point.value))
    return {
      animationDuration: 220,
      aria: { enabled: true },
      tooltip: { position: 'top', confine: true },
      grid: { top: 14, right: 18, bottom: 42, left: 70, containLabel: true },
      xAxis: {
        type: 'category',
        data: xValues,
        ...AXIS,
        name: appearance.xAxisTitle,
        axisLabel: { ...AXIS.axisLabel, rotate: appearance.axisLabelRotation ?? 0 },
      },
      yAxis: { type: 'category', data: yValues, ...AXIS, name: appearance.yAxisTitle },
      visualMap: {
        min: 0,
        max,
        calculable: false,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        inRange: { color: ['#EAF0FA', appearance.primaryColor ?? COLORS[0]] },
        textStyle: { color: '#6A7583', fontSize: 10 },
      },
      series: [{
        type: 'heatmap',
        data: points.map((point) => [
          xValues.indexOf(point.category),
          yValues.indexOf(point.series ?? 'Value'),
          point.value,
        ]),
        label: {
          show: appearance.showLabels ?? true,
          formatter: ({ value }) => Array.isArray(value)
            ? formatValue(Number(value[2]), appearance.valueFormat, appearance.currencyCode)
            : '',
          color: '#1B2530',
          fontSize: 10,
        },
      }],
    }
  }

  const base = cartesianBase(appearance)
  const isHorizontal = type === 'bar' || type === 'stackedBar'
  const series = [...groups.entries()].map(([name, items], index): SeriesOption => {
    const values = valuesFor(items)
    if (type === 'line' || type === 'area') return lineSeries(name, values, appearance, type === 'area')
    if (type === 'combo' && index === groups.size - 1) {
      return {
        ...lineSeries(name, values, appearance),
        yAxisIndex: 1,
      } as SeriesOption
    }
    return {
      type: 'bar',
      name,
      data: values,
      stack: type === 'stackedBar' ? 'total' : undefined,
      barMaxWidth: 28,
      itemStyle: { borderRadius: isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] },
      label: {
        show: appearance.showLabels ?? true,
        position: isHorizontal ? 'right' : 'top',
        color: '#45505F',
        fontSize: 10,
        formatter: ({ value }) => formatValue(
          Number(value),
          appearance.valueFormat,
          appearance.currencyCode,
        ),
      },
      labelLayout: { hideOverlap: true },
    }
  })

  return {
    ...base,
    xAxis: isHorizontal
      ? {
          type: 'value',
          ...AXIS,
          name: appearance.yAxisTitle,
          nameLocation: 'middle',
          nameGap: 28,
          splitLine: { show: appearance.showGrid ?? true, lineStyle: { color: '#EBEEF3' } },
        }
      : {
          type: 'category',
          data: categories,
          ...AXIS,
          name: appearance.xAxisTitle,
          nameLocation: 'middle',
          nameGap: 28,
          axisLabel: { ...AXIS.axisLabel, rotate: appearance.axisLabelRotation ?? 0 },
        },
    yAxis: type === 'combo'
      ? [
          {
            type: 'value',
            ...AXIS,
            name: appearance.yAxisTitle,
            nameLocation: 'middle',
            nameGap: 38,
            splitLine: { show: appearance.showGrid ?? true, lineStyle: { color: '#EBEEF3' } },
          },
          { type: 'value', ...AXIS, splitLine: { show: false } },
        ]
      : isHorizontal
        ? {
            type: 'category',
            data: categories,
            ...AXIS,
            name: appearance.xAxisTitle,
            axisLabel: { ...AXIS.axisLabel, rotate: appearance.axisLabelRotation ?? 0 },
          }
        : {
            type: 'value',
            ...AXIS,
            name: appearance.yAxisTitle,
            nameLocation: 'middle',
            nameGap: 38,
            splitLine: { show: appearance.showGrid ?? true, lineStyle: { color: '#EBEEF3' } },
          },
    series,
  }
}
