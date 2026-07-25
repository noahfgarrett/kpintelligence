import html2canvas from 'html2canvas'
import { zipSync } from 'fflate'
import { jsPDF } from 'jspdf'
import pptxgen from 'pptxgenjs'
import type { GeneratedReportFile } from '@/export/types'
import type { DashboardRecord, ExportProfileRecord } from '../library/model'

export interface ExportPageSize {
  widthInches: number
  heightInches: number
  widthPixels: number
  heightPixels: number
}

interface CapturedVectorChart {
  data: string
  xPixels: number
  yPixels: number
  widthPixels: number
  heightPixels: number
}

interface CapturedPage {
  image: string
  vectorCharts: CapturedVectorChart[]
}

export function exportPageSize(profile: ExportProfileRecord): ExportPageSize {
  const landscape = profile.orientation === 'landscape'
  const base = profile.pageSize === 'standard'
    ? { width: 10, height: 7.5 }
    : profile.pageSize === 'letter'
      ? { width: 11, height: 8.5 }
      : profile.pageSize === 'a4'
        ? { width: 11.69, height: 8.27 }
        : { width: 13.333, height: 7.5 }
  const widthInches = landscape ? Math.max(base.width, base.height) : Math.min(base.width, base.height)
  const heightInches = landscape ? Math.min(base.width, base.height) : Math.max(base.width, base.height)
  const widthPixels = 1440
  return {
    widthInches,
    heightInches,
    widthPixels,
    heightPixels: Math.round(widthPixels * heightInches / widthInches),
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function safeFileName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'KPIntelligence Dashboard'
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function svgDataUrl(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const bytes = new TextEncoder().encode(new XMLSerializer().serializeToString(clone))
  let binary = ''
  const chunkSize = 16_384
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`
}

async function capturePages(profile: ExportProfileRecord): Promise<CapturedPage[]> {
  const pages = Array.from(document.querySelectorAll<HTMLElement>('[data-studio-export-page]'))
  if (pages.length === 0) throw new Error('No dashboard pages are available to export.')

  await document.fonts.ready
  await nextFrame()
  await nextFrame()
  await wait(320)

  const captures: CapturedPage[] = []
  for (const page of pages) {
    const pageRect = page.getBoundingClientRect()
    const vectorCharts = Array.from(page.querySelectorAll<SVGSVGElement>('.studio-echart svg'))
      .flatMap((svg) => {
        const rect = svg.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return []
        return [{
          data: svgDataUrl(svg),
          xPixels: rect.left - pageRect.left,
          yPixels: rect.top - pageRect.top,
          widthPixels: rect.width,
          heightPixels: rect.height,
        }]
      })
    const canvas = await html2canvas(page, {
      backgroundColor: '#ffffff',
      scale: profile.scale,
      useCORS: true,
      logging: false,
      removeContainer: true,
      windowWidth: page.offsetWidth,
      windowHeight: page.offsetHeight,
    })
    captures.push({
      image: canvas.toDataURL('image/png'),
      vectorCharts,
    })
    canvas.width = 1
    canvas.height = 1
  }
  return captures
}

async function buildPptx(
  pages: CapturedPage[],
  size: ExportPageSize,
  dashboard: DashboardRecord,
): Promise<GeneratedReportFile> {
  const deck = new pptxgen()
  deck.author = 'Noah Garrett'
  deck.company = 'KPIntelligence'
  deck.subject = dashboard.description || dashboard.name
  deck.title = dashboard.name
  deck.defineLayout({
    name: 'KP_CUSTOM',
    width: size.widthInches,
    height: size.heightInches,
  })
  deck.layout = 'KP_CUSTOM'

  pages.forEach((page) => {
    const slide = deck.addSlide()
    slide.background = { color: 'FFFFFF' }
    slide.addImage({
      data: page.image,
      x: 0,
      y: 0,
      w: size.widthInches,
      h: size.heightInches,
    })
    page.vectorCharts.forEach((chart) => {
      slide.addImage({
        data: chart.data,
        x: chart.xPixels / size.widthPixels * size.widthInches,
        y: chart.yPixels / size.heightPixels * size.heightInches,
        w: chart.widthPixels / size.widthPixels * size.widthInches,
        h: chart.heightPixels / size.heightPixels * size.heightInches,
      })
    })
  })

  const output = await deck.write({ outputType: 'blob', compression: true })
  const blob = output instanceof Blob
    ? output
    : new Blob([output as BlobPart], {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      })
  return {
    data: new Uint8Array(await blob.arrayBuffer()),
    fileName: `${safeFileName(dashboard.name)}.pptx`,
    filters: [{ name: 'PowerPoint presentation', extensions: ['pptx'] }],
  }
}

function buildPdf(
  pages: CapturedPage[],
  size: ExportPageSize,
  dashboard: DashboardRecord,
): GeneratedReportFile {
  const orientation = size.widthInches >= size.heightInches ? 'landscape' : 'portrait'
  const pdf = new jsPDF({
    orientation,
    unit: 'in',
    format: [size.widthInches, size.heightInches],
    compress: true,
  })
  pages.forEach((page, index) => {
    if (index > 0) pdf.addPage([size.widthInches, size.heightInches], orientation)
    pdf.addImage(page.image, 'PNG', 0, 0, size.widthInches, size.heightInches, undefined, 'SLOW')
  })
  return {
    data: new Uint8Array(pdf.output('arraybuffer')),
    fileName: `${safeFileName(dashboard.name)}.pdf`,
    filters: [{ name: 'PDF document', extensions: ['pdf'] }],
  }
}

function buildPng(
  pages: CapturedPage[],
  dashboard: DashboardRecord,
): GeneratedReportFile {
  const baseName = safeFileName(dashboard.name)
  if (pages.length === 1) {
    return {
      data: dataUrlBytes(pages[0].image),
      fileName: `${baseName}.png`,
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    }
  }
  const archiveEntries = Object.fromEntries(pages.map((page, index) => [
    `${baseName} - ${String(index + 1).padStart(2, '0')}.png`,
    dataUrlBytes(page.image),
  ]))
  return {
    data: zipSync(archiveEntries, { level: 6 }),
    fileName: `${baseName} - PNG Pages.zip`,
    filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
  }
}

export async function exportRenderedDashboard(
  dashboard: DashboardRecord,
  profile: ExportProfileRecord,
): Promise<GeneratedReportFile> {
  const size = exportPageSize(profile)
  const pages = await capturePages(profile)
  if (profile.format === 'pptx') return buildPptx(pages, size, dashboard)
  if (profile.format === 'pdf') return buildPdf(pages, size, dashboard)
  return buildPng(pages, dashboard)
}
