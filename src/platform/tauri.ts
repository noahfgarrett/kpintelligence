import { join } from '@tauri-apps/api/path'
import { open, save } from '@tauri-apps/plugin-dialog'
import { readDir, readFile, remove, rename, stat, watch, writeFile } from '@tauri-apps/plugin-fs'
import { openUrl } from '@tauri-apps/plugin-opener'
import { relaunch } from '@tauri-apps/plugin-process'
import { load, type Store } from '@tauri-apps/plugin-store'
import { check, type Update } from '@tauri-apps/plugin-updater'
import type {
  DesktopUpdateInfo,
  ListFileOptions,
  PlatformBridge,
  SaveFileFilter,
  SourceFileDescriptor,
} from './types'

const STORE_PATH = 'kpintelligence.json'
const LEGACY_STORE_PATH = 'qcx-intelligence.json'
const LEGACY_STORE_KEYS = ['workspaces'] as const
const MAX_DIRECTORY_DEPTH = 20
const MAX_DISCOVERED_SOURCE_FILES = 2000
const MAX_SCANNED_DIRECTORY_ENTRIES = 10_000
const SOURCE_EXTENSIONS = ['csv', 'xls', 'xlsx', 'zip']
let storePromise: Promise<Store> | null = null
let pendingUpdate: Update | null = null

async function loadStoreWithMigration(): Promise<Store> {
  const store = await load(STORE_PATH, { defaults: {}, autoSave: 100 })
  const legacy = await load(LEGACY_STORE_PATH, { defaults: {}, autoSave: false })
  let migrated = false
  for (const key of LEGACY_STORE_KEYS) {
    if (await store.get(key) != null) continue
    const value = await legacy.get(key)
    if (value == null) continue
    await store.set(key, value)
    migrated = true
  }
  if (migrated) await store.save()
  return store
}

function getStore(): Promise<Store> {
  storePromise ??= loadStoreWithMigration()
  return storePromise
}

function hasExtension(name: string, extensions: ReadonlySet<string>): boolean {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  return extensions.has(extension)
}

function shouldIgnoreEntry(name: string): boolean {
  return name.startsWith('.')
    || name.startsWith('~$')
    || name === '__MACOSX'
    || /\.(crdownload|download|part|partial|tmp)$/i.test(name)
}

async function walkDirectory(
  rootPath: string,
  options: ListFileOptions = {},
  depth = 0,
  state?: { files: SourceFileDescriptor[]; scannedEntries: number },
): Promise<SourceFileDescriptor[]> {
  const currentState = state ?? { files: [], scannedEntries: 0 }
  const extensions = new Set(
    (options.extensions ?? SOURCE_EXTENSIONS)
      .map((extension) => extension.replace(/^\./, '').toLowerCase()),
  )
  const maxFiles = options.maxFiles ?? MAX_DISCOVERED_SOURCE_FILES
  const maxEntries = options.maxEntries ?? MAX_SCANNED_DIRECTORY_ENTRIES
  const fileLabel = options.fileLabel ?? 'spreadsheet files'
  if (depth > MAX_DIRECTORY_DEPTH) {
    throw new Error(`The selected folder is nested more than ${MAX_DIRECTORY_DEPTH} levels deep. Choose a narrower project folder.`)
  }
  const entries = await readDir(rootPath)
  for (const entry of entries) {
    currentState.scannedEntries += 1
    if (currentState.scannedEntries > maxEntries) {
      throw new Error(`The selected folder contains more than ${maxEntries.toLocaleString()} files and folders. Choose a narrower folder.`)
    }
    if (shouldIgnoreEntry(entry.name)) continue
    const path = await join(rootPath, entry.name)
    if (entry.isDirectory && !entry.isSymlink) {
      await walkDirectory(path, options, depth + 1, currentState)
      continue
    }
    if (!entry.isFile || entry.isSymlink || !hasExtension(entry.name, extensions)) continue
    if (currentState.files.length >= maxFiles) {
      throw new Error(`The selected folder contains more than ${maxFiles.toLocaleString()} ${fileLabel}. Choose a narrower folder.`)
    }
    const info = await stat(path)
    currentState.files.push({
      path,
      name: entry.name,
      size: info.size,
      modifiedAt: info.mtime?.getTime() ?? 0,
    })
  }
  return currentState.files
}

export const tauriPlatform: PlatformBridge = {
  kind: 'tauri',
  supportsPersistentFolders: true,
  async chooseDirectory(options): Promise<string | null> {
    const selected = await open({
      title: options?.title ?? 'Choose a synced SharePoint or OneDrive folder',
      defaultPath: options?.defaultPath,
      directory: true,
      recursive: true,
      multiple: false,
      canCreateDirectories: options?.canCreateDirectories ?? false,
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
  async writeFileInDirectory(directory: string, fileName: string, data: Uint8Array): Promise<string> {
    const destination = await join(directory, fileName)
    const temporary = await join(
      directory,
      `.${fileName}.${Date.now().toString(36)}.tmp`,
    )
    try {
      await writeFile(temporary, data)
      await rename(temporary, destination)
    } catch (error) {
      await remove(temporary).catch(() => undefined)
      throw error
    }
    return destination
  },
  openExternalUrl: openUrl,
  async checkForUpdate(): Promise<DesktopUpdateInfo | null> {
    if (pendingUpdate) await pendingUpdate.close()
    pendingUpdate = await check({ timeout: 30_000 })
    if (!pendingUpdate) return null
    return {
      version: pendingUpdate.version,
      releaseNotes: pendingUpdate.body ?? '',
      releaseDate: pendingUpdate.date,
    }
  },
  async installUpdate(info, onProgress): Promise<void> {
    if (!pendingUpdate || pendingUpdate.version !== info.version) {
      pendingUpdate = await check({ timeout: 30_000 })
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
