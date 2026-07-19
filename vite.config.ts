import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'
import { bootCrashGuardFirst } from './vite-boot-crash-guard-first.ts'
import { corsForSandboxedIframeAssets } from './vite-cors-for-sandboxed-iframe-assets.ts'
import { sourceSnapshot } from './vite-source-snapshot.ts'

/** OS 壳状态复杂，模块热替换易卡死；改文件后整页重载。 */
function forceFullReload(): Plugin {
  return {
    name: 'force-full-reload',
    handleHotUpdate({ server }) {
      server.ws.send({ type: 'full-reload', path: '*' })
      return []
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    preact(),
    corsForSandboxedIframeAssets(),
    bootCrashGuardFirst(),
    sourceSnapshot(),
    forceFullReload(),
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        bridge: resolve(__dirname, 'bridge.html'),
      },
    },
  },
  optimizeDeps: {
    include: ['monaco-editor', 'frimousse'],
  },
  server: {
    port: 6173,
  },
  preview: {
    port: 6174,
  },
})
