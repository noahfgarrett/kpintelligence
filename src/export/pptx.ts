import pptxgen from 'pptxgenjs'
import type { GeneratedReportFile } from './types'
import type { AgingBucket, ElectricalPoint, IssueDetailRow, KpiMetric, MonthlyIssuePoint, ReportModel, WeeklyIssuePoint, WeldingPoint } from '@/types'
import { compactNumber, deltaLabel, percent } from '@/utils/format'

const SLIDE_W = 13.333
const SLIDE_H = 7.5
const SAFE_TOP = 0.58
const SAFE_BOTTOM = 0.54
const SAFE_H = SLIDE_H - SAFE_TOP - SAFE_BOTTOM
// Mirrors DESIGN.md tokens. Series keys keep their old names but new semantic
// values so existing draw calls remap: cyan=Opened(red), mint=Closed(green),
// amber=Remaining, teal=brand series (slate-blue), coral=alert.
const C = {
  ink: '1B2530',
  graphite: '28323F',
  text: '1B2530',
  muted: '6A7583',
  faint: 'DCE3EC',
  hairline: 'EBEEF3',
  panel: 'F2F5F9',
  surface: 'F7F9FC',
  white: 'FFFFFF',
  accent: '2E5AAC',
  accentStrong: '244A93',
  accentSoft: 'EAF0FA',
  track: 'E4E9F0',
  teal: '2E5AAC',
  cyan: 'EC6152',
  mint: '0D6331',
  amber: 'C2870B',
  coral: 'D03B3B',
  obsidian: '1B2530',
}

function addHeader(slide: pptxgen.Slide, title: string, report: ReportModel, context = `Report Week ${report.reportWeek.label}`): void {
  slide.background = { color: C.white }
  // Slate-blue brand mark, matching the app header
  slide.addShape('roundRect', {
    x: 0.55,
    y: SAFE_TOP,
    w: 0.44,
    h: 0.44,
    rectRadius: 0.08,
    fill: { color: C.accent },
    line: { color: C.accent },
  })
  slide.addText(title, {
    x: 1.12,
    y: SAFE_TOP + 0.02,
    w: 6.0,
    h: 0.4,
    fontFace: 'Aptos Display',
    fontSize: 18,
    bold: true,
    color: C.text,
    valign: 'middle',
    margin: 0,
  })
  const pills = [
    `OAC Through ${report.reportWeek.label}`,
    report.source === 'files' ? 'Imported Files' : 'Preview Layout',
    context,
  ]
  pills.forEach((pill, index) => {
    slide.addShape('roundRect', {
      x: 7.05 + index * 1.78,
      y: SAFE_TOP + 0.09,
      w: 1.62,
      h: 0.28,
      rectRadius: 0.06,
      fill: { color: C.panel },
      line: { color: C.faint },
    })
    slide.addText(pill, {
      x: 7.11 + index * 1.78,
      y: SAFE_TOP + 0.145,
      w: 1.5,
      h: 0.14,
      fontSize: 6.8,
      color: C.muted,
      bold: true,
      align: 'center',
      margin: 0,
      fit: 'shrink',
    })
  })
  // Hairline under the header
  addLine(slide, 0.55, SAFE_TOP + 0.54, 12.78, SAFE_TOP + 0.54, C.faint, 1)
}

function addFooter(slide: pptxgen.Slide, report: ReportModel): void {
  slide.addText(`Generated ${report.generatedAt.toLocaleDateString()} | v${__APP_VERSION__}`, {
    x: 0.55,
    y: SAFE_TOP + SAFE_H - 0.16,
    w: 5,
    h: 0.12,
    fontSize: 6.2,
    color: C.muted,
    margin: 0,
  })
}

function addKpiCard(slide: pptxgen.Slide, x: number, y: number, w: number, label: string, value: string, delta: string, color = C.accent): void {
  slide.addShape('roundRect', {
    x,
    y,
    w,
    h: 0.76,
    rectRadius: 0.1,
    fill: { color: C.surface },
    line: { color: C.faint },
    shadow: { type: 'outer', color: 'CBD5E1', opacity: 0.13, blur: 1, angle: 45, offset: 1 },
  })
  slide.addText(label, {
    x: x + 0.14,
    y: y + 0.11,
    w: w - 0.24,
    h: 0.12,
    fontSize: 6.6,
    bold: true,
    color: C.muted,
    margin: 0,
    fit: 'shrink',
  })
  slide.addText(value, {
    x: x + 0.14,
    y: y + 0.28,
    w: w - 0.24,
    h: 0.23,
    fontFace: 'Aptos Display',
    fontSize: 17,
    bold: true,
    color: C.text,
    margin: 0,
    fit: 'shrink',
  })
  slide.addText(delta, {
    x: x + 0.14,
    y: y + 0.56,
    w: w - 0.24,
    h: 0.1,
    fontSize: 6.4,
    bold: true,
    color,
    margin: 0,
    fit: 'shrink',
  })
}

