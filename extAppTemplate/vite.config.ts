import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

/** 与宿主一致：从源头彻底关闭 HMR（server.hmr: false），不热替换也不整页刷新，需手动刷新。 */
export default defineConfig({
  plugins: [preact({ prefreshEnabled: false })],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 6175,
    cors: true,
    hmr: false,
  },
  preview: {
    port: 6176,
  },
})
