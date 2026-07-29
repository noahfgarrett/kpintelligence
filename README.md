# KPIntelligence

Local-first spreadsheet intelligence for Windows and macOS. Created by Noah Garrett.

KPIntelligence turns spreadsheets in locally synced SharePoint or OneDrive folders into interactive dashboards, PDF reports, and presentation-ready PowerPoint decks. It is designed around click-to-build data sentences instead of formulas or a separate measures language.

The production OAC Weekly QA/QC dashboard is the first featured template and remains available alongside user-created dashboards.

Version 0.3.2 prompts for signed desktop updates whenever a newer release is found at app launch and adds a clickable version control for manual checks. Version 0.3.1 made the workspace project-first: projects can be created directly from Home, dashboard creation requires an explicit project when context is ambiguous, and the Microsoft 365 connection center links a saved Teams or SharePoint shortcut to the local synced folder KPIntelligence watches. Version 0.3.0 introduced guided spreadsheet intake and repair, quick chart suggestions, direct field roles, calculation recipes, multi-select slicers, cross-filtering, portable dashboard packages, Team Libraries, and configurable exports.

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
- Optional SharePoint or Teams web shortcuts are stored locally and can only open approved Microsoft 365 HTTPS locations.
- Spreadsheet rows are read into memory and are not copied into an application database.
- Dashboard definitions persist separately from source data.
- Incomplete syncs never replace the last valid source snapshot.
- Portable `.kpidashboard` packages exclude spreadsheet rows, credentials, and absolute source paths.
- Team Libraries scan user-approved local sync folders and install dashboards as independent local copies.

## Development

Requirements: Node.js 24+, Rust stable, and the platform prerequisites for Tauri 2.

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run tauri:dev
```

The Vite preview runs on `http://127.0.0.1:5274`. Browser mode supports layout and manual-file testing. Persistent folder monitoring, native saves, Team Library folders, and signed updates require the desktop app.

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

The Tauri bundle identifier remains stable during the rename so current installations receive KPIntelligence as an update. Releases are assembled as drafts, verified across macOS and Windows, checksummed, and published only after the complete updater feed is ready.