function addSplitSignoffCard(
  slide: pptxgen.Slide,
  x: number,
  y: number,
  w: number,
  overallValue: string,
  reportWeek: string,
  reportWeekValue: string,
  delta: string,
): void {
  slide.addShape('roundRect', {
    x,
    y,
    w,
    h: 0.76,
    rectRadius: 0.1,
    fill: { color: C.surface },
    line: { color: C.faint },
    shadow: { type: 'outer', color: 'CBD5E1', opacity: 0.13, blur: 1, angle: 45, offset: 1 },
  })
  slide.addText('SIGN-OFF %', { x: x + 0.12, y: y + 0.08, w: w - 0.24, h: 0.1, fontSize: 5.8, bold: true, color: C.muted, margin: 0 })
  addLine(slide, x + w / 2, y + 0.22, x + w / 2, y + 0.66, C.faint, 0.6)
  const cells = [
    { label: 'Overall avg', value: overallValue, delta: '' },
    { label: reportWeek, value: reportWeekValue, delta },
  ]
  cells.forEach((cell, index) => {
    const cellX = x + 0.12 + index * (w / 2)
    const cellW = w / 2 - 0.18
    slide.addText(cell.label, { x: cellX, y: y + 0.24, w: cellW, h: 0.1, fontSize: 5.1, bold: true, color: C.muted, margin: 0, fit: 'shrink' })
    slide.addText(cell.value, { x: cellX, y: y + 0.38, w: cellW, h: 0.18, fontFace: 'Aptos Display', fontSize: 13, bold: true, color: C.text, margin: 0, fit: 'shrink' })
    if (cell.delta) slide.addText(cell.delta, { x: cellX, y: y + 0.59, w: cellW, h: 0.08, fontSize: 4.8, bold: true, color: C.teal, margin: 0, fit: 'shrink' })
  })
}

function metricToneColor(metric: KpiMetric): string {
  if (metric.tone === 'bad') return C.coral
  if (metric.tone === 'warn') return C.amber
  if (metric.tone === 'good') return C.mint
  return C.teal
}

function addKpiGroup(
  slide: pptxgen.Slide,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  context: string,
  metrics: KpiMetric[],
  background: string,
  showDeltas = true,
): void {
  slide.addShape('roundRect', {
    x,
    y,
    w,
    h,
    rectRadius: 0.11,
    fill: { color: background },
    line: { color: C.faint },
    shadow: { type: 'outer', color: 'CBD5E1', opacity: 0.11, blur: 1, angle: 45, offset: 1 },
  })
  slide.addText(title, {
    x: x + 0.16,
    y: y + 0.11,
    w: 2.2,
    h: 0.11,
    fontSize: 6.3,
    bold: true,
    color: C.graphite,
    charSpacing: 0.5,
    margin: 0,
  })
  slide.addText(context, {
    x: x + w - 2.25,
    y: y + 0.11,
    w: 2.08,
    h: 0.11,
    fontSize: 6.1,
    bold: true,
    color: C.muted,
    align: 'right',
    margin: 0,
  })
  addLine(slide, x + w / 2, y + 0.36, x + w / 2, y + h - 0.12, C.hairline, 0.6)
  addLine(slide, x + 0.14, y + 0.96, x + w - 0.14, y + 0.96, C.hairline, 0.6)

  const cellW = (w - 0.44) / 2
  metrics.forEach((metric, index) => {
    const col = index % 2
    const row = Math.floor(index / 2)
    const cellX = x + 0.16 + col * (cellW + 0.12)
    const cellY = y + 0.39 + row * 0.61
    slide.addText(metric.label, {
      x: cellX,
      y: cellY,
      w: cellW,
      h: 0.1,
      fontSize: 6.2,
      bold: true,
      color: C.muted,
      margin: 0,
      fit: 'shrink',
    })
    slide.addText(metric.value, {
      x: cellX,
      y: cellY + 0.15,
      w: cellW * 0.55,
      h: 0.23,
      fontFace: 'Aptos Display',
      fontSize: 15,
      bold: true,
      color: C.text,
      margin: 0,
      fit: 'shrink',
    })
    if (showDeltas) {
      slide.addText(metric.deltaLabel, {
        x: cellX + cellW * 0.56,
        y: cellY + 0.23,
        w: cellW * 0.42,
        h: 0.1,
        fontSize: 5.6,
        bold: true,
        color: metricToneColor(metric),
        align: 'right',
        margin: 0,
        fit: 'shrink',
      })
    }
  })
}

