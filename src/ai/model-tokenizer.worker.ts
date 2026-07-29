/// <reference lib="webworker" />

import { Tokenizer } from '@huggingface/tokenizers'
import { startWorkerHeapSampler } from '../os/worker-heap-sampler.ts'
import type {
  ModelTokenizerFamily,
  ModelTokenizerWorkerRequest,
  ModelTokenizerWorkerResponse,
} from './model-tokenizer-protocol.ts'

const TOKENIZER_ASSET_BASE = '/assets/tokenizers'
/** 超过此长度按块 encode，降低单次 BPE 中间结构峰值 */
const CHUNK_CHARS = 200_000
/** Worker 内最多常驻一个词表族 */
const CACHE_CAPACITY = 1

type CacheEntry = {
  family: ModelTokenizerFamily
  tokenizer: Tokenizer
}

const cache: CacheEntry[] = []
const abortControllers = new Map<number, AbortController>()

function post(message: ModelTokenizerWorkerResponse): void {
  self.postMessage(message)
}

startWorkerHeapSampler(post)

function touchCache(entry: CacheEntry): void {
  const index = cache.indexOf(entry)
  if (index > 0) {
    cache.splice(index, 1)
    cache.unshift(entry)
  }
}

function getCached(family: ModelTokenizerFamily): Tokenizer | undefined {
  const entry = cache.find((item) => item.family === family)
  if (!entry) return undefined
  touchCache(entry)
  return entry.tokenizer
}

function putCache(family: ModelTokenizerFamily, tokenizer: Tokenizer): void {
  const existing = cache.findIndex((item) => item.family === family)
  if (existing >= 0) {
    cache.splice(existing, 1)
  }
  cache.unshift({ family, tokenizer })
  while (cache.length > CACHE_CAPACITY) {
    cache.pop()
  }
}

async function fetchJson(url: string): Promise<object | undefined> {
  try {
    const response = await fetch(url)
    if (!response.ok) return undefined
    return (await response.json()) as object
  } catch {
    return undefined
  }
}

async function loadFamily(family: ModelTokenizerFamily): Promise<boolean> {
  if (getCached(family)) return true

  const base = `${TOKENIZER_ASSET_BASE}/${family}`
  const [tokenizerJson, tokenizerConfig] = await Promise.all([
    fetchJson(`${base}/tokenizer.json`),
    fetchJson(`${base}/tokenizer_config.json`),
  ])
  if (!tokenizerJson) return false

  try {
    const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig ?? {})
    putCache(family, tokenizer)
    return true
  } catch {
    return false
  }
}

function countOne(tokenizer: Tokenizer, text: string): number {
  if (!text) return 0
  if (text.length <= CHUNK_CHARS) {
    return tokenizer.encode(text, { add_special_tokens: false }).ids.length
  }

  let total = 0
  for (let offset = 0; offset < text.length; offset += CHUNK_CHARS) {
    const chunk = text.slice(offset, offset + CHUNK_CHARS)
    total += tokenizer.encode(chunk, { add_special_tokens: false }).ids.length
  }
  return total
}

function countTexts(family: ModelTokenizerFamily, texts: string[]): number[] | undefined {
  const tokenizer = getCached(family)
  if (!tokenizer) return undefined
  try {
    return texts.map((text) => countOne(tokenizer, text))
  } catch {
    return undefined
  }
}

self.onmessage = (event: MessageEvent<ModelTokenizerWorkerRequest>) => {
  const message = event.data

  if (message.type === 'abort') {
    const controller = abortControllers.get(message.requestId)
    controller?.abort()
    abortControllers.delete(message.requestId)
    return
  }

  const existing = abortControllers.get(message.requestId)
  existing?.abort()
  const controller = new AbortController()
  abortControllers.set(message.requestId, controller)

  if (message.type === 'load') {
    void loadFamily(message.family)
      .then((ok) => {
        if (controller.signal.aborted) return
        post({
          type: 'ready',
          requestId: message.requestId,
          family: message.family,
          ok,
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const messageText =
          error instanceof Error && error.message ? error.message : '词表加载失败'
        post({ type: 'error', requestId: message.requestId, message: messageText })
      })
      .finally(() => {
        if (abortControllers.get(message.requestId) === controller) {
          abortControllers.delete(message.requestId)
        }
      })
    return
  }

  if (message.type !== 'count') return

  void (async () => {
    try {
      if (!getCached(message.family)) {
        const ok = await loadFamily(message.family)
        if (!ok) {
          if (controller.signal.aborted) return
          post({
            type: 'error',
            requestId: message.requestId,
            message: `词表未加载: ${message.family}`,
          })
          return
        }
      }
      if (controller.signal.aborted) return
      const counts = countTexts(message.family, message.texts)
      if (counts === undefined) {
        post({
          type: 'error',
          requestId: message.requestId,
          message: `分词失败: ${message.family}`,
        })
        return
      }
      post({
        type: 'counts',
        requestId: message.requestId,
        family: message.family,
        counts,
      })
    } catch (error: unknown) {
      if (controller.signal.aborted) return
      const messageText =
        error instanceof Error && error.message ? error.message : '分词失败'
      post({ type: 'error', requestId: message.requestId, message: messageText })
    } finally {
      if (abortControllers.get(message.requestId) === controller) {
        abortControllers.delete(message.requestId)
      }
    }
  })()
}
