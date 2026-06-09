import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact()],
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
