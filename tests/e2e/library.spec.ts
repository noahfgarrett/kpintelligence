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

test('version control performs a manual update check and opens the changelog', async ({ page }) => {
  const versionButton = page.getByRole('button', { name: /Version .+ Check for updates/ })
  await expect(versionButton).toBeVisible()
  await versionButton.click()

  const changelog = page.getByRole('dialog', { name: 'Changelog' })
  await expect(changelog).toBeVisible()
  await expect(changelog.getByText(/is up to date/)).toBeVisible()
  await expect(changelog.getByText(/Last checked/)).toBeVisible()
  await expect(changelog.getByRole('button', { name: 'Check now' })).toBeVisible()
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

test('dashboard packages download and install as editable copies', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: /Dashboard.*Build a custom report/ }).click()
  const createDialog = page.getByRole('dialog', { name: 'Create dashboard' })
  await createDialog.getByLabel('Name').fill('Portable Operations')
  await createDialog.getByRole('button', { name: /Blank dashboard/ }).click()
  await createDialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByLabel('Dashboard name')).toHaveValue('Portable Operations')

  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const shareDialog = page.getByRole('dialog', { name: 'Share dashboard' })
  await expect(shareDialog.getByText('Source rows stay out')).toBeVisible()
  await expect(shareDialog.getByText(/package will be unsigned/i)).toBeVisible()
  await shareDialog.getByLabel('Version').fill('draft')
  await expect(shareDialog.getByLabel('Version')).toHaveAttribute('aria-invalid', 'true')
  await expect(shareDialog.getByRole('button', { name: 'Save package' })).toBeDisabled()
  await shareDialog.getByLabel('Version').fill('1.2.3')
  await page.screenshot({ path: 'test-results/dashboard-package-share.png', fullPage: true })
  const packageDownload = page.waitForEvent('download')
  await shareDialog.getByRole('button', { name: 'Save package' }).click()
  const dashboardPackage = await packageDownload
  expect(dashboardPackage.suggestedFilename()).toBe('Portable-Operations-1.2.3.kpidashboard')
  const packagePath = testInfo.outputPath('Portable Operations.kpidashboard')
  await dashboardPackage.saveAs(packagePath)

  const packageBytes = await readFile(packagePath)
  expect(packageBytes.subarray(0, 2).toString()).toBe('PK')
  const packageEntries = Object.keys(unzipSync(new Uint8Array(packageBytes)))
  expect(packageEntries.sort()).toEqual(['dashboard.json', 'manifest.json'])

  await shareDialog.getByRole('button', { name: 'Cancel' }).click()
  const fileChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: /Import package/ }).click()
  await (await fileChooser).setFiles(packagePath)

  const installDialog = page.getByRole('dialog', { name: 'Add Portable Operations' })
  await expect(installDialog.getByText('v1.2.3 · Author label: Noah Garrett · General')).toBeVisible()
  await expect(installDialog.getByText(/Unsigned package/)).toBeVisible()
  await installDialog.getByRole('button', { name: 'Add dashboard' }).click()
  await expect(page.locator('.library-action-notice')).toContainText('editable copy')
  await expect(page.getByLabel('Dashboard name')).toHaveValue('Portable Operations v1.2.3')
})

test('projects created from Home stay separate from the featured OAC project', async ({ page }) => {
  await page.getByRole('button', { name: 'Home' }).click()
  await page.getByRole('button', { name: 'New project' }).click()
  const projectDialog = page.getByRole('dialog', { name: 'Create project' })
  await projectDialog.getByLabel('Name').fill('North Campus')
  await projectDialog.getByRole('button', { name: 'Create' }).click()

  await expect(page.getByRole('heading', { name: 'North Campus' })).toBeVisible()
  await expect(page.locator('.project-row').filter({ hasText: 'North Campus' })).toBeVisible()
  await expect(page.locator('.project-row').filter({ hasText: 'OAC Weekly Reporting' })).toBeVisible()

  await page.getByRole('button', { name: 'Home' }).click()
  await page.getByRole('button', { name: 'New dashboard' }).click()
  const dashboardDialog = page.getByRole('dialog', { name: 'Create dashboard' })
  await expect(dashboardDialog.getByLabel('Project')).toHaveValue('')
  await expect(dashboardDialog.getByRole('button', { name: 'Create' })).toBeDisabled()
  await dashboardDialog.getByLabel('Project').selectOption({ label: 'North Campus' })
  await dashboardDialog.getByLabel('Name').fill('North Campus Overview')
  await dashboardDialog.getByRole('button', { name: 'Create' }).click()

  await expect(page.getByLabel('Dashboard name')).toHaveValue('North Campus Overview')
  await page.getByRole('button', { name: 'Back to project' }).click()
  await expect(page.getByRole('heading', { name: 'North Campus' })).toBeVisible()
})

