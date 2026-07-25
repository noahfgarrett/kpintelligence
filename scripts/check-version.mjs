import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const tauriConfig = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))

if (packageJson.version !== tauriConfig.version) {
  throw new Error(`Version mismatch: package.json=${packageJson.version}, tauri.conf.json=${tauriConfig.version}`)
}

process.stdout.write(`KPIntelligence version ${packageJson.version}\n`)
