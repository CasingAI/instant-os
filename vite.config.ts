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
      // Rolldown：不要用对象 manualChunks。组顺序 = 先匹配先占用。
      // includeDependenciesRecursively 默认 true，禁止用 /src/ 或 /src\/apps/ 以免吞进 Monaco/应用 UI。
      // boot-shared 必须先于 vfs/shell：bridge 与 OS 共用的模块若被递归收进壳，/bridge 会误加载整份桌面。
      output: {
        codeSplitting: {
          groups: [
            { name: 'boot-preact', test: /node_modules\/preact(?:\/|$)/ },
            // 先占住 bridge∩OS 的浅层模块（时钟/图标/AI 配置），避免后面 vfs 递归把 os-clock 吞进 900KB 包。
            {
              name: 'boot-shared',
              test: /src\/icons\/app-icons\.tsx$|src\/os\/os-clock\.ts$|src\/ai\/openai-config\.ts$|src\/apps\/generated\/generated-app-ai-types\.ts$/,
            },
            {
              name: 'boot-vfs',
              test: /src\/apps\/files\/files-(vfs|storage)\.ts$/,
            },
            {
              name: 'boot-quickjs',
              test: /src\/quickjs\/|node_modules\/quickjs-emscripten/,
            },
            {
              name: 'boot-shell',
              test: /src\/(main|app)\.tsx$|src\/os\/os-shell\.tsx$/,
            },
          ],
        },
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