test('folders, projects, dashboards, spreadsheet profiling, and the visual studio work end to end', async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000)

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

  await page.getByRole('tab', { name: 'Data' }).click()
  await page.locator('input[type=file][accept*=".csv"]').setInputFiles({
    name: 'Inspection_Log.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([
      'Work Week,Discipline,Contractor,Status,Inspection Phase,Issue?,Cost,Budget',
      "WW27'2026,Electrical,Bechtel,Closed,Final,No Issue Found,1250,2500",
      "WW27'2026,Mechanical,Turner,Open,Final,BIM-104,900,1800",
      "WW28'2026,Electrical,Bechtel,Open,SOR,BIM-108,2100,3000",
      "WW28'2026,Process,Turner,Closed,Final,No Issue Found,1500,2000",
      ...["WW51'2025", "WW52'2025", ...Array.from({ length: 30 }, (_, index) =>
        `WW${String(index + 1).padStart(2, '0')}'2026`)].map((workWeek, index) =>
        `${workWeek},Electrical,Bechtel,Open,Final,BIM-${200 + index},1200,2400`),
    ].join('\n')),
  })
  await expect(page.getByText(/36 rows · 8 columns/)).toBeVisible()

  const dataSearch = page.getByPlaceholder('Find a worksheet or column')
  await dataSearch.fill('Contractor')
  await expect(page.locator('.studio-field-row').filter({ hasText: 'Contractor' })).toBeVisible()
  await expect(page.locator('.studio-field-row').filter({ hasText: 'Work Week' })).toBeHidden()
  await page.getByRole('button', { name: 'Clear data search' }).click()

  await page.getByRole('button', { name: /Review data/ }).click()
  const repairDialog = page.getByRole('dialog', { name: 'Review spreadsheet data' })
  await expect(repairDialog.getByText('Data is ready')).toBeVisible()
  await repairDialog.getByLabel('Contractor display name').fill('General Contractor')
  await repairDialog.getByLabel('Contractor display name').blur()
  await repairDialog.getByRole('button', { name: 'Mark reviewed' }).click()
  await page.screenshot({ path: 'test-results/source-repair-center.png', fullPage: true })
  await repairDialog.getByRole('button', { name: 'Close data review' }).click()
  await expect(page.locator('.studio-field-row').filter({ hasText: 'General Contractor' })).toBeVisible()

  await page.getByRole('button', { name: 'Preview rows' }).click()
  const sourcePreview = page.getByRole('dialog', { name: /Preview Sheet1/ })
  await expect(sourcePreview.getByText('Spreadsheet preview')).toBeVisible()
  await sourcePreview.getByRole('button', { name: 'Cost', exact: true }).click()
  await sourcePreview.getByRole('button', { name: 'Budget', exact: true }).click()
  await sourcePreview.getByRole('button', { name: 'Close preview' }).click()
  await expect(page.getByRole('region', { name: 'Quick chart suggestions' }))
    .toContainText('Cost as % of Budget')
  await page.locator('.quick-suggestion-list > button').filter({ hasText: 'Cost as % of Budget' }).click()
  await expect(page.locator('.studio-widget')).toHaveCount(1)
  await expect(page.locator('.studio-kpi strong')).toContainText('%')

  await page.getByRole('button', { name: 'Clear selected columns' }).click()

  const workWeekField = page.locator('.studio-field-row').filter({ hasText: 'Work Week' })
  await workWeekField.getByRole('button').first().click()
  await expect(page.getByRole('region', { name: 'Quick chart suggestions' })).toContainText('Records by Work Week')
  await page.screenshot({ path: 'test-results/quick-chart-builder.png', fullPage: true })
  await page.locator('.quick-suggestion-list > button').first().click()
  await expect(page.locator('.studio-widget')).toHaveCount(2)
  await expect(page.getByText(/Count rows from Sheet1 by Work Week/)).toBeVisible()
  await expect(page.locator('.studio-echart svg')).toBeVisible()
  await page.locator('.studio-field-row').filter({ hasText: 'Status' })
    .dragTo(page.locator('.field-role-well').filter({ hasText: 'Series / color' }))
  await expect(page.locator('.field-role-well').filter({ hasText: 'Series / color' }))
    .toContainText('Status')
  await expect(page.getByText(/split by Status/)).toBeVisible()

  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const condition = page.locator('.condition-row')
  await condition.getByLabel('Rule column').selectOption({ label: 'Status' })
  await condition.getByLabel('Rule operator').selectOption('notEquals')
  await condition.getByLabel('Rule value').fill('Void')
  await expect(page.getByText('36 included')).toBeVisible()

  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const numericCondition = page.locator('.condition-row').nth(1)
  await numericCondition.getByLabel('Rule column').selectOption({ label: 'Cost' })
  await expect(numericCondition.getByLabel('Rule operator').locator('option[value="contains"]')).toHaveCount(0)
  await numericCondition.getByLabel('Rule operator').selectOption('between')
  await numericCondition.getByLabel('Rule lower value').fill('800')
  await numericCondition.getByLabel('Rule upper value').fill('2200')
  await expect(page.getByText('36 included')).toBeVisible()

  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const reportingPeriodCondition = page.locator('.condition-row').nth(2)
  await reportingPeriodCondition.getByLabel('Rule column').selectOption({ label: 'Work Week' })
  await reportingPeriodCondition.getByLabel('Rule reporting period')
    .selectOption({ label: 'Through previous completed work week' })
  await expect(reportingPeriodCondition.getByLabel('Rule reporting period'))
    .toHaveValue('@through-previous-work-week')
  await expect(page.getByText('36 included')).toBeVisible()

  await page.getByRole('button', { name: 'Filters' }).click()
  const filterPopover = page.locator('.filter-popover')
  await filterPopover.getByLabel('Column').selectOption({ label: 'Status' })
  await filterPopover.getByRole('button', { name: 'Add filter' }).click()
  const statusSlicer = page.locator('.global-filter-chip').filter({ hasText: 'Status' })
  await statusSlicer.locator('.global-filter-trigger').click()
  await statusSlicer.locator('.slicer-value-list label').filter({ hasText: 'Open' })
    .getByRole('checkbox').check()
  await expect(page.getByText('34 included')).toBeVisible()
  await expect(statusSlicer.locator('.global-filter-trigger')).toContainText('Open')

  for (const column of ['Work Week', 'Discipline', 'General Contractor', 'Inspection Phase']) {
    await page.getByRole('button', { name: 'Filters' }).click()
    const additionalFilter = page.locator('.filter-popover')
    await additionalFilter.getByLabel('Column').selectOption({ label: column })
    await additionalFilter.getByRole('button', { name: 'Add filter' }).click()
  }
  await expect(page.locator('.global-filter-chip')).toHaveCount(5)

  await page.getByPlaceholder('Name this calculation').fill('Open issues through reporting week')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByLabel('Saved calculation', { exact: true }))
    .toContainText('Open issues through reporting week')

  await page.getByRole('tab', { name: 'Style' }).click()
  const referenceLine = page.locator('.reference-line-settings')
  await referenceLine.getByLabel('Show target or baseline').check()
  await referenceLine.getByLabel('Value').fill('10')
  await referenceLine.getByLabel('Label').fill('OAC target')
  await expect(page.locator('.studio-echart svg')).toContainText('OAC target')

  await page.getByRole('tab', { name: 'Visuals' }).click()
  await page.locator('.studio-palette .studio-visual-option').filter({ hasText: 'Table' }).click()
  await expect(page.locator('.studio-widget')).toHaveCount(3)

  await page.locator('.studio-palette .studio-visual-option').filter({ hasText: 'Line' })
    .dragTo(page.locator('.studio-canvas'))
  await expect(page.locator('.studio-widget')).toHaveCount(4)

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
  await exportDialog.getByRole('button', { name: 'Export PDF' }).click()
  const pdfPreflight = page.getByRole('dialog', { name: 'Export preflight' })
  await expect(pdfPreflight).toContainText('Page 2 is empty')
  const pdfDownload = page.waitForEvent('download')
  await pdfPreflight.getByRole('button', { name: 'Export anyway' }).click()
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
  await pptxDialog.getByRole('button', { name: 'Export PPTX' }).click()
  const pptxPreflight = page.getByRole('dialog', { name: 'Export preflight' })
  const pptxDownload = page.waitForEvent('download')
  await pptxPreflight.getByRole('button', { name: 'Export anyway' }).click()
  const pptx = await pptxDownload
  await expect(pptx.suggestedFilename()).toMatch(/Inspection Performance Final\.pptx$/)
  const pptxPath = testInfo.outputPath('Inspection Performance.pptx')
  await pptx.saveAs(pptxPath)
  const pptxBytes = await readFile(pptxPath)
  expect(pptxBytes.subarray(0, 2).toString()).toBe('PK')
  expect(pptxBytes.byteLength).toBeGreaterThan(10_000)
  const pptxEntries = Object.keys(unzipSync(new Uint8Array(pptxBytes)))
  expect(pptxEntries.some((entry) => entry.endsWith('.svg'))).toBe(true)
  expect(pptxEntries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry))).toHaveLength(4)

  await exportButton.click()
  const pngDialog = page.getByRole('dialog', { name: 'Export setup' })
  await pngDialog.getByRole('button', { name: 'PNG', exact: true }).click()
  await pngDialog.getByRole('button', { name: 'Export PNG' }).click()
  const pngPreflight = page.getByRole('dialog', { name: 'Export preflight' })
  const pngDownload = page.waitForEvent('download')
  await pngPreflight.getByRole('button', { name: 'Export anyway' }).click()
  const png = await pngDownload
  await expect(png.suggestedFilename()).toMatch(/Inspection Performance Final - PNG Pages\.zip$/)
  const pngPath = testInfo.outputPath('Inspection Performance Final - PNG Pages.zip')
  await png.saveAs(pngPath)
  const pngBytes = await readFile(pngPath)
  expect(pngBytes.subarray(0, 2).toString()).toBe('PK')
  const pngEntries = Object.keys(unzipSync(new Uint8Array(pngBytes)))
  expect(pngEntries.filter((entry) => entry.endsWith('.png'))).toHaveLength(4)

  await page.setViewportSize({ width: 1320, height: 840 })
  await expect(page.getByLabel('Dashboard name')).toBeVisible()
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)
  await expect.poll(() => page.locator('.studio-global-filters').evaluate((element) =>
    element.scrollWidth <= element.clientWidth)).toBe(true)
  const lastSlicer = page.locator('.global-filter-chip').last()
  await lastSlicer.locator('.global-filter-trigger').click()
  const popoverBounds = await lastSlicer.locator('.slicer-popover').boundingBox()
  expect(popoverBounds).not.toBeNull()
  expect(popoverBounds?.x ?? -1).toBeGreaterThanOrEqual(0)
  expect((popoverBounds?.x ?? 0) + (popoverBounds?.width ?? 0)).toBeLessThanOrEqual(1320)
  await page.keyboard.press('Escape')
  await page.screenshot({ path: 'test-results/custom-dashboard-studio-1320.png', fullPage: true })
})
