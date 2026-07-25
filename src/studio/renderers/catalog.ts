export type StudioVisualType =
  | 'kpi'
  | 'table'
  | 'bar'
  | 'column'
  | 'stackedBar'
  | 'line'
  | 'area'
  | 'combo'
  | 'donut'
  | 'pie'
  | 'scatter'
  | 'radar'
  | 'gauge'
  | 'funnel'
  | 'heatmap'
  | 'treemap'
  | 'progress'
  | 'text'

export interface VisualCatalogItem {
  type: StudioVisualType
  name: string
  description: string
  family: 'Essentials' | 'Comparison' | 'Composition' | 'Relationship' | 'Specialized'
  minimumSize: { w: number; h: number }
  accepts: {
    dimensions: number
    measures: number
  }
}

export const VISUAL_CATALOG: VisualCatalogItem[] = [
  { type: 'kpi', name: 'Metric', description: 'One value with optional comparison', family: 'Essentials', minimumSize: { w: 2, h: 2 }, accepts: { dimensions: 0, measures: 1 } },
  { type: 'table', name: 'Table', description: 'Detailed rows and selected columns', family: 'Essentials', minimumSize: { w: 4, h: 3 }, accepts: { dimensions: 1, measures: 1 } },
  { type: 'column', name: 'Column', description: 'Compare categories vertically', family: 'Comparison', minimumSize: { w: 4, h: 3 }, accepts: { dimensions: 1, measures: 2 } },
  { type: 'bar', name: 'Bar', description: 'Compare categories with long labels', family: 'Comparison', minimumSize: { w: 4, h: 3 }, accepts: { dimensions: 1, measures: 2 } },
  { type: 'stackedBar', name: 'Stacked bar', description: 'Compare totals and composition', family: 'Comparison', minimumSize: { w: 5, h: 3 }, accepts: { dimensions: 2, measures: 1 } },
  { type: 'line', name: 'Line', description: 'Show movement over time', family: 'Comparison', minimumSize: { w: 4, h: 3 }, accepts: { dimensions: 1, measures: 2 } },
  { type: 'area', name: 'Area', description: 'Emphasize volume over time', family: 'Comparison', minimumSize: { w: 4, h: 3 }, accepts: { dimensions: 1, measures: 2 } },
  { type: 'combo', name: 'Combo', description: 'Bars and a secondary-axis line', family: 'Comparison', minimumSize: { w: 6, h: 4 }, accepts: { dimensions: 1, measures: 2 } },
  { type: 'donut', name: 'Donut', description: 'Part-to-whole with a center total', family: 'Composition', minimumSize: { w: 3, h: 3 }, accepts: { dimensions: 1, measures: 1 } },
  { type: 'pie', name: 'Pie', description: 'Simple part-to-whole comparison', family: 'Composition', minimumSize: { w: 3, h: 3 }, accepts: { dimensions: 1, measures: 1 } },
  { type: 'treemap', name: 'Treemap', description: 'Nested composition and magnitude', family: 'Composition', minimumSize: { w: 4, h: 3 }, accepts: { dimensions: 1, measures: 1 } },
  { type: 'scatter', name: 'Scatter', description: 'Relationship between two measures', family: 'Relationship', minimumSize: { w: 4, h: 3 }, accepts: { dimensions: 1, measures: 2 } },
  { type: 'heatmap', name: 'Heatmap', description: 'Intensity across two dimensions', family: 'Relationship', minimumSize: { w: 4, h: 3 }, accepts: { dimensions: 2, measures: 1 } },
  { type: 'radar', name: 'Radar', description: 'Compare a compact multimetric profile', family: 'Specialized', minimumSize: { w: 4, h: 3 }, accepts: { dimensions: 1, measures: 2 } },
  { type: 'gauge', name: 'Gauge', description: 'Progress toward a bounded target', family: 'Specialized', minimumSize: { w: 3, h: 3 }, accepts: { dimensions: 0, measures: 1 } },
  { type: 'funnel', name: 'Funnel', description: 'Stage-by-stage conversion', family: 'Specialized', minimumSize: { w: 4, h: 3 }, accepts: { dimensions: 1, measures: 1 } },
  { type: 'progress', name: 'Progress', description: 'Actual value against a target', family: 'Specialized', minimumSize: { w: 3, h: 2 }, accepts: { dimensions: 0, measures: 1 } },
  { type: 'text', name: 'Text', description: 'Headings, notes, and report context', family: 'Essentials', minimumSize: { w: 2, h: 1 }, accepts: { dimensions: 0, measures: 0 } },
]

export function visualCatalogItem(type: StudioVisualType): VisualCatalogItem {
  return VISUAL_CATALOG.find((item) => item.type === type) ?? VISUAL_CATALOG[0]
}
