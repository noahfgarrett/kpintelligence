# KPIntelligence Design System

Design system for the app and the exported PPTX/PDF deck. The data-viz series
colors are the exact hex values validated by the dataviz skill's
`validate_palette.js` and must not be shifted without re-validating.

> **Color format constraint:** all colors are authored in **hex / rgb, never
> `oklch()`.** The PDF export renders the live slide DOM through
> html2canvas 1.4.1, which cannot parse `oklch()` (it fails to black). We still
> follow the impeccable principle — neutrals are tinted toward the slate-blue
> brand hue rather than pure gray, and we avoid pure `#000` — but express it in
> hex so the export path stays intact.

## Color strategy

**Restrained** — tinted neutrals + one accent used only for primary actions,
current selection, and the main data series. Neutrals carry a faint slate-blue
tint rather than being pure gray.

### Brand accent (slate-blue)

| Role | Value |
|---|---|
| accent | `#2E5AAC` |
| accent-strong (hover/press) | `#244A93` |
| accent-soft (tint bg) | `#EAF0FA` |
| accent-ring (focus) | `rgba(46, 90, 172, 0.32)` |

### Neutrals (light, slate-tinted)

| Role | Value |
|---|---|
| page plane | `#EDF1F6` |
| card surface | `#FDFEFF` |
| panel (sidebar / this-week cluster, 2nd neutral) | `#F2F5F9` |
| border (hairline) | `#DCE3EC` |
| hairline (faint divider) | `#EBEEF3` |
| text primary (ink) | `#1B2530` |
| text secondary | `#45505F` |
| text muted (labels/axis) | `#6A7583` |
| text faint | `#9AA4B2` |

### Status (reserved — always paired with icon + label, never color alone)

| Role | Value |
|---|---|
| good | `#0CA30C` (text form `#0A7A0A`) |
| warn | `#B45309` |
| critical / alert | `#D03B3B` |

### Data-viz series (validated — do not shift)

| Series | Hex | Notes |
|---|---|---|
| Opened | `#EC6152` | warm coral-red; CVD ΔE 13.7 vs Closed |
| Closed | `#0D6331` | deep green |
| Remaining Open | `#C2870B` | amber line |
| Primary / brand series | `#2E5AAC` | slate-blue |
| Aging ramp (fresh→old, ordinal) | `#86B6EF · #3987E5 · #256ABF · #184F95` | one-hue blue |

Fixed semantics everywhere: Opened=coral-red, Closed=green, Remaining=amber,
issues-found markers=alert-red. Never repaint on filter.

## Typography

- Family: Inter, then `system-ui, -apple-system, "Segoe UI", sans-serif`. One family.
- Fixed rem scale (not fluid). Ratio ~1.2 between steps.
- Lead KPI value ≥ 40px semibold, **proportional** figures. Supporting KPI values
  ~24-28px proportional. `tabular-nums` ONLY in table columns and axis ticks.
- Section titles 15px semibold; labels 11px uppercase, tracked, muted; body 13-14px.

## Spacing & radius

4px base grid. Card padding 20-24px, gutters 16-20px. Radius: cards 12-14,
controls/pills 8-10, chips 6. Vary spacing for rhythm; avoid uniform padding.

## Elevation

Two restrained tiers, no heavy blur:
- e1 `0 1px 2px rgba(27, 37, 48, 0.06)`
- e2 `0 4px 14px rgba(27, 37, 48, 0.08)`

## Charts

- Secondary axes are reserved for unlike measures such as backlog versus weekly
  issue counts or sign-off percentage versus weld counts. They must be labeled
  and share a clear visual hierarchy.
- Marks: bars ≤24px thick, 4px rounded data-end square at baseline; lines 2px;
  markers ≥8px (r≥4) with 2px surface ring; area fill ~10% opacity; gridlines solid
  1px hairline (never dashed), horizontal only, recessive.
- Legend present for ≥2 series; direct-label selectively (endpoint/extreme only).
- Text uses ink tokens, never the series color.

## Component states

Every interactive control ships default / hover / focus / active / disabled. Motion
150-250ms, ease-out, conveys state only. Skeleton (dimmed prior render) on refetch,
not spinners.

## Absolute bans (enforced)

No side-stripe accent borders, no gradient text, no default glassmorphism, no
hero-metric-template cliché, no identical card grids, no em dashes in copy,
no reinvented standard controls.
