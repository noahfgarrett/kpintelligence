import type { DatasetProfile, FieldProfile } from '../data'
import type {
  StudioWidgetAppearance,
  StudioWidgetQuery,
} from '../library/model'
import type { StudioVisualType } from '../renderers/catalog'

export interface QuickChartSuggestion {
  id: string
  visualType: StudioVisualType
  title: string
  reason: string
  query: Partial<StudioWidgetQuery>
  appearance: Partial<StudioWidgetAppearance>
}

function isTemporal(field: FieldProfile): boolean {
  return ['date', 'datetime', 'workWeek'].includes(field.inferredType)
}

function isNumeric(field: FieldProfile): boolean {
  return field.inferredType === 'number'
}

function isIdentity(field: FieldProfile): boolean {
  return /(^|[\s_-])(id|no|number|reference|ticket|issue)([\s_-]|$)/i.test(field.name)
}

function prefersHorizontal(field: FieldProfile): boolean {
  const samples = field.sampleValues.map((sample) => sample.display)
  return field.distinctCount > 10 || samples.some((value) => value.length > 18)
}

function measureLabel(field: FieldProfile): string {
  return field.name
}

function countTitle(field?: FieldProfile): string {
  if (!field) return 'Record Count'
  if (isIdentity(field)) {
    return field.name.toLowerCase().includes('issue') ? 'Total Issues' : `Total ${field.name}`
  }
  return `Records by ${field.name}`
}

function commonQuery(dataset: DatasetProfile): Pick<StudioWidgetQuery, 'datasetId' | 'limit'> {
  return {
    datasetId: dataset.id,
    limit: 50,
  }
}

function suggestion(
  id: string,
  visualType: StudioVisualType,
  title: string,
  reason: string,
  query: Partial<StudioWidgetQuery>,
  appearance: Partial<StudioWidgetAppearance> = {},
): QuickChartSuggestion {
  return { id, visualType, title, reason, query, appearance }
}

function tableSuggestion(
  dataset: DatasetProfile,
  fields: FieldProfile[],
): QuickChartSuggestion {
  return suggestion(
    'detail-table',
    'table',
    `${dataset.name} Details`,
    'Keep the selected columns together as a sortable detail view.',
    {
      ...commonQuery(dataset),
      aggregation: 'countRows',
      tableFieldIds: fields.map((field) => field.id),
    },
  )
}

