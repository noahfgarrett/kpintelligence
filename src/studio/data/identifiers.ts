const MAX_ID_SEGMENT_LENGTH = 64

function hashText(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function normalizeStableId(value: unknown, fallback = 'item'): string {
  const normalized = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return (normalized || fallback).slice(0, MAX_ID_SEGMENT_LENGTH).replace(/-+$/g, '') || fallback
}

export function stableSourceId(locator: string, displayName: string): string {
  return `workbook:${normalizeStableId(displayName, 'workbook')}-${hashText(locator)}`
}

export function uniqueStableSegment(
  preferred: unknown,
  occupied: Set<string>,
  fallback: string,
): string {
  const base = normalizeStableId(preferred, fallback)
  let candidate = base
  let suffix = 2
  while (occupied.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  occupied.add(candidate)
  return candidate
}
