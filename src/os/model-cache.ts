/**
 * 模型缓存（浏览器 Cache API）。
 *
 * 与系统存储空间（IndexedDB / VFS）完全独立——这里用的是浏览器 CacheStorage，
 * 不占用系统「存储空间」视图里的任何配额，也不写进虚拟文件系统。
 *
 * 默认从模型网关（R2 + PoW）拉取。开发者选项可改回同源 `/assets`
 * （本机 `public/assets` 或站点上若存在该文件）。缓存键始终用本地 URL。
 *
 * 编译后若仍只打到本站 `/assets/...onnx`，SPA 会回退 `index.html`（约 5KB）。
 * 写入 / 命中缓存前必须确认响应是大体积权重，误缓存的页面直接丢掉。
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { MODEL_GATEWAY_ORIGIN } from './model-gateway.ts'
import { resolveModelSource } from './model-source-settings-storage.ts'
import { solvePowForBody } from './pow-client.ts'

export const MODEL_CACHE_NAME = 'instant-model-cache'

/** 当前需要缓存的模型权重（与 docs/demucs-model-license.md 对应）。 */
export const DEMUCS_MODEL_URL = '/assets/demucs/models/htdemucs_6s.onnx'
export const DEMUCS_MODEL_LABEL = 'HTDemucs 6-stem（分轨模型）'
export const DEMUCS_MODEL_BYTES = 284_797_240
export const DEMUCS_MODEL_SHA256 =
  'a3f5050696cda4b2344d465123acb21ee699dad7d0634dba1d282497a04ac86a'

/** Zipformer-CTC 中文识别模型（sherpa-onnx，字级时间戳，用于歌词对齐）。 */
export const ZIPFORMER_MODEL_URL = '/assets/zipformer-ctc/models/model.int8.onnx'
export const ZIPFORMER_MODEL_LABEL = 'Zipformer-CTC 中文识别（歌词对齐）'
export const ZIPFORMER_MODEL_BYTES = 367_074_356
export const ZIPFORMER_MODEL_SHA256 =
  'e291b9c468b651e2697caa09bc684326c3addc6a019e78eb537cfd1a8248ca07'

/** Zipformer-CTC 英文识别模型（sherpa-onnx zipformer-ctc-en，LibriSpeech，用于歌词英文段强制对齐）。 */
export const ZIPFORMER_EN_MODEL_URL = '/assets/zipformer-ctc-en/models/model.int8.onnx'
export const ZIPFORMER_EN_MODEL_LABEL = 'Zipformer-CTC 英文识别（歌词对齐英文段）'
export const ZIPFORMER_EN_MODEL_BYTES = 70_239_299
export const ZIPFORMER_EN_MODEL_SHA256 =
  'dc67cb957de8685201fe6a2858fe9f82ed8c8b5799742fbec564bc0889b57be8'
export const ZIPFORMER_EN_TOKENS_URL = '/assets/zipformer-ctc-en/models/tokens.txt'
export const ZIPFORMER_TOKENS_URL = '/assets/zipformer-ctc/tokens.txt'
export const SENSE_VOICE_TOKENS_URL = '/assets/sense-voice/tokens.txt'
export const SENSE_VOICE_META_URL = '/assets/sense-voice/meta.json'

/** SenseVoice 五语识别模型（sherpa-onnx，中英日韩粤，逐 token 时间戳，用于歌词对齐）。 */
export const SENSE_VOICE_MODEL_URL = '/assets/sense-voice/models/model.int8.onnx'
export const SENSE_VOICE_MODEL_LABEL = 'SenseVoice 五语识别（歌词对齐）'
export const SENSE_VOICE_MODEL_BYTES = 237_115_547
export const SENSE_VOICE_MODEL_SHA256 =
  '12ca1a2ae7ecf3e0019ef2822307ee0b5cadc9196569e379b4c4026f8205276d'

/** MDX-NET 人声/伴奏 2-stem 模型（用于人声增强分离，仅输出伴奏，人声=原曲−伴奏）。 */
export const MDX_MODEL_URL = '/assets/mdx/models/UVR-MDX-NET-Inst_full_292.onnx'
export const MDX_MODEL_LABEL = 'MDX-NET 人声增强（伴奏模型）'
export const MDX_MODEL_BYTES = 66_759_214
export const MDX_MODEL_SHA256 =
  '020f6b65fa219fb7c285e4f3fc2863bf22daf03c4c93e547b6d13d5f2757a7ec'