export function suggestQuickCharts(
  dataset: DatasetProfile,
  selectedFieldIds: readonly string[],
): QuickChartSuggestion[] {
  const selected = selectedFieldIds
    .map((fieldId) => dataset.fields.find((field) => field.id === fieldId))
    .filter((field): field is FieldProfile => Boolean(field))
  if (selected.length === 0) return []

  const temporal = selected.filter(isTemporal)
  const numeric = selected.filter(isNumeric)
  const categorical = selected.filter((field) => !isTemporal(field) && !isNumeric(field))
  const suggestions: QuickChartSuggestion[] = []
  const base = commonQuery(dataset)

  if (temporal[0] && numeric.length >= 2) {
    const time = temporal[0]
    const primary = numeric[0]
    const secondary = numeric[1]
    suggestions.push(suggestion(
      'time-combo',
      'combo',
      `${measureLabel(primary)} and ${measureLabel(secondary)} by ${time.name}`,
      'Compare two measures over time with the second measure on its own axis.',
      {
        ...base,
        aggregation: 'sum',
        measureFieldId: primary.id,
        secondaryAggregation: 'sum',
        secondaryMeasureFieldId: secondary.id,
        groupByFieldId: time.id,
        sort: 'categoryAscending',
      },
      {
        xAxisTitle: time.name,
        yAxisTitle: primary.name,
        showDataLabels: true,
        showLegend: true,
        smooth: true,
      },
    ))
  }

  if (temporal[0] && categorical[0] && numeric[0]) {
    const time = temporal[0]
    const category = categorical[0]
    const measure = numeric[0]
    suggestions.push(suggestion(
      'time-stacked-measure',
      'stackedBar',
      `${measureLabel(measure)} by ${time.name} and ${category.name}`,
      'Show the weekly or monthly total and how each category contributes.',
      {
        ...base,
        aggregation: 'sum',
        measureFieldId: measure.id,
        groupByFieldId: time.id,
        seriesFieldId: category.id,
        sort: 'categoryAscending',
      },
      {
        xAxisTitle: time.name,
        yAxisTitle: measure.name,
        showDataLabels: true,
        showLegend: true,
        stacked: true,
      },
    ))
  }

  if (temporal[0] && numeric[0]) {
    const time = temporal[0]
    const measure = numeric[0]
    suggestions.push(
      suggestion(
        'time-line',
        'line',
        `${measureLabel(measure)} by ${time.name}`,
        'Best for seeing movement and direction over time.',
        {
          ...base,
          aggregation: 'sum',
          measureFieldId: measure.id,
          groupByFieldId: time.id,
          sort: 'categoryAscending',
        },
        {
          xAxisTitle: time.name,
          yAxisTitle: measure.name,
          showDataLabels: true,
          smooth: true,
        },
      ),
      suggestion(
        'time-column',
        'column',
        `${measureLabel(measure)} by ${time.name}`,
        'Compare each reporting period as a distinct total.',
        {
          ...base,
          aggregation: 'sum',
          measureFieldId: measure.id,
          groupByFieldId: time.id,
          sort: 'categoryAscending',
        },
        {
          xAxisTitle: time.name,
          yAxisTitle: measure.name,
          showDataLabels: true,
        },
      ),
    )
  } else if (temporal[0] && categorical[0]) {
    const time = temporal[0]
    const category = categorical[0]
    suggestions.push(suggestion(
      'time-stacked-count',
      'stackedBar',
      `Records by ${time.name} and ${category.name}`,
      'See the volume in each period and its category breakdown.',
      {
        ...base,
        aggregation: 'countRows',
        groupByFieldId: time.id,
        seriesFieldId: category.id,
        sort: 'categoryAscending',
      },
      {
        xAxisTitle: time.name,
        yAxisTitle: 'Records',
        showDataLabels: true,
        showLegend: true,
        stacked: true,
      },
    ))
  } else if (temporal[0]) {
    const time = temporal[0]
    suggestions.push(suggestion(
      'time-count',
      'line',
      `Records by ${time.name}`,
      'Turn the date or work-week column into an immediate activity trend.',
      {
        ...base,
        aggregation: 'countRows',
        groupByFieldId: time.id,
        sort: 'categoryAscending',
      },
      {
        xAxisTitle: time.name,
        yAxisTitle: 'Records',
        showDataLabels: true,
        smooth: true,
      },
    ))
  }

  if (!temporal[0] && numeric.length >= 2) {
    const horizontal = numeric[0]
    const vertical = numeric[1]
    suggestions.push(suggestion(
      'measure-split-kpi',
      'splitKpi',
      `${horizontal.name} and ${vertical.name}`,
      'Place both totals in one compact card for an immediate side-by-side comparison.',
      {
        ...base,
        aggregation: 'sum',
        measureFieldId: horizontal.id,
        secondaryAggregation: 'sum',
        secondaryMeasureFieldId: vertical.id,
      },
      {
        primaryLabel: horizontal.name,
        secondaryLabel: vertical.name,
      },
    ))
    suggestions.push(suggestion(
      'measure-ratio-kpi',
      'kpi',
      `${horizontal.name} as % of ${vertical.name}`,
      'Calculate a percentage from the two selected totals without a helper column.',
      {
        ...base,
        aggregation: 'sum',
        measureFieldId: horizontal.id,
        secondaryAggregation: 'sum',
        secondaryMeasureFieldId: vertical.id,
        metricCalculation: 'ratioPercent',
      },
      {
        valueFormat: 'percent',
      },
    ))
    suggestions.push(suggestion(
      'measure-scatter',
      'scatter',
      `${vertical.name} vs ${horizontal.name}`,
      'Reveal how the two selected measures move together.',
      {
        ...base,
        aggregation: 'average',
        measureFieldId: horizontal.id,
        secondaryAggregation: 'average',
        secondaryMeasureFieldId: vertical.id,
        groupByFieldId: horizontal.id,
        sort: 'categoryAscending',
        limit: 500,
      },
      {
        xAxisTitle: horizontal.name,
        yAxisTitle: vertical.name,
        showDataLabels: false,
      },
    ))
  }

  if (!temporal[0] && categorical[0] && numeric[0]) {
    const category = categorical[0]
    const measure = numeric[0]
    const visualType: StudioVisualType = prefersHorizontal(category) ? 'bar' : 'column'
    suggestions.push(suggestion(
      'category-measure',
      visualType,
      `${measureLabel(measure)} by ${category.name}`,
      visualType === 'bar'
        ? 'Long category labels stay readable in a horizontal comparison.'
        : 'Compare the selected measure cleanly across categories.',
      {
        ...base,
        aggregation: 'sum',
        measureFieldId: measure.id,
        groupByFieldId: category.id,
        sort: 'valueDescending',
      },
      {
        xAxisTitle: category.name,
        yAxisTitle: measure.name,
        showDataLabels: true,
      },
    ))
  }

  if (!temporal[0] && categorical.length >= 2) {
    const group = categorical[0]
    const series = categorical[1]
    suggestions.push(suggestion(
      'category-stacked-count',
      'stackedBar',
      `Records by ${group.name} and ${series.name}`,
      'Compare category totals while preserving the second selection as segments.',
      {
        ...base,
        aggregation: 'countRows',
        groupByFieldId: group.id,
        seriesFieldId: series.id,
        sort: 'valueDescending',
      },
      {
        xAxisTitle: group.name,
        yAxisTitle: 'Records',
        showDataLabels: true,
        showLegend: true,
        stacked: true,
      },
    ))
  }

  if (selected.length === 1 && numeric[0]) {
    const measure = numeric[0]
    suggestions.push(suggestion(
      'measure-kpi',
      'kpi',
      measure.name,
      'Summarize the selected numeric column as a single headline value.',
      {
        ...base,
        aggregation: 'sum',
        measureFieldId: measure.id,
      },
    ))
  } else if (selected.length === 1 && categorical[0]) {
    const category = categorical[0]
    if (isIdentity(category)) {
      suggestions.push(suggestion(
        'identity-kpi',
        'kpi',
        countTitle(category),
        'Count every populated identifier as one record.',
        {
          ...base,
          aggregation: 'countNonEmpty',
          measureFieldId: category.id,
        },
      ))
    } else {
      suggestions.push(suggestion(
        'category-count',
        prefersHorizontal(category) ? 'bar' : 'column',
        countTitle(category),
        'Count records and compare the values in the selected column.',
        {
          ...base,
          aggregation: 'countRows',
          groupByFieldId: category.id,
          sort: 'valueDescending',
        },
        {
          xAxisTitle: category.name,
          yAxisTitle: 'Records',
          showDataLabels: true,
        },
      ))
      if (category.distinctCount > 1 && category.distinctCount <= 10) {
        suggestions.push(suggestion(
          'category-donut',
          'donut',
          `Share by ${category.name}`,
          'Use a compact part-to-whole view for a short list of values.',
          {
            ...base,
            aggregation: 'countRows',
            groupByFieldId: category.id,
            sort: 'valueDescending',
          },
          {
            showDataLabels: true,
            showLegend: true,
          },
        ))
      }
    }
  }

  if (selected.length > 1 || suggestions.length === 0) {
    suggestions.push(tableSuggestion(dataset, selected))
  }

  const seen = new Set<string>()
  return suggestions.filter((candidate) => {
    const key = `${candidate.visualType}:${JSON.stringify(candidate.query)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 4)
}
