import { isTauri } from '@tauri-apps/api/core'
import { browserPlatform } from './browser'
import { tauriPlatform } from './tauri'

export type { DesktopUpdateInfo, PlatformBridge, SaveFileFilter, SourceFileDescriptor, UpdateProgress } from './types'

export const platform = isTauri() ? tauriPlatform : browserPlatform
