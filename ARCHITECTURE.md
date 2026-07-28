# KPIntelligence Architecture

## Layers

```text
Library shell
  -> project and dashboard documents
    -> dashboard studio / featured templates
      -> typed query engine and renderer registry
        -> source catalog and snapshot cache
          -> PlatformBridge
            -> Tauri adapter
            -> Browser adapter
            -> Electron adapter (future)
```

## Persistence Boundaries

Three persistence concerns stay separate:

1. **Library document:** folders, projects, dashboard definitions, themes, layouts, and export profiles.
2. **Private host state:** absolute source paths, recent locations, local permissions, source repairs, and library backups. This remains in the application data under the local operating-system user profile.
3. **Disposable runtime cache:** source snapshots, inferred schemas, query results, and diagnostics.

Raw spreadsheet rows are never written into the library document. Portable `.kpidashboard` packages contain dashboard definitions, export settings, semantic source requirements, and integrity metadata while excluding absolute paths, credentials, and source rows. Team Libraries scan only user-approved local folders and install packages as independent dashboard copies.

## Library Hierarchy

Folders can nest recursively. Projects belong to folders and own source connections. Dashboards belong to projects. The current dashboard kinds are:

- `oacWeekly`: the featured production OAC Weekly QA/QC dashboard.
- `custom`: a user-authored beta studio dashboard document.

Stable IDs survive renames and moves.

## Query Safety

Visual logic compiles to a typed abstract syntax tree. It never evaluates JavaScript or arbitrary formulas.

```text
sentence controls
  -> typed predicate and aggregation AST
    -> validation and field resolution
      -> bounded query plan
        -> result rows, groups, values, and diagnostics
```

Operators are type-aware. Ambiguous multi-row lookups require an explicit first, last, list, count, aggregate, or error policy. Every execution reports matched and excluded rows.

Reusable calculation recipes persist typed aggregation and predicate configuration rather than executable code. Runtime slicers compile to the same predicate model, and preview cross-filters are transient page-scoped conditions. Export captures a frozen dashboard snapshot so an in-progress interaction cannot change a report halfway through rendering.

## Source Refresh

1. Recursively catalog supported ZIP, XLS, XLSX, and CSV files.
2. Ignore hidden, lock, temporary, and partial-sync artifacts.
3. Require stable file fingerprints before reading.
4. Resolve each logical source binding independently.
5. Parse typed values and infer fields with confidence and samples.
6. Apply user-approved semantic field repairs and rebind saved field roles by stable identity, key, header, and source position.
7. Publish a new consistency-group snapshot only after every required source succeeds.
8. Keep the previous snapshot on any error.

The OAC template uses a four-source consistency group. Custom dashboards may use one or more independent sources.

## Rendering

KPIntelligence owns a safe visual schema and translates it through a renderer registry:

- Apache ECharts renders analytical charts using SVG by default.
- React renderers own KPI, table, text, image, and filter widgets.
- React Grid Layout owns collision-aware drag, resize, and serialized positions.

Raw ECharts options are never persisted. Screen and export paths consume one resolved page model to reduce visual drift. Export preflight resolves every dataset and field, executes each query, checks non-finite results and coercion diagnostics, and computes paginated output before capture begins.

## Platform Boundary

`src/platform/types.ts` defines folder selection, recursive file reads, watching, persistence, native save dialogs, and signed update installation. Templates and query code cannot import Tauri APIs.

The Tauri identifier and updater key stay stable through the QCx-to-KPIntelligence transition. A future Electron adapter implements the same capabilities through IPC.

## Migrations

Library documents are validated before use. A migration writes the previous valid document to a rollback key before replacing it, while malformed or future-schema documents are left untouched and surface a compatibility error. The legacy QCx workspace migrator creates:

- A root project using the saved name and source-folder binding.
- An OAC Weekly QA/QC dashboard instance.
- Preserved report filters and timestamps.
