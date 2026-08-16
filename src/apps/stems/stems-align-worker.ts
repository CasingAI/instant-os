/// <reference lib="webworker" />

/**
 * 歌词对齐 / 波形峰值后台计算 Worker：把整首全局 DTW 文本对齐与整曲峰值金字塔重建
 * 从主线程搬到独立线程，避免打开历史包时 1-2 秒无响应。纯函数计算，不加载任何模型。
 * 由 stems-app 懒创建并复用；与 AI 推理调度服务的「一次一个模型」纪律无冲突。
 */
import { alignSegmentsToLrc } from '../align/align-pipeline.ts'
import type { HypSegment } from '../align/align-text-dtw.ts'
import { buildWaveformPyramid } from './stems-separator.ts'
import type { WaveformPyramid } from './stems-separator.ts'

/** 主线程 → Worker：对齐请求。phonemes/lyrics 文本量小，结构化克隆即可。 */
export type AlignTextWorkerRequest = {
  type: 'align-text'
  /** 请求标识：响应原样回传，主线程据此路由到对应 Promise（多任务共享一个 worker） */
  requestId: number
  phonemes: HypSegment[]
  lyricsText: string
  lineTimes?: (number | undefined)[]
}

/** 主线程 → Worker：峰值重建请求。data 的 buffer 将被 transfer（主线程侧 detach）。 */
export type BuildPeaksWorkerRequest = {
  type: 'build-peaks'
  requestId: number
  /** interleaved stereo Float32 PCM */
  data: ArrayBuffer
  sampleRate: number
}

export type StemsAlignWorkerRequest = AlignTextWorkerRequest | BuildPeaksWorkerRequest

/** Worker → 主线程：结果/错误。requestId 与请求一致，供主线程区分并发任务。 */
export type StemsAlignWorkerResponse =
  | { type: 'align-done'; requestId: number; lrc: string }
  | { type: 'peaks-done'; requestId: number; pyramid: WaveformPyramid }
  | { type: 'error'; requestId: number; message: string }

function postError(requestId: number, message: string): void {
  ;(self as unknown as Worker).postMessage({
    type: 'error',
    requestId,
    message,
  } satisfies StemsAlignWorkerResponse)
}

self.onmessage = (event: MessageEvent<StemsAlignWorkerRequest>) => {
  const request = event.data
  if (request.type === 'align-text') {
    try {
      const lrc = alignSegmentsToLrc(request.phonemes, request.lyricsText, request.lineTimes)
      ;(self as unknown as Worker).postMessage(
        { type: 'align-done', requestId: request.requestId, lrc } satisfies StemsAlignWorkerResponse,
      )
    } catch (error) {
      postError(request.requestId, error instanceof Error ? error.message : String(error))
    }
    return
  }

  if (request.type === 'build-peaks') {
    try {
      const data = new Float32Array(request.data)
      const pyramid = buildWaveformPyramid(data, request.sampleRate)
      const transfers: Transferable[] = [
        request.data,
        pyramid.min.buffer,
        pyramid.max.buffer,
        ...(pyramid.rms ? [pyramid.rms.buffer] : []),
        ...(pyramid.ampL ? [pyramid.ampL.buffer] : []),
        ...(pyramid.ampR ? [pyramid.ampR.buffer] : []),
        ...(pyramid.rmsL ? [pyramid.rmsL.buffer] : []),
        ...(pyramid.rmsR ? [pyramid.rmsR.buffer] : []),
      ]
      ;(self as unknown as Worker).postMessage(
        { type: 'peaks-done', requestId: request.requestId, pyramid } satisfies StemsAlignWorkerResponse,
        transfers,
      )
    } catch (error) {
      postError(request.requestId, error instanceof Error ? error.message : String(error))
    }
  }
}

// 让 TS 把此文件当 worker 模块
export {}
