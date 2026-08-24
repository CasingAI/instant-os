import type { ArchiveWorkerRequest, ArchiveWorkerResponse } from './archive-worker.ts'

/**
 * 单次归档 Worker 任务的协调层：不依赖 Vite `?worker`，可注入假 Worker 做 node 单测。
 *
 * 每个任务自带一只 Worker；取消或结束只 terminate 这一只，不影响其他任务。
 */

export type ArchiveJobWorker = {
  postMessage: (message: ArchiveWorkerRequest, transfer?: Transferable[]) => void
  addEventListener: (type: 'message' | 'error', listener: (event: Event) => void) => void
  terminate: () => void
}

export type CreateArchiveJobWorker = () => ArchiveJobWorker

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'aborted')
}

export function throwIfArchiveAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new Error('aborted')
}

export async function runArchiveWorkerJob(params: {
  createWorker: CreateArchiveJobWorker
  request: ArchiveWorkerRequest
  transfer: Transferable[]
  signal?: AbortSignal
}): Promise<Exclude<ArchiveWorkerResponse, { type: 'error' }>> {
  throwIfArchiveAborted(params.signal)

  const worker = params.createWorker()
  let settled = false

  const terminateWorker = () => {
    try {
      worker.terminate()
    } catch {
      // terminate 重复调用视为无害
    }
  }

  const promise = new Promise<Exclude<ArchiveWorkerResponse, { type: 'error' }>>((resolve, reject) => {
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      params.signal?.removeEventListener('abort', onAbort)
      fn()
    }

    const onAbort = () => {
      settle(() => reject(new Error('aborted')))
    }

    const onMessage = (event: Event) => {
      const response = (event as MessageEvent<ArchiveWorkerResponse>).data
      if (!response || response.id !== params.request.id) return
      if (response.type === 'error') {
        settle(() => reject(new Error(response.message)))
        return
      }
      settle(() => resolve(response))
    }

    const onError = (event: Event) => {
      const message =
        'message' in event && typeof (event as ErrorEvent).message === 'string'
          ? (event as ErrorEvent).message
          : 'Archive worker 错误'
      settle(() => reject(new Error(message || 'Archive worker 错误')))
    }

    params.signal?.addEventListener('abort', onAbort, { once: true })
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)

    if (params.signal?.aborted) {
      onAbort()
      return
    }

    try {
      worker.postMessage(params.request, params.transfer)
    } catch (error) {
      settle(() =>
        reject(isAbortError(error) ? new Error('aborted') : error instanceof Error ? error : new Error(String(error))),
      )
    }
  })

  try {
    return await promise
  } finally {
    terminateWorker()
  }
}
