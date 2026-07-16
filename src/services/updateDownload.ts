import { platform, type UpdateProgress } from '@/platform'
import type { UpdateInfo } from '@/types'

export async function installUpdate(
  info: UpdateInfo,
  onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
  await platform.installUpdate(info, onProgress)
}
