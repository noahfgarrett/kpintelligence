# QCx Intelligence Product Direction

## Purpose

QCx Intelligence is a local-first analytics workspace for construction quality reporting. A project workspace points at a locally synced SharePoint or OneDrive folder and renders a reusable dashboard template from the latest complete source exports.

## First Template

Weekly QA/QC preserves the proven BIM issue, mechanical inspection, electrical inspection, and welding signoff calculations from the portable HTML dashboard. It supports OAC cutoffs, slicers, interactive charts, detailed issue pages, and GC-safe PDF and PowerPoint exports.

## Product Principles

- Project data stays in approved local sync folders and in application memory.
- A report refresh is atomic: incomplete sources never replace the last good report.
- Desktop privileges are isolated behind platform adapters.
- Report calculations, templates, and generated files remain host-neutral.
- New dashboard templates use versioned schemas and migrations.
- Multiple project workspaces are first-class.

## Future Host

The workspace engine is designed to run in Tauri today and inside Noah Garrett's Electron PDF application later. An Electron integration should implement the same platform bridge for folder selection, watching, persistence, updates, and save dialogs without changing report calculations or template components.

## Roadmap

1. Workspace foundation and Weekly QA/QC desktop template.
2. User-configurable source mappings, chart layouts, and calculated metrics.
3. Shareable dashboard packages with schema validation and redaction controls.
4. Electron host adapter for the all-in-one PDF application.
