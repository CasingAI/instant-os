import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { bootCrashGuardFirst } from './vite-boot-crash-guard-first.ts'
import { corsForSandboxedIframeAssets } from './vite-cors-for-sandboxed-iframe-assets.ts'
import { sourceSnapshot } from './vite-source-snapshot.ts'
import { wasmGzip } from './vite-wasm-gzip.ts'

/**
 * OS 壳状态复杂，从源头彻底关闭 HMR：
 * - server.hmr: false —— 不建立 HMR websocket，import.meta.hot 为 undefined，
 *   改文件既不热替换也不整页刷新，需手动刷新或菜单「重新启动」。
 * - prefreshEnabled: false —— 不注入 Prefresh 运行时（window.__PREFRESH__），
 *   避免长会话里滞留 VNode/组件闭包导致 dev 内存暴涨。
 */

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    preact({ prefreshEnabled: false }),
    corsForSandboxedIframeAssets(),
    bootCrashGuardFirst(),
    sourceSnapshot(),
    wasmGzip(),
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
    include: ['monaco-editor', 'frimousse', 'quickjs-emscripten'],
  },
  // rolldown-vite 的 iife worker 不支持与主包共享模块（code-splitting）；
  // worker 文件均使用 ES import，改 es 格式可正常打包共享 chunk。
  worker: {
    format: 'es',
  },
  server: {
    port: 6173,
    hmr: false,
  },
  preview: {
    port: 6174,
  },
})
