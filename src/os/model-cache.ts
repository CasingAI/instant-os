/**
 * 模型缓存（浏览器 Cache API）。
 *
 * 与系统存储空间（IndexedDB / VFS）完全独立——这里用的是浏览器 CacheStorage，
 * 不占用系统「存储空间」视图里的任何配额，也不写进虚拟文件系统。
 *
 * 用途：把大体积模型权重（如 HTDemucs 6-stem ONNX，~285MB）先缓存进浏览器 Cache，
 * 之后每次按同一 URL 请求即可命中缓存、瞬间完成，避免重复下载。
 */

export const MODEL_CACHE_NAME = 'instant-model-cache'

/** 当前需要缓存的模型权重（与 docs/demucs-model-license.md 对应）。 */
export const DEMUCS_MODEL_URL = '/assets/demucs/models/htdemucs_6s.onnx'
export const DEMUCS_MODEL_LABEL = 'HTDemucs 6-stem（分轨模型）'
export const DEMUCS_MODEL_BYTES = 284_797_240

/** wav2vec2 音素识别模型（用于歌词强制对齐）。 */
export const PHONEME_MODEL_URL = '/assets/phoneme/models/model_q4.onnx'
export const PHONEME_MODEL_LABEL = 'wav2vec2 音素识别（歌词对齐）'
export const PHONEME_MODEL_BYTES = 241_691_639

/** MDX-NET 人声/伴奏 2-stem 模型（用于人声增强分离，仅输出伴奏，人声=原曲−伴奏）。 */
export const MDX_MODEL_URL = '/assets/mdx/models/UVR-MDX-NET-Inst_full_292.onnx'
export const MDX_MODEL_LABEL = 'MDX-NET 人声增强（伴奏模型）'
export const MDX_MODEL_BYTES = 66_759_214

function cacheHandle(): Promise<Cache> {
  if (typeof caches === 'undefined') {
    return Promise.reject(new Error('CacheStorage 不可用（非安全上下文或浏览器不支持）'))
  }
  return caches.open(MODEL_CACHE_NAME)
}

/** 权重是否已在浏览器缓存中。 */
export async function isModelCached(url: string = DEMUCS_MODEL_URL): Promise<boolean> {
  try {
    const cache = await cacheHandle()
    const response = await cache.match(url)
    return response !== undefined
  } catch {
    return false
  }
}

/**
 * 把 URL 对应的响应写入缓存。
 * 用流式 body 写入，避免一次性把 285MB 整块读进内存。
 */
export async function cacheModelUrl(url: string = DEMUCS_MODEL_URL): Promise<void> {
  const cache = await cacheHandle()
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`模型缓存失败：${response.status} ${response.statusText}`)
  }
  await cache.put(url, response)
}

/** 从缓存中清除指定 URL。 */
export async function clearModelCache(url: string = DEMUCS_MODEL_URL): Promise<void> {
  try {
    const cache = await cacheHandle()
    await cache.delete(url)
  } catch {
    // 不存在缓存时静默
  }
}

/** 缓存中该 URL 的字节数（无缓存返回 0）。 */
export async function getModelCacheBytes(url: string = DEMUCS_MODEL_URL): Promise<number> {
  try {
    const cache = await cacheHandle()
    const response = await cache.match(url)
    if (!response) return 0
    const contentLength = response.headers.get('content-length')
    if (contentLength !== null) return Number(contentLength)
    const body = await response.clone().arrayBuffer()
    return body.byteLength
  } catch {
    return 0
  }
}

/**
 * cache-first 读取：命中缓存直接返回，未命中才发起网络请求并写入缓存。
 * 供分轨推理等场景加载权重——首启需下载，之后秒开。
 */
export async function fetchModelWithCache(
  url: string = DEMUCS_MODEL_URL,
): Promise<Response> {
  const cache = await cacheHandle()
  const cached = await cache.match(url)
  if (cached) return cached
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`模型下载失败：${response.status} ${response.statusText}`)
  }
  await cache.put(url, response)
  const fresh = await cache.match(url)
  if (fresh) return fresh
  return fetch(url)
}