function maxOf(values: number[]): number {
  return Math.max(1, ...values)
}

function workWeekNumber(label: string): string {
  const match = label.match(/^WW(\d{1,2})/i)
  return match ? `WW${match[1].padStart(2, '0')}` : label
}

function addPanel(slide: pptxgen.Slide, x: number, y: number, w: number, h: number, title: string): void {
  slide.addShape('roundRect', {
    x,
    y,
    w,
    h,
    rectRadius: 0.12,
    fill: { color: C.white },
    line: { color: C.faint },
    shadow: { type: 'outer', color: 'CBD5E1', opacity: 0.18, blur: 1, angle: 45, offset: 1 },
  })
  slide.addText(title, {
    x: x + 0.18,
    y: y + 0.12,
    w: w - 0.36,
    h: 0.16,
    fontSize: 9,
    bold: true,
    color: C.text,
    margin: 0,
  })
}

function addLine(slide: pptxgen.Slide, x1: number, y1: number, x2: number, y2: number, color: string, width = 1, dash?: 'dash'): void {
  const line: pptxgen.ShapeLineProps = { color, width }
  if (dash) line.dashType = dash
  slide.addShape('line', {
    x: x1,
    y: y1,
    w: x2 - x1,
    h: y2 - y1,
    line,
  })
}

function addIssueTrend(slide: pptxgen.Slide, data: WeeklyIssuePoint[], x: number, y: number, w: number, h: number): void {
  addPanel(slide, x, y, w, h, 'Issues by Work Week')
  const visible = data.slice(-30)
  const chartX = x + 0.5
  const chartY = y + 0.5
  const chartW = w - 1.02
  const chartH = h - 0.84
  const groupW = chartW / Math.max(visible.length, 1)
  const maxBar = maxOf(visible.flatMap((d) => [d.opened, d.closed]))
  const maxLine = maxOf(visible.map((d) => d.remainingOpen))

  slide.addText('Remaining Open   Opened   Closed', {
    x: x + 0.42,
    y: y + 0.31,
    w: 3,
    h: 0.11,
    fontSize: 6,
    color: C.muted,
    margin: 0,
  })

  ;[0, 0.5, 1].forEach((ratio) => {
    const yy = chartY + chartH - ratio * chartH
    addLine(slide, chartX, yy, chartX + chartW, yy, C.hairline, 0.6)
    slide.addText(String(Math.round(maxBar * ratio)), { x: x + 0.12, y: yy - 0.05, w: 0.28, h: 0.1, fontSize: 5.2, color: C.muted, align: 'right', margin: 0 })
    slide.addText(String(Math.round(maxLine * ratio)), { x: chartX + chartW + 0.06, y: yy - 0.05, w: 0.3, h: 0.1, fontSize: 5.2, color: C.amber, margin: 0 })
  })

  visible.forEach((point, index) => {
    const gx = chartX + index * groupW + groupW * 0.16
    const barW = Math.max(0.025, groupW * 0.25)
    const openedH = (point.opened / maxBar) * chartH
    const closedH = (point.closed / maxBar) * chartH
    slide.addShape('roundRect', { x: gx, y: chartY + chartH - openedH, w: barW, h: Math.max(0.01, openedH), rectRadius: 0.02, fill: { color: C.cyan }, line: { color: C.cyan } })
    slide.addShape('roundRect', { x: gx + groupW * 0.34, y: chartY + chartH - closedH, w: barW, h: Math.max(0.01, closedH), rectRadius: 0.02, fill: { color: C.mint }, line: { color: C.mint } })
    const openedInside = openedH >= 0.14
    const closedInside = closedH >= 0.14
    if (point.opened > 0) slide.addText(String(point.opened), { x: gx - 0.04, y: openedInside ? chartY + chartH - 0.13 : chartY + chartH - openedH - 0.11, w: barW + 0.08, h: 0.1, fontSize: 5, bold: true, color: openedInside ? C.white : C.cyan, align: 'center', margin: 0 })
    if (point.closed > 0) slide.addText(String(point.closed), { x: gx + groupW * 0.34 - 0.04, y: closedInside ? chartY + chartH - 0.13 : chartY + chartH - closedH - 0.11, w: barW + 0.08, h: 0.1, fontSize: 5, bold: true, color: closedInside ? C.white : C.mint, align: 'center', margin: 0 })
    slide.addText(workWeekNumber(point.workWeek), {
      x: chartX + index * groupW - 0.03,
      y: chartY + chartH + 0.04,
      w: groupW + 0.05,
      h: 0.1,
      fontSize: 4.8,
      color: C.muted,
      align: 'center',
      margin: 0,
    })
  })

  visible.forEach((point, index) => {
    const px = chartX + index * groupW + groupW / 2
    const py = chartY + chartH - (point.remainingOpen / maxLine) * chartH
    if (index > 0) {
      const prev = visible[index - 1]
      addLine(slide, px - groupW, chartY + chartH - (prev.remainingOpen / maxLine) * chartH, px, py, C.amber, 1.5)
    }
    slide.addShape('ellipse', { x: px - 0.027, y: py - 0.027, w: 0.054, h: 0.054, fill: { color: C.amber }, line: { color: C.white, width: 0.6 } })
    if (index % 3 === 0 || index === visible.length - 1) {
      slide.addText(String(point.remainingOpen), { x: px - 0.16, y: Math.max(chartY, py - 0.15), w: 0.32, h: 0.11, fontSize: 5.2, bold: true, color: C.amber, align: 'center', margin: 0 })
    }
  })
}

