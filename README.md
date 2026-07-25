# KPIntelligence

Local-first spreadsheet intelligence for Windows and macOS. Created by Noah Garrett.

KPIntelligence turns spreadsheets in locally synced SharePoint or OneDrive folders into interactive dashboards, PDF reports, and presentation-ready PowerPoint decks. It is designed around click-to-build data sentences instead of formulas or a separate measures language.

The production OAC Weekly QA/QC dashboard is the first featured template and remains available alongside user-created dashboards.

The general dashboard studio is labeled **beta** in v0.2.0. It already supports local spreadsheet profiling, click-to-build calculations, global filters, 18 visual types, drag-and-resize pages, row drill-through, and configurable exports. Guarded joins, reusable calculated fields, richer prior-period comparisons, and native editable PowerPoint text and table objects remain roadmap work.

## Product Model

```text
Library
  -> nested folders
    -> projects
      -> connected source folders
      -> featured or custom dashboards
        -> pages
          -> draggable and resizable widgets
```

Custom visuals use a visible query sentence such as:

```text
Count ID from Electrical Inspection Log
grouped by Work Week Observed
where Inspection Phase is Final
```

Every custom visual keeps its source and rule sentence visible, reports matched-row counts, and can reveal contributing rows.

## Local-First Data

- Absolute SharePoint and OneDrive paths stay only in app data under the user's local operating-system profile.
- Spreadsheet rows are read into memory and are not copied into an application database.
- Dashboard definitions persist separately from source data.
- Incomplete syncs never replace the last valid source snapshot.
- Future portable workspace packages must exclude absolute paths and raw source rows.

## Development

Requirements: Node.js 24+, Rust stable, and the platform prerequisites for Tauri 2.

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run tauri:dev
```

The Vite preview runs on `http://127.0.0.1:5274`. Browser mode supports layout and manual-file testing. Persistent folder monitoring, native saves, and signed updates require the desktop app.

## Build

```bash
npm run build:web
npm run tauri:build
```

Updater bundles use the existing signing identity so QCx Intelligence installations can migrate in place:

```bash
TAURI_SIGNING_PRIVATE_KEY="$(< "$HOME/.tauri/kpintelligence.key")" npm run tauri:build
```

## Releases

Private source: `noahfgarrett/kpintelligence`

Public installers and update metadata: `noahfgarrett/kpintelligence-releases`

Required source-repository secrets:

- `RELEASE_REPO_TOKEN`: token with Contents write access to the release repository.
- `TAURI_SIGNING_PRIVATE_KEY`: updater private key.

The Tauri bundle identifier remains stable during the rename so current installations receive KPIntelligence as an update.
