import { platform } from '@/platform'
import type { UpdateInfo } from '@/types'

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    return await platform.checkForUpdate()
  } catch {
    return null
  }
}
