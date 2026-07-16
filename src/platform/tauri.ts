import { join } from '@tauri-apps/api/path'
import { open, save } from '@tauri-apps/plugin-dialog'
import { readDir, readFile, stat, watch, writeFile } from '@tauri-apps/plugin-fs'
import { relaunch } from '@tauri-apps/plugin-process'
import { load, type Store } from '@tauri-apps/plugin-store'
import { check, type Update } from '@tauri-apps/plugin-updater'
import type { DesktopUpdateInfo, PlatformBridge, SaveFileFilter, SourceFileDescriptor } from './types'

const STORE_PATH = 'qcx-intelligence.json'
let storePromise: Promise<Store> | null = null
let pendingUpdate: Update | null = null

function getStore(): Promise<Store> {
  storePromise ??= load(STORE_PATH, { defaults: {}, autoSave: 100 })
  return storePromise
}

async function walkDirectory(rootPath: string): Promise<SourceFileDescriptor[]> {
  const files: SourceFileDescriptor[] = []
  const entries = await readDir(rootPath)
  for (const entry of entries) {
    const path = await join(rootPath, entry.name)
    if (entry.isDirectory && !entry.isSymlink) {
      files.push(...await walkDirectory(path))
      continue
    }
    if (!entry.isFile || entry.isSymlink) continue
    const info = await stat(path)
    files.push({
      path,
      name: entry.name,
      size: info.size,
      modifiedAt: info.mtime?.getTime() ?? 0,
    })
  }
  return files
}

export const tauriPlatform: PlatformBridge = {
  kind: 'tauri',
  supportsPersistentFolders: true,
  async chooseDirectory(): Promise<string | null> {
    const selected = await open({
      title: 'Choose a synced SharePoint or OneDrive folder',
      directory: true,
      recursive: true,
      multiple: false,
      canCreateDirectories: false,
      fileAccessMode: 'scoped',
    })
    return typeof selected === 'string' ? selected : null
  },
  listFiles: walkDirectory,
  readFile,
  async watchDirectory(rootPath: string, onChange: () => void): Promise<() => void> {
    return watch(rootPath, onChange, { recursive: true, delayMs: 900 })
  },
  async loadState<T>(key: string): Promise<T | null> {
    return (await getStore()).get<T>(key).then((value) => value ?? null)
  },
  async saveState<T>(key: string, value: T): Promise<void> {
    const store = await getStore()
    await store.set(key, value)
    await store.save()
  },
  async saveFile(data: Uint8Array, defaultName: string, filters: SaveFileFilter[]): Promise<string | null> {
    const destination = await save({ title: `Save ${defaultName}`, defaultPath: defaultName, filters })
    if (!destination) return null
    await writeFile(destination, data)
    return destination
  },
  async checkForUpdate(): Promise<DesktopUpdateInfo | null> {
    if (pendingUpdate) await pendingUpdate.close()
    pendingUpdate = await check({ timeout: 12_000 })
    if (!pendingUpdate) return null
    return {
      version: pendingUpdate.version,
      releaseNotes: pendingUpdate.body ?? '',
      releaseDate: pendingUpdate.date,
    }
  },
  async installUpdate(info, onProgress): Promise<void> {
    if (!pendingUpdate || pendingUpdate.version !== info.version) {
      pendingUpdate = await check({ timeout: 12_000 })
    }
    if (!pendingUpdate || pendingUpdate.version !== info.version) {
      throw new Error('The selected update is no longer available.')
    }
    let downloadedBytes = 0
    let totalBytes: number | undefined
    await pendingUpdate.downloadAndInstall((event) => {
      if (event.event === 'Started') totalBytes = event.data.contentLength
      if (event.event === 'Progress') downloadedBytes += event.data.chunkLength
      onProgress?.({ downloadedBytes, totalBytes })
    }, { timeout: 120_000 })
    await relaunch()
  },
}
