# QCx Intelligence

Local-first construction quality reporting for Windows and macOS. Created by Noah Garrett.

QCx Intelligence saves project workspaces, monitors locally synced SharePoint or OneDrive folders, and turns weekly Smartsheet exports into interactive dashboards, PDF reports, and editable PowerPoint decks. The first built-in template is Weekly QA/QC.

## Data Model

- Workspace metadata and slicer settings are stored in the app data directory.
- Source folder permission is restored by Tauri's persisted filesystem scope.
- Spreadsheet rows are read into memory and are not copied into an application database.
- A failed or partial folder refresh leaves the last good report visible.

## Development

Requirements: Node.js 24+, Rust stable, and the platform prerequisites for Tauri 2.

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run tauri:dev
```

The Vite preview runs on `http://127.0.0.1:5274`. Browser mode supports manual imports and layout preview; persistent folder monitoring and native saves require the Tauri app.

## Build

```bash
npm run build:web
npm run tauri:build
```

Updater bundles require the signing key stored outside this repository:

```bash
TAURI_SIGNING_PRIVATE_KEY="$(< "$HOME/.tauri/qcx-intelligence.key")" npm run tauri:build
```

## Releases

Source is intended for the private `noahfgarrett/qcx-intelligence` repository. Installers, signatures, and `latest.json` publish to the public `noahfgarrett/qcx-intelligence-releases` repository.

The release workflow expects these source-repository secrets:

- `RELEASE_REPO_TOKEN`: fine-grained token with Contents write access to the release repository.
- `TAURI_SIGNING_PRIVATE_KEY`: updater private key.

Production distribution should add Apple notarization and Windows code-signing credentials before broad rollout.