export type ModelCacheEntry = {
  url: string
  label: string
  totalBytes: number
  /** 未压缩 ONNX 的 SHA-256（小写 hex），用于本地导入校验 */
  sha256: string
}

/** 设置「模型缓存」页与预缓存入口共用的清单。 */
export const MODEL_CACHE_ENTRIES: readonly ModelCacheEntry[] = [
  {
    url: DEMUCS_MODEL_URL,
    label: DEMUCS_MODEL_LABEL,
    totalBytes: DEMUCS_MODEL_BYTES,
    sha256: DEMUCS_MODEL_SHA256,
  },
  {
    url: MDX_MODEL_URL,
    label: MDX_MODEL_LABEL,
    totalBytes: MDX_MODEL_BYTES,
    sha256: MDX_MODEL_SHA256,
  },
  {
    url: ZIPFORMER_MODEL_URL,
    label: ZIPFORMER_MODEL_LABEL,
    totalBytes: ZIPFORMER_MODEL_BYTES,
    sha256: ZIPFORMER_MODEL_SHA256,
  },
  {
    url: ZIPFORMER_EN_MODEL_URL,
    label: ZIPFORMER_EN_MODEL_LABEL,
    totalBytes: ZIPFORMER_EN_MODEL_BYTES,
    sha256: ZIPFORMER_EN_MODEL_SHA256,
  },
  {
    url: SENSE_VOICE_MODEL_URL,
    label: SENSE_VOICE_MODEL_LABEL,
    totalBytes: SENSE_VOICE_MODEL_BYTES,
    sha256: SENSE_VOICE_MODEL_SHA256,
  },
]

const HTML_SNIFF = /^\s*<(!doctype|html|head|script|title)/i

function entryFor(url: string): ModelCacheEntry | undefined {
  return MODEL_CACHE_ENTRIES.find((entry) => entry.url === url)
}

function minValidBytes(expectedBytes: number): number {
  if (expectedBytes > 0) {
    return Math.max(1_000_000, Math.floor(expectedBytes * 0.5))
  }
  return 1_000_000
}

