/// <reference lib="webworker" />

/**
 * 分轨压缩包后台解码 Worker：在独立线程完成 zip 定位 + WAV→Float32 解码，
 * 结果用 Transferable 传回主线程，避免长歌 7 轨解码阻塞 UI。
 * 由 stems-app 懒创建并复用；与 AI 推理调度服务的「一次一个模型」纪律无冲突
 * （纯 zip 解码，不加载任何模型）。
 */
import { inflateSync } from 'fflate'
import {
  decodeStemFromLayout,
  decodeStemWavBytes,
  readStemsArchiveLayout,
} from './stems-persistence.ts'

/** 主线程 → Worker：解码请求。bytes / data 的 buffer 将被 transfer（主线程侧 detach）。 */
export type StemsArchiveWorkerRequest =
  | {
      type: 'decode'
      /** 整个 `.stems.zip` 的字节 */
      bytes: ArrayBuffer
    }
  | {
      type: 'decode-track'
      /** 单条 WAV 的压缩段字节（STORE = 原始 WAV；DEFLATE = v2 旧包压缩段） */
      stemId: string
      data: ArrayBuffer
      method: number
    }

/** Worker → 主线程：解码结果（各轨 Float32 的 buffer 已 transfer）。 */
export type StemsArchiveWorkerResponse =
  | { type: 'done'; stems: { stemId: string; data: Float32Array }[] }
  | { type: 'track-done'; stemId: string; data: Float32Array }
  | { type: 'error'; message: string }

self.onmessage = (event: MessageEvent<StemsArchiveWorkerRequest>) => {
  const request = event.data
  if (request.type === 'decode') {
    try {
      const bytes = new Uint8Array(request.bytes)
      const { manifest, entries } = readStemsArchiveLayout(bytes)
      const stems = manifest.stems.map((item) => {
        const layout = entries.get(item.file)
        if (!layout) throw new Error(`压缩包缺少 ${item.file}，无法载入`)
        return { stemId: item.id, data: decodeStemFromLayout(bytes, layout) }
      })
      const transfers: Transferable[] = [request.bytes, ...stems.map((s) => s.data.buffer)]
      ;(self as unknown as Worker).postMessage(
        { type: 'done', stems } satisfies StemsArchiveWorkerResponse,
        transfers,
      )
    } catch (error) {
      ;(self as unknown as Worker).postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      } satisfies StemsArchiveWorkerResponse)
    }
    return
  }

  if (request.type === 'decode-track') {
    try {
      const data = new Uint8Array(request.data)
      const wav = request.method === 8 ? inflateSync(data) : data
      const float = decodeStemWavBytes(wav)
      ;(self as unknown as Worker).postMessage(
        { type: 'track-done', stemId: request.stemId, data: float } satisfies StemsArchiveWorkerResponse,
        [float.buffer],
      )
    } catch (error) {
      ;(self as unknown as Worker).postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      } satisfies StemsArchiveWorkerResponse)
    }
  }
}

// 让 TS 把此文件当 worker 模块
export {}
