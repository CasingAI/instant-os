import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { bootCrashGuardFirst } from './vite-boot-crash-guard-first.ts'
import { corsForSandboxedIframeAssets } from './vite-cors-for-sandboxed-iframe-assets.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact(), corsForSandboxedIframeAssets(), bootCrashGuardFirst()],
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
