# KPIntelligence Product Direction

## Purpose

KPIntelligence is a local-first spreadsheet-to-dashboard studio. It gives people the visual freedom of a modern BI tool without requiring formulas, DAX, helper sheets, or hidden measures.

The primary interaction is a readable data sentence:

> Show **Count of ID** from **Electrical Inspection Log**, grouped by **Work Week Observed**, where **Inspection Phase is Final**.

Every token is clickable, every result previews immediately, and every number can reveal its contributing rows.

## Library

The application library supports:

- Nested folders for organizational structure.
- Projects that own source-folder connections and semantic field mappings.
- Multiple dashboards per project.
- Featured templates, custom dashboards, and duplicated templates.
- Search, rename, move, duplicate, favorite, archive, and recent-item workflows.

The OAC Weekly QA/QC report is a featured production template, not a special application mode.

## Dashboard Studio

The custom studio is a beta foundation in v0.2.0. It currently provides:

- Spreadsheet and worksheet catalog with inferred field types and sample values.
- Click-to-add and drag-to-add visual workflows.
- Sentence-shaped filters, grouping, aggregation, running totals, and percent-of-total transforms.
- KPI, table, bar, stacked bar, line, area, combo, donut, scatter, radar, gauge, funnel, heatmap, treemap, and progress visuals.
- A 12-column drag-and-resize canvas with alignment, duplication, locking, undo, and autosave.
- Single-value global filters matched across datasets by column name.
- Multi-page desktop layouts with export-safe page rendering.
- Readable calculation sentences, matched-row preview, source freshness, row drill-through, and semantic source rebinding after file moves or renames.

Guarded joins, reusable calculated fields, date bucketing, prior-period comparisons, explicit filter scope, and full parity with the hand-tuned OAC template remain roadmap work.

## Export

Export is modeled with the dashboard rather than added afterward. Named export profiles control:

- PDF, PowerPoint, or PNG page packages.
- Page size and orientation.
- Header, footer, and safe-zone margins.
- Table pagination and repeated headers.
- High-resolution rendering quality.

PowerPoint exports currently preserve charts as scalable SVG overlays on high-resolution page backgrounds. Fully editable native PowerPoint text, tables, and shapes remain roadmap work.

## Product Principles

- Project data stays in approved local sync folders and application memory.
- Source refresh is atomic and retains the last good snapshot.
- The source sheet never needs helper columns solely for a dashboard.
- No result is accepted if its logic cannot be explained in one click.
- Global filters disclose which widgets they affect.
- Column changes produce repair suggestions, never silent reinterpretation.
- Dragging or updating the application never unexpectedly reflows a saved layout.
- Desktop privileges remain isolated behind a host-neutral platform bridge.
- Schemas, migrations, templates, and export profiles are explicitly versioned.

## Success Criteria

- A new user creates a useful chart from a real spreadsheet in under 90 seconds.
- A non-developer can recreate the OAC dashboard without writing code or formulas.
- Every displayed value reconciles to a visible set of source rows.
- A saved dashboard opens with the same layout after application updates.
- PDF and PowerPoint output preserve the authored hierarchy and labels.

## Roadmap

1. KPIntelligence identity, library hierarchy, and OAC featured template.
2. Generic spreadsheet profiler, safe rule engine, and custom dashboard studio.
3. Semantic mappings, reusable rules, presentation layouts, and export profiles.
4. Guarded joins, calculated fields, organization templates, and scheduled distribution.
5. Electron host adapter for Noah Garrett's all-in-one PDF application.
