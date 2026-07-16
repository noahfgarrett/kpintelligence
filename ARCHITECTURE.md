# Architecture

## Layers

```text
Workspace UI
  -> versioned dashboard templates
    -> report calculations and source normalization
      -> PlatformBridge
        -> Tauri adapter (current desktop host)
        -> Browser adapter (development and portable preview)
        -> Electron adapter (future PDF application host)
```

## Platform Boundary

`src/platform/types.ts` is the host contract. Templates must not import Tauri APIs directly. The bridge owns:

- folder selection and recursive file discovery
- filesystem watching and byte reads
- workspace-state persistence
- native save dialogs
- signed update checks, installation, and relaunch

The Tauri implementation lives in `src/platform/tauri.ts`. A future Electron host can provide the same interface with IPC-backed methods.

## Workspace State

`WorkspaceRecord` is schema-versioned. Version 1 stores the workspace identity, template identity/version, source folder path, slicers, and timestamps. Raw spreadsheet rows and generated reports are intentionally excluded.

## Source Refresh

1. Scan recursively for ZIP, XLS, XLSX, and CSV files.
2. Ignore hidden files, lock files, and partial sync artifacts.
3. Require two identical scans before reading.
4. Prefer the newest ZIP that resolves all four required report roles.
5. Otherwise choose the newest valid direct file for each role.
6. Publish the snapshot only after the complete import succeeds.
7. Keep the previous snapshot on any error.

## Template Ownership

Weekly QA/QC currently uses shared modules in `src/calculations`, `src/services/fileImport.ts`, and `src/export`. As more templates are added, these modules should move under a template package with a small registry. The platform bridge and workspace repository should remain unchanged.
