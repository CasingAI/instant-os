import * as ort from 'onnxruntime-web'
import { gunzipSync } from 'fflate'

// 用 ?url 让 vite 把 onnxruntime-web 的 glue 与 wasm 作为静态资源打包。
// glue（.mjs，~46 KiB）体积小直接保留；wasm 二进制在构建时会被
// vite-wasm-gzip 插件压缩为同名 `.wasm.gz`（Cloudflare Pages 单文件 25 MiB 上限），
// 这里运行时 fetch 后按需解压，经 ort.env.wasm.wasmBinary 注入（设置后
// wasmPaths 的 wasm 字段被忽略，但 mjs 字段仍决定 glue 的加载路径）。
import ortWasmSimdThreadedJsepMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url'
import ortWasmSimdThreadedJsepWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'

let wasmReady: Promise<void> | undefined
let configured = false

/**
 * 配置 onnxruntime-web 的 WASM 运行时，需在首个 InferenceSession.create 之前调用。
 * 幂等，可重复调用；未解压完成前重复调用会复用同一个 promise。
 *
 * - 多线程：按机器核数放开（WASM 回退时默认只有 1 个线程，慢到不可用）。
 * - wasm 二进制：dev 模式下服务器直接提供原始 .wasm，生产构建提供 .wasm.gz，
 *   按 gzip 魔数自动识别，两种形态都能跑。
 */
export function setupOrtWasm(): Promise<void> {
  if (!configured) {
    configured = true
    ort.env.wasm.wasmPaths = { mjs: ortWasmSimdThreadedJsepMjsUrl }
    ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 8)
  }
  if (!wasmReady) {
    wasmReady = (async () => {
      const response = await fetch(ortWasmSimdThreadedJsepWasmUrl)
      if (!response.ok) {
        throw new Error(`failed to fetch ort wasm binary: ${response.status}`)
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      // gzip 魔数 0x1f 0x8b：生产构建下 vite-wasm-gzip 已把大 wasm 压缩为 .wasm.gz。
      const wasmBinary = isGzip(bytes)
        ? gunzipSync(bytes)
        : bytes
      // fflate 返回的 Uint8Array 可能带 byteOffset，取其干净的 ArrayBuffer。
      ort.env.wasm.wasmBinary = wasmBinary.buffer.slice(
        wasmBinary.byteOffset,
        wasmBinary.byteOffset + wasmBinary.byteLength,
      ) as ArrayBuffer
    })()
  }
  return wasmReady
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

export { ort }