function addMonthly(slide: pptxgen.Slide, data: MonthlyIssuePoint[], x: number, y: number, w: number, h: number): void {
  addPanel(slide, x, y, w, h, 'Cumulative Opened vs Closed')
  const chartX = x + 0.35
  const chartY = y + 0.54
  const chartW = w - 0.62
  const chartH = h - 0.85
  const visible = data.slice(-10)
  const maxY = maxOf(visible.flatMap((d) => [d.opened, d.closed]))
  const step = chartW / Math.max(1, visible.length - 1)
  addLine(slide, chartX, chartY + chartH, chartX + chartW, chartY + chartH, 'D8DEE7', 0.7)
  visible.forEach((point, index) => {
    if (index === 0) return
    const prev = visible[index - 1]
    const x1 = chartX + (index - 1) * step
    const x2 = chartX + index * step
    addLine(slide, x1, chartY + chartH - (prev.opened / maxY) * chartH, x2, chartY + chartH - (point.opened / maxY) * chartH, C.cyan, 1.5)
    addLine(slide, x1, chartY + chartH - (prev.closed / maxY) * chartH, x2, chartY + chartH - (point.closed / maxY) * chartH, C.mint, 1.5)
  })
  visible.forEach((point, index) => {
    const px = chartX + index * step
    const openedY = chartY + chartH - (point.opened / maxY) * chartH
    const closedY = chartY + chartH - (point.closed / maxY) * chartH
    slide.addShape('ellipse', { x: px - 0.025, y: openedY - 0.025, w: 0.05, h: 0.05, fill: { color: C.cyan }, line: { color: C.white, width: 0.5 } })
    slide.addShape('ellipse', { x: px - 0.025, y: closedY - 0.025, w: 0.05, h: 0.05, fill: { color: C.mint }, line: { color: C.white, width: 0.5 } })
    slide.addText(String(point.opened), { x: px - 0.18, y: Math.max(chartY, openedY - 0.15), w: 0.36, h: 0.11, fontSize: 5.8, bold: true, color: C.cyan, align: 'center', margin: 0 })
    slide.addText(String(point.closed), { x: px - 0.18, y: Math.min(chartY + chartH - 0.07, closedY + 0.05), w: 0.36, h: 0.11, fontSize: 5.8, bold: true, color: C.mint, align: 'center', margin: 0 })
    slide.addText(point.month, { x: px - 0.26, y: chartY + chartH + 0.06, w: 0.52, h: 0.11, fontSize: 5.8, color: C.muted, align: 'center', margin: 0 })
  })
}

function addAging(slide: pptxgen.Slide, data: AgingBucket[], x: number, y: number, w: number, h: number): void {
  addPanel(slide, x, y, w, h, 'Issue Aging')
  const maxY = maxOf(data.map((d) => d.count))
  data.forEach((bucket, index) => {
    const yy = y + 0.55 + index * 0.42
    slide.addText(bucket.label, { x: x + 0.26, y: yy, w: 1.1, h: 0.12, fontSize: 6.5, color: C.muted, margin: 0 })
    slide.addShape('roundRect', {
      x: x + 1.25,
      y: yy - 0.02,
      w: (bucket.count / maxY) * (w - 1.82),
      h: 0.18,
      rectRadius: 0.04,
      fill: { color: bucket.color.replace('#', '') },
      line: { color: bucket.color.replace('#', '') },
    })
    slide.addText(compactNumber(bucket.count), { x: x + w - 0.44, y: yy, w: 0.25, h: 0.1, fontSize: 6.5, bold: true, color: C.text, margin: 0 })
  })
}

