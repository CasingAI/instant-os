import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'
import { bootCrashGuardFirst } from './vite-boot-crash-guard-first.ts'
import { corsForSandboxedIframeAssets } from './vite-cors-for-sandboxed-iframe-assets.ts'
import { sourceSnapshot } from './vite-source-snapshot.ts'

/**
 * OS 壳状态复杂，模块热替换易卡死；改文件后也不整页刷新，需手动刷新或菜单「重新启动」。
 * 仅拦截 Vite HMR 推送不够：@preact/preset-vite 默认仍注入 Prefresh 运行时（window.__PREFRESH__），
 * 会在长会话里滞留 VNode/组件闭包导致 dev 内存暴涨，故一并关闭 prefreshEnabled。
 */
function suppressHotUpdate(): Plugin {
  return {
    name: 'suppress-hot-update',
    handleHotUpdate() {
      return []
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    preact({ prefreshEnabled: false }),
    corsForSandboxedIframeAssets(),
    bootCrashGuardFirst(),
    sourceSnapshot(),
    suppressHotUpdate(),
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
  },
  preview: {
    port: 6174,
  },
})
