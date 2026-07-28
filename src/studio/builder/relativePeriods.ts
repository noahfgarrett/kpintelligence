import { previousWorkWeek, toIsoWorkWeek } from '@/utils/workWeeks'
import type { StudioCondition } from '../library/model'

export const WORK_WEEK_PRESETS = [
  { value: '@current-work-week', label: 'Current work week' },
  { value: '@previous-work-week', label: 'Previous completed work week' },
  { value: '@through-previous-work-week', label: 'Through previous completed work week' },
  { value: '@last-4-completed-work-weeks', label: 'Last 4 completed work weeks' },
  { value: '@last-13-completed-work-weeks', label: 'Last 13 completed work weeks' },
  { value: '@last-26-completed-work-weeks', label: 'Last 26 completed work weeks' },
  { value: '@last-52-completed-work-weeks', label: 'Last 52 completed work weeks' },
] as const

export type WorkWeekPresetValue = typeof WORK_WEEK_PRESETS[number]['value']

export interface ResolvedWorkWeekPreset {
  operator: StudioCondition['operator']
  value: string
}

export function isWorkWeekPreset(value: string): value is WorkWeekPresetValue {
  return WORK_WEEK_PRESETS.some((preset) => preset.value === value)
}

export function workWeekPresetLabel(value: string): string | null {
  return WORK_WEEK_PRESETS.find((preset) => preset.value === value)?.label ?? null
}

function completedWeekRange(count: number, evaluationDate: Date): string {
  const end = previousWorkWeek(toIsoWorkWeek(evaluationDate))
  let start = end
  for (let index = 1; index < count; index += 1) start = previousWorkWeek(start)
  return `${start.label}..${end.label}`
}

export function resolveWorkWeekPreset(
  value: string,
  evaluationDate: Date,
): ResolvedWorkWeekPreset | null {
  if (!isWorkWeekPreset(value)) return null
  const current = toIsoWorkWeek(evaluationDate)
  const previous = previousWorkWeek(current)
  if (value === '@current-work-week') return { operator: 'equals', value: current.label }
  if (value === '@previous-work-week') return { operator: 'equals', value: previous.label }
  if (value === '@through-previous-work-week') {
    return { operator: 'lessThanOrEqual', value: previous.label }
  }
  const count = Number(value.match(/\d+/)?.[0] ?? 0)
  return {
    operator: 'between',
    value: completedWeekRange(Math.max(1, count), evaluationDate),
  }
}