function addSimpleLine(slide: pptxgen.Slide, data: ElectricalPoint[], x: number, y: number, w: number, h: number): void {
  addPanel(slide, x, y, w, h, 'Electrical Inspections by Work Week')
  slide.addText('Final Inspections   Issue Found', { x: x + 0.45, y: y + 0.32, w: 2.8, h: 0.11, fontSize: 6, color: C.muted, margin: 0 })
  const chartX = x + 0.45
  const chartY = y + 0.62
  const chartW = w - 0.78
  const chartH = h - 1.12
  const visible = data.slice(-30)
  const maxY = maxOf(visible.map((d) => d.finals))
  const step = chartW / Math.max(1, visible.length - 1)
  ;[0, 0.5, 1].forEach((ratio) => {
    const yy = chartY + chartH - ratio * chartH
    addLine(slide, chartX, yy, chartX + chartW, yy, C.hairline, 0.6)
    slide.addText(String(Math.round(maxY * ratio)), { x: x + 0.12, y: yy - 0.05, w: 0.25, h: 0.1, fontSize: 5, color: C.muted, align: 'right', margin: 0 })
  })
  visible.forEach((point, index) => {
    const px = chartX + index * step
    const py = chartY + chartH - (point.finals / maxY) * chartH
    if (index > 0) {
      const prev = visible[index - 1]
      addLine(
        slide,
        chartX + (index - 1) * step,
        chartY + chartH - (prev.finals / maxY) * chartH,
        px,
        py,
        C.teal,
        1.5,
      )
    }
    slide.addShape('ellipse', { x: px - 0.025, y: py - 0.025, w: 0.05, h: 0.05, fill: { color: C.teal }, line: { color: C.white, width: 0.5 } })
    slide.addText(String(point.finals), { x: px - 0.13, y: Math.max(chartY - 0.02, py - 0.14), w: 0.26, h: 0.1, fontSize: 4.8, bold: true, color: C.accentStrong, align: 'center', margin: 0 })
    if (point.issuesFound > 0) {
      const issueY = Math.min(chartY + chartH - 0.13, py + 0.11)
      slide.addShape('ellipse', {
        x: px - 0.06,
        y: issueY,
        w: 0.12,
        h: 0.12,
        fill: { color: C.coral },
        line: { color: C.white, width: 0.5 },
      })
      slide.addText(String(point.issuesFound), { x: px - 0.06, y: issueY + 0.025, w: 0.12, h: 0.06, fontSize: 4.2, bold: true, color: C.white, align: 'center', margin: 0, fit: 'shrink' })
    }
    if (index % 5 === 0 || index === visible.length - 1) {
      slide.addText(workWeekNumber(point.workWeek), { x: px - 0.18, y: chartY + chartH + 0.08, w: 0.36, h: 0.1, fontSize: 5, color: C.muted, align: 'center', margin: 0 })
    }
  })
  slide.addText('INSPECTION COUNT', { x: chartX, y: chartY - 0.15, w: 1.05, h: 0.09, fontSize: 4.8, bold: true, color: C.muted, margin: 0 })
  slide.addText('Work Week Observed', { x: x + 2.2, y: y + h - 0.18, w: 1.4, h: 0.1, fontSize: 5.5, color: C.muted, margin: 0 })
}

