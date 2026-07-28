import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')
const [
  packageSource,
  packageLockSource,
  tauriSource,
  cargoSource,
  cargoLockSource,
  changelogSource,
] = await Promise.all([
  read('package.json'),
  read('package-lock.json'),
  read('src-tauri/tauri.conf.json'),
  read('src-tauri/Cargo.toml'),
  read('src-tauri/Cargo.lock'),
  read('src/data/changelog.ts'),
])

const packageJson = JSON.parse(packageSource)
const packageLock = JSON.parse(packageLockSource)
const tauriConfig = JSON.parse(tauriSource)

function packageBlock(source, marker) {
  const blocks = source.split(marker).slice(1)
  return blocks.find((block) => /^\s*name\s*=\s*"kpintelligence"\s*$/m.test(block)) ?? ''
}

function tomlVersion(source, label) {
  const match = source.match(/^\s*version\s*=\s*"([^"]+)"\s*$/m)
  if (!match) throw new Error(`Could not read ${label} version.`)
  return match[1]
}

const cargoPackage = cargoSource.match(/\[package\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? ''
const cargoLockPackage = packageBlock(cargoLockSource, '[[package]]')
const changelogVersion = changelogSource.match(/version:\s*'([^']+)'/)?.[1]
if (!changelogVersion) throw new Error('Could not read the newest in-app changelog version.')

const expected = packageJson.version
const versions = {
  'package.json': packageJson.version,
  'package-lock.json': packageLock.version,
  'package-lock.json root package': packageLock.packages?.['']?.version,
  'tauri.conf.json': tauriConfig.version,
  'Cargo.toml': tomlVersion(cargoPackage, 'Cargo.toml'),
  'Cargo.lock': tomlVersion(cargoLockPackage, 'Cargo.lock'),
  'in-app changelog': changelogVersion,
}

const mismatches = Object.entries(versions)
  .filter(([, version]) => version !== expected)
  .map(([label, version]) => `${label}=${String(version)}`)
if (mismatches.length > 0) {
  throw new Error(`Version mismatch: package.json=${expected}; ${mismatches.join('; ')}`)
}

const refType = process.env.GITHUB_REF_TYPE
const refName = process.env.GITHUB_REF_NAME
if (refType === 'tag' && refName !== `v${expected}`) {
  throw new Error(`Release tag ${refName} does not match app version v${expected}.`)
}

process.stdout.write(`KPIntelligence version ${expected}\n`)
