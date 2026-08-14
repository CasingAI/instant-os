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
import { readStemsSidecarBlob, readStemsSidecarManifest } from './music-stems-resolve.ts'

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

// —— 歌词（实验室对齐结果）读取 ——

/** 分轨包内歌词：aligned 为实验室对齐结果（逐字时间戳），raw 为原始清洗文本，lrc 为原始 .lrc 文本（含行时间戳）。 */
export type StemLyrics = {
  aligned?: string
  raw?: string
  lrc?: string
}

/** 按 trackId 缓存的分轨包内歌词（aligned 与 raw 分开存，供调用方切换展示） */
const lyricsCache = new Map<string, StemLyrics | undefined>()

/** 命中缓存的歌词；未加载 / 无歌词返回 undefined。 */
export function getCachedStemLyrics(trackId: string | undefined): StemLyrics | undefined {
  if (!trackId) return undefined
  return lyricsCache.get(trackId)
}

/** 清空歌词缓存（重新分轨 / 换歌时调用）。 */
export function clearStemLyricsCache(trackId?: string): void {
  if (trackId) {
    lyricsCache.delete(trackId)
    return
  }
  lyricsCache.clear()
}

/**
 * 确保指定曲目的分轨包内歌词已就绪（轻量读 manifest，不解 PCM）。
 * aligned 来自对齐结果 alignedLrc（逐字时间戳），raw 来自原始 lyrics（清洗后纯文本），
 * lrc 来自 lyricsLrc（导入时的原始 .lrc 文本，含行时间戳），三者相互独立、分别可缺失。
 * 无侧车 / 包内无歌词 → undefined（调用方可回退 .lrc 等其它来源）。
 * 结果按 trackId 缓存。
 */
export async function ensureStemLyrics(input: {
  trackId: string
  vfsRef: string | undefined
}): Promise<StemLyrics | undefined> {
  const cached = lyricsCache.get(input.trackId)
  if (cached !== undefined) return cached

  const manifest = await readStemsSidecarManifest(input.vfsRef)
  const lyrics: StemLyrics | undefined =
    manifest &&
    (manifest.alignedLrc !== undefined ||
      manifest.lyrics !== undefined ||
      manifest.lyricsLrc !== undefined)
      ? {
          aligned: manifest.alignedLrc,
          raw: manifest.lyrics,
          lrc: manifest.lyricsLrc,
        }
      : undefined
  lyricsCache.set(input.trackId, lyrics)
  return lyrics
}
