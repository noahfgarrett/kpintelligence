import { platform } from '@/platform'
import type { UpdateInfo } from '@/types'

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

export function formatUpdateCheckError(error: unknown): string {
  const detail = errorText(error).toLowerCase()

  if (detail.includes('timed out') || detail.includes('timeout')) {
    return 'The update service did not respond in time. Check your VPN or corporate proxy, then try again.'
  }
  if (
    detail.includes('certificate')
    || detail.includes('invalid peer')
    || detail.includes('unknown issuer')
    || detail.includes('tls')
    || detail.includes('ssl')
  ) {
    return 'Windows could not verify the secure update connection. A corporate HTTPS inspection certificate may be involved.'
  }
  if (detail.includes('proxy') || detail.includes('tunnel')) {
    return 'KPIntelligence could not connect through the Windows or environment proxy. Check the proxy address and try again.'
  }
  if (
    detail.includes('dns')
    || detail.includes('resolve')
    || detail.includes('name resolution')
    || detail.includes('not known')
  ) {
    return 'The update service could not be found. Check DNS, VPN access, or whether GitHub releases are allowed.'
  }
  if (/\b40[13]\b/.test(detail) || detail.includes('forbidden') || detail.includes('unauthorized')) {
    return 'The update service was blocked by the network or proxy. GitHub release downloads must be allowed.'
  }
  if (detail.includes('status: 5') || detail.includes('server error')) {
    return 'The update service is temporarily unavailable. Try again in a few minutes.'
  }

  return 'KPIntelligence could not reach the update service. Check your connection, VPN, or corporate proxy and try again.'
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  return platform.checkForUpdate()
}