function declaredLength(response: Response): number {
  const raw = response.headers.get('content-length') ?? response.headers.get('x-linked-size')
  if (raw === null) return 0
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function contentTypeLooksLikePage(response: Response): boolean {
  const type = (response.headers.get('content-type') ?? '').toLowerCase()
  return (
    type.includes('text/html') ||
    type.includes('text/javascript') ||
    type.includes('application/javascript') ||
    type.includes('application/json')
  )
}

/**
 * 用响应头判断是否像真实权重。不读 body，避免把 300MB 拉进内存。
 * SPA 回退的 index.html（text/html · ~5KB）会失败。
 */
function headersLookLikeModel(response: Response, expectedBytes: number): boolean {
  if (!response.ok) return false
  if (contentTypeLooksLikePage(response)) return false
  const length = declaredLength(response)
  if (length > 0 && length < minValidBytes(expectedBytes)) return false
  return true
}

async function bodySniffsLikeHtml(response: Response): Promise<boolean> {
  const body = response.clone().body
  if (!body) return false
  const reader = body.getReader()
  try {
    const first = await reader.read()
    if (first.done || !first.value || first.value.byteLength === 0) return true
    const head = new TextDecoder().decode(first.value.subarray(0, 64))
    return HTML_SNIFF.test(head)
  } catch {
    return false
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

async function responseLooksLikeModel(
  response: Response,
  expectedBytes: number,
): Promise<boolean> {
  if (!headersLookLikeModel(response, expectedBytes)) return false
  if (declaredLength(response) > 0) return true
  return !(await bodySniffsLikeHtml(response))
}

async function fetchProtected(url: string, signal?: AbortSignal): Promise<Response> {
  const source = await resolveModelSource()
  if (source === 'local') {
    return fetch(url, { cache: 'no-store', signal })
  }
  const pathBytes = new TextEncoder().encode(url)
  const powHeaders = await solvePowForBody(MODEL_GATEWAY_ORIGIN, pathBytes, signal, 'sequential')
  return fetch(`${MODEL_GATEWAY_ORIGIN}${url}`, {
    cache: 'no-store',
    signal,
    headers: powHeaders,
  })
}

/**
 * 拉 tokens / meta 等附属文件。来源与权重相同（开发者选项：远端网关或同源 /assets）。
 */
export async function fetchModelAsset(url: string, signal?: AbortSignal): Promise<Response> {
  const response = await fetchProtected(url, signal)
  if (!response.ok) {
    throw new Error(`资源下载失败：${url}（HTTP ${response.status}）`)
  }
  return response
}

async function fetchValidModelResponse(url: string): Promise<Response> {
  const expectedBytes = entryFor(url)?.totalBytes ?? 0
  const response = await fetchProtected(url)
  if (await responseLooksLikeModel(response, expectedBytes)) {
    return response
  }
  const length = declaredLength(response)
  const type = response.headers.get('content-type') ?? 'unknown'
  throw new Error(
    `模型下载失败：${url} 返回的不是权重文件（HTTP ${response.status} · ${type}` +
      `${length > 0 ? ` · ${length}B` : ''}）。编译部署的站点不含这些大文件。`,
  )
}

function cacheHandle(): Promise<Cache> {
  if (typeof caches === 'undefined') {
    return Promise.reject(new Error('CacheStorage 不可用（非安全上下文或浏览器不支持）'))
  }
  return caches.open(MODEL_CACHE_NAME)
}

async function matchValidCached(url: string): Promise<Response | undefined> {
  const cache = await cacheHandle()
  const cached = await cache.match(url)
  if (!cached) return undefined
  const expectedBytes = entryFor(url)?.totalBytes ?? 0
  if (await responseLooksLikeModel(cached, expectedBytes)) {
    return cached
  }
  await cache.delete(url)
  return undefined
}

/** 权重是否已在浏览器缓存中（排除误缓存的 HTML 页面）。 */
export async function isModelCached(url: string = DEMUCS_MODEL_URL): Promise<boolean> {
  try {
    return (await matchValidCached(url)) !== undefined
  } catch {
    return false
  }
}

export type ModelDownloadProgress = {
  phase: 'prepare' | 'download' | 'verify' | 'write'
  receivedBytes: number
  totalBytes: number
  ratio: number
  remainingMs: number
}

function notifyDownloadProgress(
  onProgress: ((progress: ModelDownloadProgress) => void) | undefined,
  progress: ModelDownloadProgress,
): void {
  if (!onProgress) return
  try {
    onProgress(progress)
  } catch {
    // 进度回调失败不影响下载
  }
}

function attachDownloadProgress(
  response: Response,
  expectedBytes: number,
  onProgress: (progress: ModelDownloadProgress) => void,
): Response {
  const body = response.body
  if (!body) return response

  const headerLength = declaredLength(response)
  let total = headerLength > 0 ? headerLength : expectedBytes
  let received = 0
  const startedAt = performance.now()
  let lastEmitAt = 0

  const emit = (done = false) => {
    if (expectedBytes > total && received > total) {
      total = expectedBytes
    }
    if (received > total) total = received
    const elapsed = performance.now() - startedAt
    const remainingMs =
      done || (total > 0 && received >= total)
        ? 0
        : received > 0 && elapsed >= 80
          ? Math.max(0, ((total - received) * elapsed) / received)
          : Number.POSITIVE_INFINITY
    notifyDownloadProgress(onProgress, {
      phase: 'download',
      receivedBytes: received,
      totalBytes: total > 0 ? total : expectedBytes,
      ratio: total > 0 ? Math.min(1, received / total) : 0,
      remainingMs,
    })
  }

  const transformer = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength
      const now = performance.now()
      if (now - lastEmitAt >= 200) {
        lastEmitAt = now
        emit()
      }
      controller.enqueue(chunk)
    },
    flush() {
      emit(true)
    },
  })

  return new Response(body.pipeThrough(transformer), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

/**
 * 把 URL 对应的响应写入缓存。
 * 用流式 body 写入，避免一次性把整块读进内存。
 */
export async function cacheModelUrl(
  url: string = DEMUCS_MODEL_URL,
  onProgress?: (progress: ModelDownloadProgress) => void,
): Promise<void> {
  notifyDownloadProgress(onProgress, {
    phase: 'prepare',
    receivedBytes: 0,
    totalBytes: entryFor(url)?.totalBytes ?? 0,
    ratio: 0,
    remainingMs: Number.POSITIVE_INFINITY,
  })
  const cache = await cacheHandle()
  const response = await fetchValidModelResponse(url)
  const expectedBytes = entryFor(url)?.totalBytes ?? declaredLength(response)
  const tracked = onProgress
    ? attachDownloadProgress(response, expectedBytes, onProgress)
    : response
  await cache.put(url, tracked)
}

export function assertImportedModelSize(entry: ModelCacheEntry, size: number): void {
  if (size !== entry.totalBytes) {
    throw new Error(`所选文件大小与「${entry.label}」不符，不是这份权重。`)
  }
}

export function assertImportedModelHash(entry: ModelCacheEntry, sha256Hex: string): void {
  if (sha256Hex.trim().toLowerCase() !== entry.sha256) {
    throw new Error(`所选文件不是「${entry.label}」（SHA-256 不匹配）。`)
  }
}

export async function sha256HexFromBlob(
  blob: Blob,
  onProgress?: (receivedBytes: number, totalBytes: number) => void,
): Promise<string> {
  const hasher = sha256.create()
  const reader = blob.stream().getReader()
  let received = 0
  const total = blob.size
  let lastEmitAt = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      hasher.update(value)
      received += value.byteLength
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      if (now - lastEmitAt >= 80) {
        lastEmitAt = now
        onProgress?.(received, total)
      }
    }
  } finally {
    reader.releaseLock()
  }
  onProgress?.(received, total)
  return bytesToHex(hasher.digest())
}

