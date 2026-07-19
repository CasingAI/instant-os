import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'

/** 与宿主一致：不做模块热替换，改文件后整页重载。 */
function forceFullReload(): Plugin {
  return {
    name: 'force-full-reload',
    handleHotUpdate({ server }) {
      server.ws.send({ type: 'full-reload', path: '*' })
      return []
    },
  }
}

export default defineConfig({
  plugins: [preact(), forceFullReload()],
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
