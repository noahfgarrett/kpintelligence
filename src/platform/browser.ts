import type { DesktopUpdateInfo, PlatformBridge, SaveFileFilter, SourceFileDescriptor } from './types'

const STORAGE_PREFIX = 'qcx-intelligence:'

function unavailable(): never {
  throw new Error('Persistent folder access is available in the QCx Intelligence desktop app.')
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
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`)
    if (!raw) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
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
