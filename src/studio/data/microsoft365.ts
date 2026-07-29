const SHAREPOINT_SUFFIX = '.sharepoint.com'
const TEAMS_HOSTS = new Set(['teams.microsoft.com', 'teams.cloud.microsoft'])

export function normalizeMicrosoft365Url(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    const hostname = url.hostname.toLowerCase()
    if (
      url.protocol !== 'https:'
      || (!hostname.endsWith(SHAREPOINT_SUFFIX) && !TEAMS_HOSTS.has(hostname))
    ) return null
    return url.toString()
  } catch {
    return null
  }
}

export function isMicrosoft365Url(value: string): boolean {
  return normalizeMicrosoft365Url(value) !== null
}
