import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'

const browserErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([])
})

test('featured OAC dashboard remains usable inside the library shell', async ({ page }) => {
  await expect(page.getByText('KPIntelligence', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Weekly QA\/QC Report/ }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'KPIntelligence' })).toBeVisible()

  await page.getByRole('button', { name: 'Preview Layout' }).click()
  await expect(page.getByText('Total Issues Opened', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Issues by Work Week', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: 'test-results/oac-featured-dashboard.png', fullPage: true })
})

test('folders, projects, dashboards, spreadsheet profiling, and the visual studio work end to end', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Home' }).click()
  await expect(page.getByRole('heading', { name: 'Your intelligence workspace' })).toBeVisible()

  await page.getByRole('button', { name: 'New folder' }).click()
  const folderDialog = page.getByRole('dialog', { name: 'Create folder' })
  await folderDialog.getByLabel('Name').fill('Field Operations')
  await folderDialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { name: 'Field Operations' })).toBeVisible()

  await page.getByRole('button', { name: 'New project' }).click()
  const projectDialog = page.getByRole('dialog', { name: 'Create project' })
  await projectDialog.getByLabel('Name').fill('Central Utility Plant')
  await projectDialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { name: 'Central Utility Plant' })).toBeVisible()

  await page.getByRole('button', { name: 'New dashboard' }).first().click()
  const dashboardDialog = page.getByRole('dialog', { name: 'Create dashboard' })
  await dashboardDialog.getByLabel('Name').fill('Inspection Performance')
  await dashboardDialog.getByRole('button', { name: /Blank dashboard/ }).click()
  await dashboardDialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByLabel('Dashboard name')).toHaveValue('Inspection Performance')
  await expect(page.getByRole('heading', { name: 'Build the first page' })).toBeVisible()

  await page.getByRole('button', { name: /Data$/ }).first().click()
  await page.locator('input[type=file][accept*=".csv"]').setInputFiles({
    name: 'Inspection_Log.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([
      'Work Week,Discipline,Contractor,Status,Inspection Phase,Issue?,Cost',
      "WW27'2026,Electrical,Bechtel,Closed,Final,No Issue Found,1250",
      "WW27'2026,Mechanical,Turner,Open,Final,BIM-104,900",
      "WW28'2026,Electrical,Bechtel,Open,SOR,BIM-108,2100",
      "WW28'2026,Process,Turner,Closed,Final,No Issue Found,1500",
      ...Array.from({ length: 30 }, (_, index) =>
        `WW28'2026,Electrical,Bechtel,Open,Final,BIM-${200 + index},1200`),
    ].join('\n')),
  })
  await expect(page.getByText(/34 rows · 7 columns/)).toBeVisible()

  await page.getByRole('button', { name: /Visuals$/ }).first().click()
  await page.getByRole('button', { name: 'Column', exact: true }).click()
  await expect(page.locator('.studio-widget')).toHaveCount(1)
  await expect(page.getByText(/Count rows from Sheet1 by Work Week/)).toBeVisible()
  await expect(page.locator('.studio-echart svg')).toBeVisible()

  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const condition = page.locator('.condition-row')
  await condition.getByLabel('Rule column').selectOption({ label: 'Status' })
  await condition.getByLabel('Rule operator').selectOption('notEquals')
  await condition.getByLabel('Rule value').fill('Void')
  await expect(page.getByText('34 included')).toBeVisible()

  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const numericCondition = page.locator('.condition-row').nth(1)
  await numericCondition.getByLabel('Rule column').selectOption({ label: 'Cost' })
  await expect(numericCondition.getByLabel('Rule operator').locator('option[value="contains"]')).toHaveCount(0)
  await numericCondition.getByLabel('Rule operator').selectOption('between')
  await numericCondition.getByLabel('Rule lower value').fill('800')
  await numericCondition.getByLabel('Rule upper value').fill('2200')
  await expect(page.getByText('34 included')).toBeVisible()

  await page.getByRole('button', { name: 'Filters' }).click()
  const filterPopover = page.locator('.filter-popover')
  await filterPopover.getByLabel('Column').selectOption({ label: 'Status' })
  await filterPopover.getByRole('button', { name: 'Add filter' }).click()
  await page.locator('.global-filter-chip select').selectOption('Open')
  await expect(page.getByText('32 included')).toBeVisible()

  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await expect(page.locator('.studio-widget')).toHaveCount(2)

  await page.getByRole('button', { name: 'Line', exact: true }).dragTo(page.locator('.studio-canvas'))
  await expect(page.locator('.studio-widget')).toHaveCount(3)

  await page.getByRole('button', { name: 'Add page' }).click()
  await expect(page.getByRole('button', { name: 'Page 2' })).toBeVisible()
  await page.getByRole('button', { name: 'Overview' }).click()

  await page.getByLabel('Expand Field Operations').click()
  const projectChevron = page.getByLabel('Expand Central Utility Plant')
  if (await projectChevron.count()) await projectChevron.click()
  const dashboardRow = page.locator('.dashboard-row').filter({ hasText: 'Inspection Performance' })
  await dashboardRow.locator('.tree-row-label strong').dblclick()
  await page.locator('.library-rename-input').fill('Inspection Performance Final')
  await page.locator('.library-rename-input').press('Enter')
  await expect(page.getByLabel('Dashboard name')).toHaveValue('Inspection Performance Final')

  await dashboardRow.getByRole('button', { name: 'Options for Inspection Performance Final' }).click()
  await page.getByLabel('Move Inspection Performance Final').selectOption({
    label: 'OAC Weekly Reporting',
  })
  await expect(page.getByText(/load its spreadsheet source before moving/i)).toBeVisible()
  await expect(page.getByLabel('Dashboard name')).toHaveValue('Inspection Performance Final')

  await page.getByRole('button', { name: 'Back to project' }).click()
  await page.locator('.project-dashboard-grid > button').filter({ hasText: 'Inspection Performance Final' }).click()
  await expect(page.getByLabel('Dashboard name')).toHaveValue('Inspection Performance Final')
  await expect(page.getByRole('button', { name: 'Page 2' })).toBeVisible()

  const exportButton = page.getByRole('button', { name: 'Export', exact: true })
  await exportButton.click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Export setup' })).toBeHidden()
  await expect(exportButton).toBeFocused()

  await exportButton.click()
  const exportDialog = page.getByRole('dialog', { name: 'Export setup' })
  await expect(exportDialog.getByRole('button', { name: 'PPTX', exact: true })).toBeVisible()
  await expect(exportDialog.getByRole('button', { name: 'PDF', exact: true })).toBeVisible()
  await expect(exportDialog.getByRole('button', { name: 'PNG', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/custom-dashboard-studio.png', fullPage: true })

  await exportDialog.getByLabel('Image quality').selectOption('2')
  await exportDialog.getByRole('button', { name: 'PDF', exact: true }).click()
  const pdfDownload = page.waitForEvent('download')
  await exportDialog.getByRole('button', { name: 'Export PDF' }).click()
  const pdf = await pdfDownload
  await expect(pdf.suggestedFilename()).toMatch(/Inspection Performance Final\.pdf$/)
  const pdfPath = testInfo.outputPath('Inspection Performance.pdf')
  await pdf.saveAs(pdfPath)
  const pdfBytes = await readFile(pdfPath)
  expect(pdfBytes.subarray(0, 4).toString()).toBe('%PDF')
  expect(pdfBytes.byteLength).toBeGreaterThan(10_000)

  await page.getByRole('button', { name: 'Export' }).click()
  const pptxDialog = page.getByRole('dialog', { name: 'Export setup' })
  await pptxDialog.getByRole('button', { name: 'PPTX', exact: true }).click()
  const pptxDownload = page.waitForEvent('download')
  await pptxDialog.getByRole('button', { name: 'Export PPTX' }).click()
  const pptx = await pptxDownload
  await expect(pptx.suggestedFilename()).toMatch(/Inspection Performance Final\.pptx$/)
  const pptxPath = testInfo.outputPath('Inspection Performance.pptx')
  await pptx.saveAs(pptxPath)
  const pptxBytes = await readFile(pptxPath)
  expect(pptxBytes.subarray(0, 2).toString()).toBe('PK')
  expect(pptxBytes.byteLength).toBeGreaterThan(10_000)
  const pptxEntries = Object.keys(unzipSync(new Uint8Array(pptxBytes)))
  expect(pptxEntries.some((entry) => entry.endsWith('.svg'))).toBe(true)
  expect(pptxEntries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry))).toHaveLength(3)

  await exportButton.click()
  const pngDialog = page.getByRole('dialog', { name: 'Export setup' })
  await pngDialog.getByRole('button', { name: 'PNG', exact: true }).click()
  const pngDownload = page.waitForEvent('download')
  await pngDialog.getByRole('button', { name: 'Export PNG' }).click()
  const png = await pngDownload
  await expect(png.suggestedFilename()).toMatch(/Inspection Performance Final - PNG Pages\.zip$/)
  const pngPath = testInfo.outputPath('Inspection Performance Final - PNG Pages.zip')
  await png.saveAs(pngPath)
  const pngBytes = await readFile(pngPath)
  expect(pngBytes.subarray(0, 2).toString()).toBe('PK')
  const pngEntries = Object.keys(unzipSync(new Uint8Array(pngBytes)))
  expect(pngEntries.filter((entry) => entry.endsWith('.png'))).toHaveLength(3)

  await page.setViewportSize({ width: 1320, height: 840 })
  await expect(page.getByLabel('Dashboard name')).toBeVisible()
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)
  await page.screenshot({ path: 'test-results/custom-dashboard-studio-1320.png', fullPage: true })
})
