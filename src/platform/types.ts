export interface SourceFileDescriptor {
  path: string
  name: string
  size: number
  modifiedAt: number
}

export interface SaveFileFilter {
  name: string
  extensions: string[]
}

export interface DesktopUpdateInfo {
  version: string
  releaseNotes: string
  releaseDate?: string
}

export interface UpdateProgress {
  downloadedBytes: number
  totalBytes?: number
}

export interface PlatformBridge {
  kind: 'browser' | 'tauri'
  supportsPersistentFolders: boolean
  chooseDirectory(): Promise<string | null>
  listFiles(rootPath: string): Promise<SourceFileDescriptor[]>
  readFile(path: string): Promise<Uint8Array>
  watchDirectory(rootPath: string, onChange: () => void): Promise<() => void>
  loadState<T>(key: string): Promise<T | null>
  saveState<T>(key: string, value: T): Promise<void>
  saveFile(data: Uint8Array, defaultName: string, filters: SaveFileFilter[]): Promise<string | null>
  checkForUpdate(): Promise<DesktopUpdateInfo | null>
  installUpdate(info: DesktopUpdateInfo, onProgress?: (progress: UpdateProgress) => void): Promise<void>
}
