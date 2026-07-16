import { describe, expect, it } from 'vitest'
import type { SourceFileDescriptor } from '@/platform'
import { isUsableSourceFile, sourceFingerprint } from './source'

function descriptor(path: string, size = 100, modifiedAt = 10): SourceFileDescriptor {
  return { path, name: path.split('/').pop() ?? path, size, modifiedAt }
}

describe('workspace source selection', () => {
  it('accepts report archives and spreadsheets', () => {
    expect(isUsableSourceFile(descriptor('/Reports/Weekly_Reports.zip'))).toBe(true)
    expect(isUsableSourceFile(descriptor('/Reports/Electrical_Inspection_Log.xlsx'))).toBe(true)
  })

  it('ignores hidden, lock, and partial sync files', () => {
    expect(isUsableSourceFile(descriptor('/Reports/.cache/BIM_Issues_Log.xlsx'))).toBe(false)
    expect(isUsableSourceFile(descriptor('/Reports/~$Electrical_Inspection_Log.xlsx'))).toBe(false)
    expect(isUsableSourceFile(descriptor('/Reports/Weekly_Reports.zip.partial'))).toBe(false)
  })

  it('creates a deterministic content fingerprint', () => {
    const first = descriptor('/Reports/B.xlsx', 20, 2)
    const second = descriptor('/Reports/A.xlsx', 10, 1)
    expect(sourceFingerprint([first, second])).toBe(sourceFingerprint([second, first]))
  })
})
