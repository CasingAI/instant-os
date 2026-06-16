import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { corsForSandboxedIframeAssets } from './vite-cors-for-sandboxed-iframe-assets.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact(), corsForSandboxedIframeAssets()],
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
