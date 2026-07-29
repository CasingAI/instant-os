import type { AiTokenizerFamily } from './ai-providers.ts'
import ModelTokenizerWorker from './model-tokenizer.worker.ts?worker'
import { defineService } from '../os/service-supervisor.ts'
import type {
  ModelTokenizerWorkerRequest,
  ModelTokenizerWorkerResponse,
} from './model-tokenizer-protocol.ts'

type TokenizerFamily = AiTokenizerFamily
type TokenizerResponse = Exclude<ModelTokenizerWorkerResponse, { type: 'heap' }>

const readyFamilies = new Set<TokenizerFamily>()
const loadInflight = new Map<TokenizerFamily, Promise<boolean>>()

const service = defineService<ModelTokenizerWorkerRequest, TokenizerResponse>({
  id: 'tokenizer',
  createWorker: () => new ModelTokenizerWorker(),
  onRestarted: () => {
    // 新 Worker 词表缓存为空，清除 ready 标记以便下次请求重新加载
    readyFamilies.clear()
  },
})

export function getReadyTokenizerFamilies(): TokenizerFamily[] {
  return [...readyFamilies]
}

export function isTokenizerFamilyReady(family: TokenizerFamily): boolean {
  return readyFamilies.has(family)
}

/** 在服务 Worker 中加载词表；失败返回 false（主线程永不 encode） */
export async function loadTokenizerFamilyInWorker(
  family: TokenizerFamily,
): Promise<boolean> {
  if (readyFamilies.has(family)) return true

  const inflight = loadInflight.get(family)
  if (inflight) return inflight

  const promise = (async () => {
    try {
      const response = await service.request<TokenizerResponse>({ type: 'load', family })
      if (response.type === 'ready' && response.ok) {
        // Worker LRU 容量为 1：新 family 成功后淘汰其它 ready 标记
        readyFamilies.clear()
        readyFamilies.add(family)
        return true
      }
      if (response.type === 'error') {
        console.warn('[model-tokenizer] Worker load error', response.message)
      }
      return false
    } catch (error) {
      console.warn('[model-tokenizer] 服务不可用', error)
      return false
    }
  })().finally(() => {
    loadInflight.delete(family)
  })

  loadInflight.set(family, promise)
  return promise
}

/**
 * 在服务 Worker 中批量分词。family 未 ready 时会先尝试 load。
 * 服务不可用时返回 undefined（交给字符粗估）。
 */
export async function countTokensInWorker(
  family: TokenizerFamily,
  texts: string[],
): Promise<number[] | undefined> {
  if (texts.length === 0) return []

  if (!readyFamilies.has(family)) {
    const ok = await loadTokenizerFamilyInWorker(family)
    if (!ok) return undefined
  }

  try {
    const response = await service.request<TokenizerResponse>({
      type: 'count',
      family,
      texts,
    })
    if (response.type === 'counts') {
      // count 可能隐式 load；与 load 路径一致维护 ready 集合
      if (!readyFamilies.has(family)) {
        readyFamilies.clear()
        readyFamilies.add(family)
      }
      return response.counts
    }
    if (response.type === 'error') {
      console.warn('[model-tokenizer] Worker count error', response.message)
    }
    return undefined
  } catch (error) {
    console.warn('[model-tokenizer] 服务不可用', error)
    return undefined
  }
}
