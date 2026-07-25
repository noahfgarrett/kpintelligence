import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import type { GeneratedReportFile } from './types'
import type { ReportModel } from '@/types'

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function hasBlackRasterArtifact(source: CanvasImageSource): boolean {
  const sample = document.createElement('canvas')
  sample.width = 160
  sample.height = 90
  const context = sample.getContext('2d', { willReadFrequently: true })
  if (!context) return false
  context.drawImage(source, 0, 0, sample.width, sample.height)
  const pixels = context.getImageData(0, 0, sample.width, sample.height).data
  for (let y = 0; y < sample.height; y += 1) {
    let blackPixels = 0
    for (let x = 0; x < sample.width; x += 1) {
      const index = (y * sample.width + x) * 4
      if (pixels[index] < 10 && pixels[index + 1] < 10 && pixels[index + 2] < 10 && pixels[index + 3] > 245) {
        blackPixels += 1
      }
    }
    if (blackPixels > sample.width * 0.2) return true
  }
  return false
}

async function encodedImageHasBlackRasterArtifact(source: string): Promise<boolean> {
  const image = new Image()
  image.src = source
  await image.decode()
  return hasBlackRasterArtifact(image)
}

export async function exportSlidesPdf(report: ReportModel): Promise<GeneratedReportFile> {
  const slides = Array.from(document.querySelectorAll<HTMLElement>('[data-export-slide]'))
  if (slides.length === 0) throw new Error('No slides are available for PDF export.')

  await document.fonts.ready

  const captureDeck = document.createElement('div')
  captureDeck.className = 'export-deck'
  captureDeck.setAttribute('aria-hidden', 'true')
  Object.assign(captureDeck.style, {
    left: '0',
    position: 'fixed',
    top: '0',
    zIndex: '-1',
  })
  document.body.appendChild(captureDeck)

  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'in',
    format: [13.333, 7.5],
    compress: true,
  })

  try {
    for (const [index, slide] of slides.entries()) {
      if (index > 0) pdf.addPage([13.333, 7.5], 'landscape')
      let imageData: string | null = null
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const captureSlide = slide.cloneNode(true) as HTMLElement
        captureSlide.style.marginBottom = '0'
        captureDeck.replaceChildren(captureSlide)
        await waitForPaint()
        const captured = await html2canvas(captureSlide, {
          backgroundColor: '#ffffff',
          scale: 3,
          useCORS: true,
          logging: false,
          windowWidth: captureSlide.scrollWidth,
          windowHeight: captureSlide.scrollHeight,
        })
        if (!hasBlackRasterArtifact(captured)) {
          const encoded = captured.toDataURL('image/png')
          if (!(await encodedImageHasBlackRasterArtifact(encoded))) {
            imageData = encoded
            captured.width = 1
            captured.height = 1
            break
          }
        }
        captured.width = 1
        captured.height = 1
        await wait(600 * (attempt + 1))
      }
      if (!imageData) throw new Error(`Page ${index + 1} could not be rendered cleanly. Please retry the PDF export.`)
      pdf.addImage(imageData, 'PNG', 0, 0, 13.333, 7.5, undefined, 'SLOW')
    }
  } finally {
    captureDeck.remove()
  }

  return {
    data: new Uint8Array(pdf.output('arraybuffer')),
    fileName: `KPIntelligence Weekly QAQC Report ${report.reportWeek.label.replace("'", '-')}.pdf`,
    filters: [{ name: 'PDF document', extensions: ['pdf'] }],
  }
}
