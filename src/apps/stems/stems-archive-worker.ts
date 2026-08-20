/// <reference lib="webworker" />

/**
 * 分轨压缩包后台解码/编码 Worker：在独立线程完成 zip 定位 + WAV/FLAC→Float32 解码、
 * Float32→FLAC 编码，结果用 Transferable 传回主线程，避免长歌全轨解码/FLAC 压缩阻塞 UI。
 * 由 stems-app 懒创建并复用；与 AI 推理调度服务的「一次一个模型」纪律无冲突
 * （纯 zip/FLAC 编解码，不加载任何模型）。
 */
import { inflateSync } from 'fflate'
import {
  decodeStemFromLayout,
  decodeStemWavBytes,
  readStemsArchiveLayout,
} from './stems-persistence.ts'
import { decodeFlac, encodeFlac } from './stems-flac.ts'

/** 主线程 → Worker：解码/编码请求。bytes / data 的 buffer 将被 transfer（主线程侧 detach）。 */
export type StemsArchiveWorkerRequest =
  | {
      type: 'decode'
      /** 整个 `.stems.zip` 的字节 */
      bytes: ArrayBuffer
    }
  | {
      type: 'decode-track'
      /** 单条音频条目的压缩段字节（STORE = 原始 WAV/FLAC；DEFLATE = v2 旧包 WAV 压缩段） */
      stemId: string
      data: ArrayBuffer
      method: number
      /** 条目格式：默认 wav；`.flac` 条目传 flac */
      format?: 'wav' | 'flac'
    }
  | {
      type: 'encode-flac'
      stemId: string
      /** interleaved stereo Float32 PCM */
      data: ArrayBuffer
      sampleRate: number
    }

/** Worker → 主线程：解码/编码结果（各轨 Float32 / FLAC 字节的 buffer 已 transfer）。 */
export type StemsArchiveWorkerResponse =
  | { type: 'done'; stems: { stemId: string; data: Float32Array }[] }
  | { type: 'track-done'; stemId: string; data: Float32Array }
  | { type: 'flac-encoded'; stemId: string; data: ArrayBuffer }
  | { type: 'error'; message: string }

function postError(message: string): void {
  ;(self as unknown as Worker).postMessage({
    type: 'error',
    message,
  } satisfies StemsArchiveWorkerResponse)
}

self.onmessage = async (event: MessageEvent<StemsArchiveWorkerRequest>) => {
  const request = event.data
  if (request.type === 'decode') {
    try {
      const bytes = new Uint8Array(request.bytes)
      const { manifest, entries } = readStemsArchiveLayout(bytes)
      const stems: { stemId: string; data: Float32Array }[] = []
      for (const item of manifest.stems) {
        const layout = entries.get(item.file)
        if (!layout) throw new Error(`压缩包缺少 ${item.file}，无法载入`)
        if (item.file.endsWith('.flac')) {
          const data = bytes.subarray(
            layout.dataOffset,
            layout.dataOffset + layout.compressedSize,
          )
          stems.push({ stemId: item.id, data: await decodeFlac(data) })
        } else {
          stems.push({ stemId: item.id, data: decodeStemFromLayout(bytes, layout) })
        }
      }
      const transfers: Transferable[] = [request.bytes, ...stems.map((s) => s.data.buffer)]
      ;(self as unknown as Worker).postMessage(
        { type: 'done', stems } satisfies StemsArchiveWorkerResponse,
        transfers,
      )
    } catch (error) {
      postError(error instanceof Error ? error.message : String(error))
    }
    return
  }

  if (request.type === 'decode-track') {
    try {
      const data = new Uint8Array(request.data)
      let float: Float32Array
      if (request.format === 'flac') {
        float = await decodeFlac(data)
      } else {
        const wav = request.method === 8 ? inflateSync(data) : data
        float = decodeStemWavBytes(wav)
      }
      ;(self as unknown as Worker).postMessage(
        { type: 'track-done', stemId: request.stemId, data: float } satisfies StemsArchiveWorkerResponse,
        [float.buffer],
      )
    } catch (error) {
      postError(error instanceof Error ? error.message : String(error))
    }
    return
  }

  if (request.type === 'encode-flac') {
    try {
      const pcm = new Float32Array(request.data)
      const flac = await encodeFlac(pcm, request.sampleRate)
      ;(self as unknown as Worker).postMessage(
        { type: 'flac-encoded', stemId: request.stemId, data: flac.buffer as ArrayBuffer } satisfies StemsArchiveWorkerResponse,
        [flac.buffer],
      )
    } catch (error) {
      postError(error instanceof Error ? error.message : String(error))
    }
  }
}

// 让 TS 把此文件当 worker 模块
export {}
