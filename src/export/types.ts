import type { SaveFileFilter } from '@/platform'

export interface GeneratedReportFile {
  data: Uint8Array
  fileName: string
  filters: SaveFileFilter[]
}
