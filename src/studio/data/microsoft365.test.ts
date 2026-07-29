import { describe, expect, it } from 'vitest'
import { isMicrosoft365Url, normalizeMicrosoft365Url } from './microsoft365'

describe('Microsoft 365 URLs', () => {
  it('accepts SharePoint tenant and Teams web links', () => {
    expect(normalizeMicrosoft365Url('https://contoso.sharepoint.com/sites/QC/Documents'))
      .toBe('https://contoso.sharepoint.com/sites/QC/Documents')
    expect(isMicrosoft365Url('https://teams.microsoft.com/l/channel/example')).toBe(true)
    expect(isMicrosoft365Url('https://teams.cloud.microsoft/l/channel/example')).toBe(true)
  })

  it('rejects non-HTTPS and unrelated web addresses', () => {
    expect(isMicrosoft365Url('http://contoso.sharepoint.com/sites/QC')).toBe(false)
    expect(isMicrosoft365Url('https://example.com/sharepoint')).toBe(false)
    expect(isMicrosoft365Url('not a url')).toBe(false)
  })
})
