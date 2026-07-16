export interface ChangelogEntry {
  version: string
  date: string
  type: 'feature' | 'fix' | 'major'
  notes: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.1.0',
    date: '2026-07-16T12:00:00Z',
    type: 'major',
    notes: [
      'Introduced QCx Intelligence as a Windows and macOS desktop workspace for local-first project reporting',
      'Added multiple saved project workspaces with the Weekly QA/QC report as the first built-in template',
      'Added recursive SharePoint and OneDrive synced-folder monitoring with stable-file checks and last-good-report retention',
      'Added native PDF and PowerPoint save dialogs plus signed in-place desktop updates',
      'Separated the reporting engine from Tauri services so future tools can reuse it inside an Electron host',
    ],
  },
]
