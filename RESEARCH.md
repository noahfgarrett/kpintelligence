# Product Research: What KPIntelligence Must Improve

Research reviewed July 25, 2026.

## Data Preparation

Smartsheet chart widgets begin with a selected range from one sheet or report. When data is not already chart-shaped, users commonly create reports, helper columns, or summary sheets first.

KPIntelligence response:

- Bind to named fields rather than absolute ranges.
- Filter, group, and aggregate inside the dashboard definition.
- Show a live matched-row preview before accepting a visual.

Sources:

- https://help.smartsheet.com/learning-track/level-1-foundations/charts-dashboards
- https://help.smartsheet.com/articles/2483390-using-helper-columns-smartsheet
- https://community.smartsheet.com/discussion/87964/help-with-creating-a-smartsheet-dashboard

## Source And Formula Constraints

Smartsheet chart widgets use one sheet or report. Formulas cannot be authored in reports, and some cross-sheet functions are unsupported. This pushes dashboard logic back into source sheets.

KPIntelligence response:

- Allow multiple independent datasets in one dashboard.
- Create reusable semantic field mappings across sources.
- Keep logic in an inspectable, typed dashboard rule rather than modifying source data.

Sources:

- https://help.smartsheet.com/articles/2482266-using-chart-widgets
- https://community.smartsheet.com/discussion/55976/formulas-in-reports-reference-reports-for-dashboard
- https://help.smartsheet.com/articles/2476176-formula-error-messages

## Dashboard Interaction

Dashboard-level filtering and slicer behavior has historically been limited, while published dashboards refresh on a fixed cadence. Users have repeatedly requested dashboard filters.

KPIntelligence response:

- First-class global filters with explicit page and widget scope.
- Immediate local filtering and source freshness indicators.
- One-click conversion of a field into a dashboard filter.

Sources:

- https://community.smartsheet.com/discussion/75396/dashboard-filters
- https://help.smartsheet.com/articles/522078-publishing-smartsheet-items

## Visualization Ceiling

Smartsheet documents ten core chart forms, and its report-backed chart behavior may select the entire report. Users still request mixed charts, secondary axes, and more flexible series handling.

KPIntelligence response:

- A broad renderer registry with combo, dual-axis, reference-line, distribution, hierarchy, and relationship visuals.
- Safe chart defaults with full title, axis, label, legend, and color customization.
- Chart-type switching without rebuilding the underlying query.

Sources:

- https://help.smartsheet.com/articles/518558-widget-types-for-smartsheet-dashboards
- https://help.smartsheet.com/articles/2482266-using-chart-widgets

## Scale And Trust

Smartsheet sheets are limited to 20,000 rows, 400 columns, and 500,000 cells, with several connectors unsupported beyond 5,000 rows or 200 columns. Formula and type errors can also obscure why a result is empty.

KPIntelligence response:

- Profile source size and types before authoring.
- Surface warnings, excluded-row counts, and source lineage.
- Run bounded local queries without writing preparation data back into the source.

Sources:

- https://help.smartsheet.com/articles/506775-system-requirements-for-using-smartsheet
- https://help.smartsheet.com/articles/2476176-formula-error-messages

## New AI Dashboard Features

Smartsheet announced AI-generated dashboards in May 2026, with up to five source sheets and ten generated widgets. The announcement notes that existing charts produced through the earlier Analyze Data tool were not yet editable.

KPIntelligence response:

- AI assistance may propose a transparent query, but never owns opaque logic.
- Every generated result is fully editable through the same sentence controls.
- Deterministic click-to-build remains the primary workflow.

Source:

- https://community.smartsheet.com/en/discussion/146723/turn-your-data-into-a-tailored-dashboard-instantly-with-the-help-of-ai