function addWelding(slide: pptxgen.Slide, data: WeldingPoint[], reportWeek: string, x: number, y: number, w: number, h: number): void {
  addPanel(slide, x, y, w, h, 'Welding Signoffs by Work Week')
  const chartX = x + 0.45
  const chartY = y + 0.62
  const chartW = w - 0.9
  const chartH = h - 1.12
  const visible = data.slice(-30)
  const maxY = maxOf(visible.map((d) => d.total))
  const groupW = chartW / Math.max(visible.length, 1)
  const barW = Math.min(0.17, groupW * 0.56)
  const rateY = (rate: number): number => chartY + chartH - (rate / 100) * chartH
  ;[0, 0.5, 1].forEach((ratio) => {
    const yy = chartY + chartH - ratio * chartH
    addLine(slide, chartX, yy, chartX + chartW, yy, C.hairline, 0.6)
    slide.addText(String(Math.round(maxY * ratio)), { x: x + 0.12, y: yy - 0.05, w: 0.25, h: 0.1, fontSize: 4.8, color: C.muted, align: 'right', margin: 0 })
  })
  ;[0, 25, 50, 75, 100].forEach((rate) => {
    slide.addText(`${rate}%`, { x: chartX + chartW + 0.04, y: rateY(rate) - 0.05, w: 0.3, h: 0.1, fontSize: 4.8, color: C.amber, margin: 0 })
  })
  visible.forEach((point, index) => {
    const bx = chartX + index * groupW + (groupW - barW) / 2
    const totalH = (point.total / maxY) * chartH
    const signedH = (point.signed / maxY) * chartH
    const totalY = chartY + chartH - totalH
    const signedY = chartY + chartH - signedH
    slide.addShape('roundRect', { x: bx, y: totalY, w: barW, h: Math.max(0.01, totalH), rectRadius: 0.02, fill: { color: C.track }, line: { color: C.track } })
    slide.addShape('roundRect', { x: bx, y: signedY, w: barW, h: Math.max(0.01, signedH), rectRadius: 0.02, fill: { color: C.mint }, line: { color: C.mint } })
    if (point.total > 0) slide.addText(String(point.total), { x: bx - 0.05, y: Math.max(chartY, totalY - 0.11), w: barW + 0.1, h: 0.09, fontSize: 4.5, bold: true, color: C.graphite, align: 'center', margin: 0 })
    if (point.signed > 0) slide.addText(String(point.signed), { x: bx - 0.04, y: signedH >= 0.15 ? signedY + 0.04 : signedY - 0.09, w: barW + 0.08, h: 0.08, fontSize: 4.3, bold: true, color: signedH >= 0.15 ? C.white : C.mint, align: 'center', margin: 0 })
    if (index % 5 === 0 || index === visible.length - 1) {
      slide.addText(workWeekNumber(point.workWeek), { x: bx - 0.12, y: chartY + chartH + 0.08, w: barW + 0.24, h: 0.1, fontSize: 5, color: C.muted, align: 'center', margin: 0 })
    }
  })
  addLine(slide, chartX, rateY(10), chartX + chartW, rateY(10), C.coral, 0.9, 'dash')
  const ratePoints = visible
    .map((point, index) => ({ point, x: chartX + index * groupW + groupW / 2, y: rateY(point.signoffRate) }))
    .filter(({ point }) => point.total > 0)
  ratePoints.forEach(({ x: px, y: py }, index) => {
    if (index === 0) return
    const previous = ratePoints[index - 1]
    addLine(slide, previous.x, previous.y, px, py, C.amber, 1.4)
  })
  ratePoints.forEach(({ x: px, y: py }) => {
    slide.addShape('ellipse', { x: px - 0.025, y: py - 0.025, w: 0.05, h: 0.05, fill: { color: C.amber }, line: { color: C.white, width: 0.5 } })
  })
  const reportRatePoint = ratePoints.find(({ point }) => point.workWeek === reportWeek)
  if (reportRatePoint) {
    const above = Math.max(chartY, reportRatePoint.y - 0.13)
    const below = Math.min(chartY + chartH - 0.08, reportRatePoint.y + 0.05)
    const totalY = chartY + chartH - (reportRatePoint.point.total / maxY) * chartH
    const issueY = Math.max(chartY, totalY - 0.2)
    const reservedY = reportRatePoint.point.issuesCreated > 0 ? issueY : Math.max(chartY, totalY - 0.11)
    const labelY = Math.abs(above - reservedY) < 0.14 ? below : above
    slide.addShape('roundRect', { x: reportRatePoint.x - 0.15, y: labelY - 0.015, w: 0.3, h: 0.11, rectRadius: 0.025, fill: { color: C.white, transparency: 4 }, line: { color: C.amber, transparency: 55, width: 0.4 } })
    slide.addText(percent(reportRatePoint.point.signoffRate, 0), { x: reportRatePoint.x - 0.15, y: labelY, w: 0.3, h: 0.09, fontSize: 4.5, bold: true, color: C.amber, align: 'center', margin: 0 })
  }
  slide.addText('10% baseline', { x: chartX + chartW + 0.02, y: rateY(10) - 0.09, w: 0.4, h: 0.08, fontSize: 4.2, bold: true, color: C.coral, margin: 0, fit: 'shrink' })
  visible.forEach((point, index) => {
    if (point.issuesCreated <= 0) return
    const px = chartX + index * groupW + groupW / 2
    const totalY = chartY + chartH - (point.total / maxY) * chartH
    const badgeY = Math.max(chartY, totalY - 0.2)
    slide.addShape('ellipse', { x: px - 0.065, y: badgeY, w: 0.13, h: 0.13, fill: { color: C.coral }, line: { color: C.white, width: 0.5 } })
    slide.addText(String(point.issuesCreated), { x: px - 0.065, y: badgeY + 0.03, w: 0.13, h: 0.06, fontSize: 4.1, bold: true, color: C.white, align: 'center', margin: 0, fit: 'shrink' })
  })
  slide.addText('Signed   Total welds   Sign-off %   Issue created   10% baseline', { x: x + 0.4, y: y + 0.32, w: 4.8, h: 0.11, fontSize: 5.6, color: C.muted, margin: 0 })
  slide.addText('WELD COUNT', { x: chartX, y: chartY - 0.15, w: 0.72, h: 0.09, fontSize: 4.8, bold: true, color: C.muted, margin: 0 })
  slide.addText('SIGN-OFF RATE', { x: chartX + chartW - 0.82, y: chartY - 0.15, w: 0.82, h: 0.09, fontSize: 4.8, bold: true, color: C.amber, align: 'right', margin: 0 })
}

