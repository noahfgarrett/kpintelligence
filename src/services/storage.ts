import type { ReportFilters } from '@/types'

const NAMESPACE = 'qaqc-report-dashboard'
const FILTERS_KEY = `${NAMESPACE}:filters`
const LEGACY_CONNECTION_KEYS = [
  `${NAMESPACE}:smartsheet-token`,
  `${NAMESPACE}:token-meta`,
  `${NAMESPACE}:sheet-map`,
]

export function clearLegacyConnectionData(): void {
  LEGACY_CONNECTION_KEYS.forEach((key) => localStorage.removeItem(key))
}

export function saveFilters(filters: ReportFilters): void {
  localStorage.setItem(FILTERS_KEY, JSON.stringify(filters))
}

export function loadFilters(): Partial<ReportFilters> {
  const raw = localStorage.getItem(FILTERS_KEY)
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Partial<ReportFilters>
  } catch {
    return {}
  }
}
