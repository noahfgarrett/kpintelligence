import type { PlatformBridge, SourceFileDescriptor } from '@/platform/types'
import type { TeamLibraryRecord } from '../library/model'
import { compareSemver, readDashboardPackage } from './package'
import type { DashboardPackageFile } from './types'

const MAX_TEAM_LIBRARY_PACKAGES = 500
const MAX_TEAM_LIBRARY_BYTES = 150 * 1024 * 1024
const MAX_SINGLE_PACKAGE_BYTES = 15 * 1024 * 1024

export interface TeamLibraryCatalog {
  libraryId: string
  scannedAt: string
  packages: DashboardPackageFile[]
  warnings: string[]
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      output[index] = await worker(values[index])
    }
  }))
  return output
}

function publishedPackages(packages: DashboardPackageFile[]): DashboardPackageFile[] {
  return [...packages].sort((left, right) => {
    const nameComparison = left.document.manifest.name.localeCompare(right.document.manifest.name)
    if (nameComparison !== 0) return nameComparison
    const versionComparison = compareSemver(
      right.document.manifest.templateVersion,
      left.document.manifest.templateVersion,
    )
    return versionComparison || right.modifiedAt - left.modifiedAt
  })
}

export async function scanTeamLibrary(
  platform: PlatformBridge,
  library: TeamLibraryRecord,
  currentAppVersion = __APP_VERSION__,
): Promise<TeamLibraryCatalog> {
  const descriptors = await platform.listFiles(library.folderPath, {
    extensions: ['kpidashboard'],
    maxFiles: MAX_TEAM_LIBRARY_PACKAGES,
    maxEntries: 5_000,
    fileLabel: 'dashboard packages',
  })
  const aggregateBytes = descriptors.reduce((total, descriptor) => total + descriptor.size, 0)
  if (aggregateBytes > MAX_TEAM_LIBRARY_BYTES) {
    throw new Error('This Team Library exceeds the 150 MB safety limit. Archive older package versions or choose a narrower folder.')
  }

  const results = await mapWithConcurrency(descriptors, 4, async (
    descriptor: SourceFileDescriptor,
  ): Promise<{ file: DashboardPackageFile | null; warning: string | null }> => {
    if (descriptor.size > MAX_SINGLE_PACKAGE_BYTES) {
      return {
        file: null,
        warning: `${descriptor.name} is larger than the 15 MB package limit.`,
      }
    }
    try {
      const document = await readDashboardPackage(
        await platform.readFile(descriptor.path),
        currentAppVersion,
      )
      return {
        file: {
          ...descriptor,
          document,
        },
        warning: null,
      }
    } catch (error) {
      return {
        file: null,
        warning: `${descriptor.name}: ${error instanceof Error ? error.message : 'could not be opened'}`,
      }
    }
  })

  return {
    libraryId: library.id,
    scannedAt: new Date().toISOString(),
    packages: publishedPackages(results.flatMap((result) =>
      result.file ? [result.file] : [])),
    warnings: results.flatMap((result) => result.warning ? [result.warning] : []),
  }
}
