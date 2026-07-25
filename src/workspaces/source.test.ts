import { describe, expect, it } from 'vitest'
import type { SourceFileDescriptor } from '@/platform'
import {
  isUsableSourceFile,
  selectCoherentRoleBatch,
  sourceFingerprint,
} from './source'

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

  it('uses one coherent direct-file batch instead of mixing weekly exports', () => {
    const day = 24 * 60 * 60 * 1000
    const current = [
      { role: 'electrical' as const, modifiedAt: 8 * day, id: 'current-electrical' },
    ]
    const previous = [
      { role: 'bimIssues' as const, modifiedAt: day + 3000, id: 'previous-bim' },
      { role: 'mechanical' as const, modifiedAt: day + 2000, id: 'previous-mechanical' },
      { role: 'electrical' as const, modifiedAt: day + 1000, id: 'previous-electrical' },
      { role: 'welding' as const, modifiedAt: day, id: 'previous-welding' },
    ]

    const selected = selectCoherentRoleBatch([...current, ...previous])

    expect(selected?.map((entry) => entry.id)).toEqual([
      'previous-bim',
      'previous-mechanical',
      'previous-electrical',
      'previous-welding',
    ])
  })

  it('returns no direct-file batch when all four roles are too far apart', () => {
    const day = 24 * 60 * 60 * 1000
    expect(selectCoherentRoleBatch([
      { role: 'bimIssues', modifiedAt: 4 * day },
      { role: 'mechanical', modifiedAt: 3 * day },
      { role: 'electrical', modifiedAt: 2 * day },
      { role: 'welding', modifiedAt: day },
    ])).toBeNull()
  })
})
