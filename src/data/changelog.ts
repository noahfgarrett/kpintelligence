export interface ChangelogEntry {
  version: string
  date: string
  type: 'feature' | 'fix' | 'major'
  notes: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.2.0',
    date: '2026-07-25T20:45:00Z',
    type: 'major',
    notes: [
      'Renamed the product to KPIntelligence and established it as a general spreadsheet-to-dashboard workspace',
      'Promoted the OAC Weekly QA/QC report to a featured dashboard template within an extensible template registry',
      'Added nested folders, projects, favorites, recent dashboards, rename, duplicate, delete, and drag-to-organize library workflows',
      'Added a drag-and-resize dashboard studio with 18 visual types, multi-page layouts, undo and redo, locking, and live data labels',
      'Added safe plain-language calculations, arbitrary XLS/XLSX/CSV/ZIP profiling, field inference, row rules, and matched-row diagnostics',
      'Added reusable PDF, PowerPoint, and PNG export profiles with page sizing, margins, presentation headers, and high-resolution rendering',
      'Added semantic source rebinding, stale-refresh protection, bounded folder and workbook loading, and visible source failures',
      'Improved keyboard focus, minimum-width layout behavior, chart drill-through, and small-label legibility throughout the studio',
      'Preserved the existing desktop identity, local workspace migration, signed updates, and OAC report behavior through the transition',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-07-16T12:00:00Z',
    type: 'major',
    notes: [
      'Introduced the desktop workspace foundation for local-first project reporting',
      'Added multiple saved project workspaces with the Weekly QA/QC report as the first built-in template',
      'Added recursive SharePoint and OneDrive synced-folder monitoring with stable-file checks and last-good-report retention',
      'Added native PDF and PowerPoint save dialogs plus signed in-place desktop updates',
      'Separated the reporting engine from Tauri services so future tools can reuse it inside an Electron host',
    ],
  },
]
