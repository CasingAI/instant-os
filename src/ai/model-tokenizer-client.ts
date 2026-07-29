import type { AiTokenizerFamily } from './ai-providers.ts'
import ModelTokenizerWorker from './model-tokenizer.worker.ts?worker'
import type {
  ModelTokenizerWorkerRequest,
  ModelTokenizerWorkerResponse,
} from './model-tokenizer-protocol.ts'

type TokenizerFamily = AiTokenizerFamily

type PendingJob = {
  resolve: (value: ModelTokenizerWorkerResponse) => void
  reject: (error: Error) => void
}

let worker: Worker | undefined
let workerFailed = false
let nextRequestId = 1
const pending = new Map<number, PendingJob>()
const readyFamilies = new Set<TokenizerFamily>()
const loadInflight = new Map<TokenizerFamily, Promise<boolean>>()

function getWorker(): Worker | undefined {
  if (workerFailed) return undefined
  if (worker) return worker

  try {
    const instance = new ModelTokenizerWorker()
    instance.onmessage = (event: MessageEvent<ModelTokenizerWorkerResponse>) => {
      const message = event.data
      const job = pending.get(message.requestId)
      if (!job) return
      pending.delete(message.requestId)
      job.resolve(message)
    }
    instance.onerror = () => {
      workerFailed = true
      for (const [id, job] of pending) {
        pending.delete(id)
        job.reject(new Error('Tokenizer Worker 失败'))
      }
      worker?.terminate()
      worker = undefined
      readyFamilies.clear()
    }
    worker = instance
    return worker
  } catch {
    workerFailed = true
    return undefined
  }
}

function request(
  instance: Worker,
  payload: Omit<ModelTokenizerWorkerRequest, 'requestId'> & { type: 'load' | 'count' },
): Promise<ModelTokenizerWorkerResponse> {
  const requestId = nextRequestId
  nextRequestId += 1

  return new Promise<ModelTokenizerWorkerResponse>((resolve, reject) => {
    pending.set(requestId, { resolve, reject })
    instance.postMessage({ ...payload, requestId } satisfies ModelTokenizerWorkerRequest)
  })
}

export function isTokenizerWorkerFailed(): boolean {
  return workerFailed
}

export function getReadyTokenizerFamilies(): TokenizerFamily[] {
  return [...readyFamilies]
}

export function isTokenizerFamilyReady(family: TokenizerFamily): boolean {
  return readyFamilies.has(family)
}

/** 在 Worker 中加载词表；失败返回 false（不回退主线程 encode） */
export async function loadTokenizerFamilyInWorker(
  family: TokenizerFamily,
): Promise<boolean> {
  if (readyFamilies.has(family)) return true

  const inflight = loadInflight.get(family)
  if (inflight) return inflight

  const promise = (async () => {
    const instance = getWorker()
    if (!instance) return false

    try {
      const response = await request(instance, { type: 'load', family })
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
      console.warn('[model-tokenizer] Worker load failed', error)
      return false
    }
  })().finally(() => {
    loadInflight.delete(family)
  })

  loadInflight.set(family, promise)
  return promise
}

/**
 * 在 Worker 中批量分词。family 未 ready 时会先尝试 load。
 * Worker 不可用或失败时返回 undefined。
 */
export async function countTokensInWorker(
  family: TokenizerFamily,
  texts: string[],
): Promise<number[] | undefined> {
  if (texts.length === 0) return []

  const instance = getWorker()
  if (!instance) return undefined

  if (!readyFamilies.has(family)) {
    const ok = await loadTokenizerFamilyInWorker(family)
    if (!ok) return undefined
  }

  try {
    const response = await request(instance, { type: 'count', family, texts })
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
    console.warn('[model-tokenizer] Worker count failed', error)
    return undefined
  }
}
