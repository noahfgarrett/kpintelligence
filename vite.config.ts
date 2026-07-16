import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as {
  version: string
  repository?: { url?: string } | string
}

function repoSlug(): string {
  const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  const match = raw?.match(/github\.com[:/](.+?)(?:\.git)?$/)
  return match?.[1] ?? 'noahfgarrett/qcx-intelligence'
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'standalone' ? [viteSingleFile()] : [])],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GITHUB_REPO__: JSON.stringify(repoSlug()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    target: 'esnext',
    cssCodeSplit: mode === 'standalone' ? false : true,
    chunkSizeWarningLimit: 10000,
    rollupOptions: {
      output: mode === 'standalone'
        ? { inlineDynamicImports: true, manualChunks: undefined }
        : undefined,
    },
  },
  server: {
    strictPort: true,
  },
}))
