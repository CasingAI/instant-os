/**
 * 分轨可视化会话：按 trackId 缓存特征；懒加载 zip → 提取 → 丢弃 PCM。
 */

import { loadStemsArchive } from '../stems/stems-persistence.ts'
import {
  buildStemVizFeatures,
  sampleStemFeaturesAt,
  type StemVizFeatures,
  type StemVizSample,
} from './music-stems-features.ts'
import { readStemsSidecarBlob } from './music-stems-resolve.ts'

export type StemFeaturesProgress =
  | { phase: 'idle' }
  | { phase: 'probing' }
  | { phase: 'loading'; loaded: number; total: number }
  | { phase: 'extracting' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string }
  | { phase: 'missing' }

type CacheEntry = {
  features: StemVizFeatures
}

const cache = new Map<string, CacheEntry>()
let inflight: { trackId: string; promise: Promise<StemVizFeatures | undefined> } | undefined

export function getCachedStemFeatures(trackId: string | undefined): StemVizFeatures | undefined {
  if (!trackId) return undefined
  return cache.get(trackId)?.features
}

export function clearStemFeaturesCache(trackId?: string): void {
  if (trackId) {
    cache.delete(trackId)
    return
  }
  cache.clear()
}

/**
 * 确保指定曲目的分轨特征已就绪。
 * - 无 vfsRef / 无侧车 → undefined（调用方可标 missing）
 * - 已缓存 → 直接返回
 * - 同 track 并发请求合并为一次加载
 */
export async function ensureStemFeatures(input: {
  trackId: string
  vfsRef: string | undefined
  onProgress?: (progress: StemFeaturesProgress) => void
}): Promise<StemVizFeatures | undefined> {
  const cached = cache.get(input.trackId)
  if (cached) {
    input.onProgress?.({ phase: 'ready' })
    return cached.features
  }

  if (inflight?.trackId === input.trackId) {
    return inflight.promise
  }

  const promise = (async (): Promise<StemVizFeatures | undefined> => {
    input.onProgress?.({ phase: 'probing' })
    let packed: { blob: Blob; archiveName: string } | undefined
    try {
      packed = await readStemsSidecarBlob(input.vfsRef)
    } catch (cause) {
      input.onProgress?.({
        phase: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
      })
      return undefined
    }
    if (!packed) {
      input.onProgress?.({ phase: 'missing' })
      return undefined
    }

    try {
      input.onProgress?.({ phase: 'loading', loaded: 0, total: 1 })
      const { manifest, stems } = await loadStemsArchive(packed.blob, (loaded, total) => {
        input.onProgress?.({ phase: 'loading', loaded, total })
      })
      input.onProgress?.({ phase: 'extracting' })
      const features = buildStemVizFeatures({
        trackId: input.trackId,
        stems,
        sampleRate: manifest.sampleRate,
        durationSec: manifest.durationSec,
        tempo: manifest.tempo,
      })
      // 显式丢弃 PCM 引用，便于 GC
      stems.length = 0
      cache.set(input.trackId, { features })
      input.onProgress?.({ phase: 'ready' })
      return features
    } catch (cause) {
      input.onProgress?.({
        phase: 'error',
        message: cause instanceof Error ? cause.message : '分轨文件损坏或无法读取',
      })
      return undefined
    }
  })()

  inflight = { trackId: input.trackId, promise }
  try {
    return await promise
  } finally {
    if (inflight?.trackId === input.trackId) {
      inflight = undefined
    }
  }
}

/** 便捷：从缓存特征按秒采样；无缓存返回 undefined。 */
export function sampleCachedStemFeatures(
  trackId: string | undefined,
  timeSec: number,
): StemVizSample | undefined {
  const features = getCachedStemFeatures(trackId)
  if (!features) return undefined
  return sampleStemFeaturesAt(features, timeSec)
}