function addIssueTable(slide: pptxgen.Slide, rows: IssueDetailRow[]): void {
  const x = 0.55
  const y = SAFE_TOP + 1.82
  const columns = [
    ['ID', 0.72],
    ['Subtype', 1.1],
    ['Status', 0.85],
    ['Title', 3.2],
    ['Contractor', 1.45],
    ['Work Week', 0.88],
    ['Created On', 0.82],
    ['Work Week Closed', 1.04],
    ['Due Date', 0.72],
  ] as const
  let cursor = x
  slide.addShape('roundRect', {
    x,
    y: y - 0.05,
    w: 12.25,
    h: 4.25,
    rectRadius: 0.1,
    fill: { color: C.white },
    line: { color: C.faint },
    shadow: { type: 'outer', color: 'CBD5E1', opacity: 0.16, blur: 1, angle: 45, offset: 1 },
  })
  slide.addShape('roundRect', { x, y, w: 12.25, h: 0.3, rectRadius: 0.06, fill: { color: C.panel }, line: { color: C.faint } })
  columns.forEach(([label, width]) => {
    slide.addText(label.toUpperCase(), { x: cursor + 0.05, y: y + 0.04, w: width - 0.1, h: 0.12, fontSize: 5.6, bold: true, color: C.muted, charSpacing: 0.4, margin: 0, fit: 'shrink' })
    cursor += width
  })
  rows.forEach((row, rowIndex) => {
    const yy = y + 0.35 + rowIndex * 0.235
    slide.addShape('rect', {
      x,
      y: yy - 0.03,
      w: 12.25,
      h: 0.22,
      fill: { color: rowIndex % 2 === 0 ? 'F8FAFC' : 'FFFFFF' },
      line: { color: 'F1F5F9', transparency: 50 },
    })
    const values = [row.id, row.subtype, row.status, row.title, row.contractor, row.workWeek, row.createdOn, row.workWeekClosed, row.dueDate]
    cursor = x
    columns.forEach(([, width], index) => {
      const statusColor = row.status.toLowerCase().includes('closed') ? C.mint : row.status.toLowerCase().includes('overdue') ? C.coral : C.teal
      slide.addText(values[index], {
        x: cursor + 0.05,
        y: yy + 0.025,
        w: width - 0.1,
        h: 0.1,
        fontSize: 5.7,
        bold: index === 0 || index === 2,
        color: index === 2 ? statusColor : C.text,
        margin: 0,
        fit: 'shrink',
      })
      cursor += width
    })
  })
}

function issuePages(rows: IssueDetailRow[], size = 14): IssueDetailRow[][] {
  if (rows.length === 0) return [[]]
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size))
}