/**
 * 把本地选中的 ONNX 写入模型缓存。先按清单校验大小和 SHA-256，不对则拒绝。
 */
export async function importModelFromBlob(
  url: string,
  blob: Blob,
  onProgress?: (progress: ModelDownloadProgress) => void,
): Promise<void> {
  const entry = entryFor(url)
  if (!entry) {
    throw new Error(`未知模型：${url}`)
  }
  assertImportedModelSize(entry, blob.size)
  notifyDownloadProgress(onProgress, {
    phase: 'verify',
    receivedBytes: 0,
    totalBytes: entry.totalBytes,
    ratio: 0,
    remainingMs: Number.POSITIVE_INFINITY,
  })
  const digest = await sha256HexFromBlob(blob, (receivedBytes, totalBytes) => {
    notifyDownloadProgress(onProgress, {
      phase: 'verify',
      receivedBytes,
      totalBytes,
      ratio: totalBytes > 0 ? Math.min(1, receivedBytes / totalBytes) : 0,
      remainingMs: Number.POSITIVE_INFINITY,
    })
  })
  assertImportedModelHash(entry, digest)
  notifyDownloadProgress(onProgress, {
    phase: 'write',
    receivedBytes: entry.totalBytes,
    totalBytes: entry.totalBytes,
    ratio: 1,
    remainingMs: 0,
  })
  const cache = await cacheHandle()
  await cache.put(
    url,
    new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(blob.size),
      },
    }),
  )
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

/** 缓存中该 URL 的字节数（无缓存或无效缓存返回 0）。 */
export async function getModelCacheBytes(url: string = DEMUCS_MODEL_URL): Promise<number> {
  try {
    const response = await matchValidCached(url)
    if (!response) return 0
    const length = declaredLength(response)
    if (length > 0) return length
    const body = await response.clone().arrayBuffer()
    return body.byteLength
  } catch {
    return 0
  }
}

/**
 * cache-first 读取：有效缓存直接返回，否则下载并写入缓存。
 * 供分轨推理等场景加载权重——首启需下载，之后秒开。
 */
export async function fetchModelWithCache(
  url: string = DEMUCS_MODEL_URL,
): Promise<Response> {
  const cached = await matchValidCached(url)
  if (cached) return cached
  const cache = await cacheHandle()
  const response = await fetchValidModelResponse(url)
  await cache.put(url, response)
  const fresh = await cache.match(url)
  if (fresh) return fresh
  return fetchValidModelResponse(url)
}
