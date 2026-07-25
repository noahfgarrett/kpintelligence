import { platform } from '@/platform'
import type { UpdateInfo } from '@/types'

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  return platform.checkForUpdate()
}