export async function exportReportDeck(report: ReportModel): Promise<GeneratedReportFile> {
  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Noah Garrett'
  pptx.subject = `Weekly report through ${report.reportWeek.label}`
  pptx.title = `QA/QC Weekly Report ${report.reportWeek.label}`
  pptx.company = 'QCx Intelligence'
  pptx.theme = {
    headFontFace: 'Aptos Display',
    bodyFontFace: 'Aptos',
  }

  const slide1 = pptx.addSlide()
  slide1.background = { color: C.white }
  const kpiY = SAFE_TOP + 0.08
  const metricsById = new Map(report.kpis.map((metric) => [metric.id, metric]))
  const projectMetrics = ['total-closed', 'total-opened', 'remaining-open', 'closure-rate']
    .map((id) => metricsById.get(id))
    .filter((metric): metric is KpiMetric => Boolean(metric))
  const weekMetrics = ['opened-week', 'closed-week', 'inspections', 'sors']
    .map((id) => metricsById.get(id))
    .filter((metric): metric is KpiMetric => Boolean(metric))
  const kpiGroupGap = 0.18
  const kpiGroupW = (12.23 - kpiGroupGap) / 2
  addKpiGroup(slide1, 0.55, kpiY, kpiGroupW, 1.62, 'PROJECT TO DATE', `Through ${report.reportWeek.label}`, projectMetrics, C.surface)
  addKpiGroup(slide1, 0.55 + kpiGroupW + kpiGroupGap, kpiY, kpiGroupW, 1.62, report.reportWeek.label, '', weekMetrics, C.panel, false)
  addIssueTrend(slide1, report.issueTrend, 0.55, SAFE_TOP + 1.86, 12.23, 1.82)
  addMonthly(slide1, report.monthlyTrend, 0.55, SAFE_TOP + 3.9, 7.85, 1.88)
  addAging(slide1, report.aging, 8.62, SAFE_TOP + 3.9, 4.16, 1.88)
  addFooter(slide1, report)

  const pages = issuePages(report.issueTable)
  pages.forEach((rows, pageIndex) => {
    const slide = pptx.addSlide()
    addHeader(slide, `BIM Issues Detail${pages.length > 1 ? ` (${pageIndex + 1} of ${pages.length})` : ''}`, report)
    const openedGroup: IssueDetailRow['group'] = report.activeFilters.oac ? 'Opened in Report Week' : 'Open Carryover'
    const openedLabel = report.activeFilters.oac ? 'Issues Opened During Report Week' : 'Issues Remaining Open'
    addKpiCard(slide, 0.55, SAFE_TOP + 0.82, 2.7, openedLabel, compactNumber(report.issueTable.filter((row) => row.group === openedGroup).length), '', C.teal)
    addKpiCard(slide, 3.47, SAFE_TOP + 0.82, 2.7, 'Issues Closed During Report Week', compactNumber(report.issueTable.filter((row) => row.group === 'Closed in Report Week').length), '', C.mint)
    addKpiCard(slide, 6.39, SAFE_TOP + 0.82, 2.7, 'Opened + Closed Within Report Week', compactNumber(report.issueTable.filter((row) => row.group === 'Opened + Closed in Report Week').length), '', C.cyan)
    addKpiCard(slide, 9.31, SAFE_TOP + 0.82, 2.7, 'Issues Closed During Current Week', compactNumber(report.issueTable.filter((row) => row.group === 'Closed This Week').length), '', C.amber)
    addIssueTable(slide, rows)
    addFooter(slide, report)
  })

  const fieldSlide = pptx.addSlide()
  addHeader(fieldSlide, 'Inspections & Welding Signoffs', report, `Current Week ${report.currentWeek.label}`)
  const chips = [
    ['Electrical Finals', compactNumber(report.summary.electricalFinals), deltaLabel(report.summary.deltas.electricalFinals)],
    ['Electrical Issues Found', compactNumber(report.summary.electricalIssuesFound), deltaLabel(report.summary.deltas.electricalIssuesFound)],
    ['Total Welds', compactNumber(report.summary.weldsChecked), deltaLabel(report.summary.deltas.weldsChecked)],
    ['Welds Signed', compactNumber(report.summary.weldsSigned), deltaLabel(report.summary.deltas.weldsSigned)],
  ]
  chips.forEach(([label, value, delta], index) => addKpiCard(fieldSlide, 0.55 + index * 2.48, SAFE_TOP + 0.82, 2.22, label, value, delta, index === 1 ? C.amber : C.teal))
  addSplitSignoffCard(
    fieldSlide,
    10.47,
    SAFE_TOP + 0.82,
    2.3,
    percent(report.summary.overallSignoffRate, 1),
    report.reportWeek.label,
    percent(report.summary.reportWeekSignoffRate, 1),
    deltaLabel(report.summary.deltas.reportWeekSignoffRate),
  )
  addSimpleLine(fieldSlide, report.electrical, 0.55, SAFE_TOP + 2.08, 5.95, 3.74)
  addWelding(fieldSlide, report.welding, report.reportWeek.label, 6.82, SAFE_TOP + 2.08, 5.95, 3.74)
  addFooter(fieldSlide, report)

  const output = await pptx.write({ outputType: 'blob', compression: true })
  const blob = output instanceof Blob
    ? output
    : new Blob([output as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  return {
    data: new Uint8Array(await blob.arrayBuffer()),
    fileName: `QCx Weekly QAQC Report ${report.reportWeek.label.replace("'", '-')}.pptx`,
    filters: [{ name: 'PowerPoint presentation', extensions: ['pptx'] }],
  }
}
