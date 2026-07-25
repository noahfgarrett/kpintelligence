import type { DesktopUpdateInfo, PlatformBridge, SaveFileFilter, SourceFileDescriptor } from './types'

const STORAGE_PREFIX = 'kpintelligence:'
const LEGACY_STORAGE_PREFIX = 'qcx-intelligence:'

function unavailable(): never {
  throw new Error('Persistent folder access is available in the KPIntelligence desktop app.')
}

export const browserPlatform: PlatformBridge = {
  kind: 'browser',
  supportsPersistentFolders: false,
  async chooseDirectory(): Promise<null> {
    return null
  },
  async listFiles(): Promise<SourceFileDescriptor[]> {
    return unavailable()
  },
  async readFile(): Promise<Uint8Array> {
    return unavailable()
  },
  async watchDirectory(): Promise<() => void> {
    return () => undefined
  },
  async loadState<T>(key: string): Promise<T | null> {
    const storageKey = `${STORAGE_PREFIX}${key}`
    const raw = localStorage.getItem(storageKey)
      ?? localStorage.getItem(`${LEGACY_STORAGE_PREFIX}${key}`)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as T
      localStorage.setItem(storageKey, raw)
      return parsed
    } catch {
      throw new Error('Saved KPIntelligence data is not valid JSON. It was left untouched so it can be recovered.')
    }
  },
  async saveState<T>(key: string, value: T): Promise<void> {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value))
  },
  async saveFile(data: Uint8Array, defaultName: string, _filters: SaveFileFilter[]): Promise<string> {
    const blob = new Blob([data])
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = defaultName
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return defaultName
  },
  async checkForUpdate(): Promise<DesktopUpdateInfo | null> {
    return null
  },
  async installUpdate(): Promise<void> {
    unavailable()
  },
}
