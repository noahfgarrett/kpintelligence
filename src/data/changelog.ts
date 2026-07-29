export interface ChangelogEntry {
  version: string
  date: string
  type: 'feature' | 'fix' | 'major'
  notes: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.3.1',
    date: '2026-07-29T13:01:02Z',
    type: 'fix',
    notes: [
      'Made New project a primary action on Home and added a dedicated project shortcut to the library sidebar',
      'Stopped global dashboard creation from silently defaulting to OAC Weekly Reporting when more than one project is available',
      'Added a project-first setup flow that can connect Microsoft 365 data immediately after the project is created',
      'Added a Teams and SharePoint connection center with recent synced locations, native folder picking, and saved web shortcuts',
      'Added restricted external-link permissions so only HTTPS SharePoint and Microsoft Teams locations can be opened from the app',
      'Improved project data status, connection controls, source refresh behavior, and regression coverage for multi-project workflows',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-07-28T02:30:00Z',
    type: 'major',
    notes: [
      'Added an Intake and Repair Center for reviewing worksheet health, correcting column names and types, and preserving those repairs when synced folders move',
      'Added spreadsheet previews, field sampling, quick chart suggestions, and direct drag-or-click role assignment for category, value, series, secondary axis, and table columns',
      'Added multi-select include and exclude slicers with dashboard or page scope, searchable values, one-click reset, and interactive chart cross-filtering',
      'Added reusable calculation recipes for row rules, split metrics, ratios, differences, running totals, percent of total, formats, and relative work-week logic',
      'Added portable .kpidashboard packages and Team Libraries so dashboards can be shared without spreadsheet rows, credentials, or absolute source paths',
      'Added semantic source matching and rebinding for visuals, calculations, and slicers when spreadsheet files, folders, worksheets, or field identifiers change',
      'Added export preflight with navigable blockers, data-quality warnings, frozen slicer state, table pagination, and high-fidelity PDF, PowerPoint, and PNG output',
      'Added local library backup and restore, stricter document validation, package integrity checks, and safer migration behavior across application updates',
      'Improved studio accessibility, source-switching safety, compact chart labels, responsive slicer layouts, modal keyboard behavior, and empty-state guidance',
      'Rebuilt the cross-platform release pipeline to verify, assemble, checksum, and publish updater assets atomically only after every platform succeeds',
    ],
  },
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
