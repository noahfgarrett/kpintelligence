import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'

export interface EChartProps {
  option: EChartsOption
  ariaLabel: string
  onPointClick?: (category: string, dataIndex: number) => void
}

export default function EChart({ option, ariaLabel, onPointClick }: EChartProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const clickRef = useRef(onPointClick)
  clickRef.current = onPointClick

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const chart = echarts.init(host, undefined, { renderer: 'svg' })
    const resizeObserver = new ResizeObserver(() => chart.resize())
    resizeObserver.observe(host)
    chart.on('click', (params) => {
      const dataCategory = Array.isArray(params.data) && params.data.length > 2
        ? String(params.data[2] ?? '')
        : ''
      clickRef.current?.(String(params.name ?? dataCategory), params.dataIndex)
    })
    return () => {
      resizeObserver.disconnect()
      chart.dispose()
    }
  }, [])

  useEffect(() => {
    const chart = hostRef.current ? echarts.getInstanceByDom(hostRef.current) : undefined
    chart?.setOption(option, { notMerge: true, lazyUpdate: false })
  }, [option])

  return (
    <div
      ref={hostRef}
      className="studio-echart"
      role={onPointClick ? 'button' : 'img'}
      tabIndex={onPointClick ? 0 : undefined}
      aria-label={onPointClick ? `${ariaLabel}. Press Enter to view contributing rows.` : ariaLabel}
      onKeyDown={(event) => {
        if (!onPointClick || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        onPointClick('', 0)
      }}
    />
  )
}
