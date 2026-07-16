export function compactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

export function percent(value: number, fractionDigits = 0): string {
  if (!Number.isFinite(value)) return '0%'
  return `${value.toFixed(fractionDigits)}%`
}

export function deltaLabel(value: number, suffix = ' vs Previous Week'): string {
  if (Math.abs(value) < 0.0001) return `Flat${suffix}`
  const sign = value > 0 ? '+' : ''
  return `${sign}${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}${suffix}`
}

export function csvCell(value: unknown): string {
  const text = String(value ?? '')
  if (!/[",\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}
