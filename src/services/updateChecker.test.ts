import { describe, expect, it } from 'vitest'
import { formatUpdateCheckError } from './updateChecker'

describe('formatUpdateCheckError', () => {
  it.each([
    ['request timed out', 'did not respond in time'],
    ['invalid peer certificate: UnknownIssuer', 'HTTPS inspection certificate'],
    ['proxy tunnel failed', 'Windows or environment proxy'],
    ['dns name resolution failed', 'could not be found'],
    ['request failed with status: 403 Forbidden', 'blocked by the network or proxy'],
    ['request failed with status: 502', 'temporarily unavailable'],
  ])('classifies %s', (error, expected) => {
    expect(formatUpdateCheckError(new Error(error))).toContain(expected)
  })

  it('provides a useful fallback without exposing raw error details', () => {
    expect(formatUpdateCheckError(new Error('unexpected internals'))).toBe(
      'KPIntelligence could not reach the update service. Check your connection, VPN, or corporate proxy and try again.',
    )
  })
})
