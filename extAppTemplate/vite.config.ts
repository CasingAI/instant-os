import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'

/** 与宿主一致：不做模块热替换，也不整页刷新；需手动刷新。 */
function suppressHotUpdate(): Plugin {
  return {
    name: 'suppress-hot-update',
    handleHotUpdate() {
      return []
    },
  }
}

export default defineConfig({
  plugins: [preact(), suppressHotUpdate()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 6175,
    cors: true,
  },
  preview: {
    port: 6176,
  },
})
