import VscodeWorkspaceSearchWorker from './vscode-workspace-search.worker.ts?worker'
import {
  matchVscodeOpenFiles,
  searchVscodeWorkspaceFilesCore,
  type VscodeWorkspaceSearchHit,
  type VscodeWorkspaceSearchOpenFile,
  type VscodeWorkspaceSearchParams,
} from './vscode-workspace-search-core.ts'
import type {
  VscodeWorkspaceSearchWorkerRequest,
  VscodeWorkspaceSearchWorkerResponse,
} from './vscode-workspace-search-protocol.ts'

export type {
  VscodeWorkspaceSearchHit,
  VscodeWorkspaceSearchOpenFile,
  VscodeWorkspaceSearchParams,
}

export { matchVscodeOpenFiles }

type PendingSearch = {
  onProgress?: (hits: VscodeWorkspaceSearchHit[]) => void
  resolve: (hits: VscodeWorkspaceSearchHit[]) => void
  reject: (error: Error) => void
}

let worker: Worker | undefined
let workerFailed = false
let nextRequestId = 1
const pending = new Map<number, PendingSearch>()

function getWorker(): Worker | undefined {
  if (workerFailed) return undefined
  if (worker) return worker

  try {
    const instance = new VscodeWorkspaceSearchWorker()
    instance.onmessage = (event: MessageEvent<VscodeWorkspaceSearchWorkerResponse>) => {
      const message = event.data
      const job = pending.get(message.requestId)
      if (!job) return

      if (message.type === 'progress') {
        job.onProgress?.(message.hits)
        return
      }

      pending.delete(message.requestId)
      if (message.type === 'done') {
        job.resolve(message.hits)
        return
      }
      job.reject(new Error(message.message))
    }
    instance.onerror = () => {
      workerFailed = true
      for (const [id, job] of pending) {
        pending.delete(id)
        job.reject(new Error('搜索 Worker 失败'))
      }
      worker?.terminate()
      worker = undefined
    }
    worker = instance
    return worker
  } catch {
    workerFailed = true
    return undefined
  }
}

/**
 * 在 Web Worker 中扫描工作区未打开文件；Worker 不可用时回退到主线程。
 * 调用方应将 matchVscodeOpenFiles 的结果排在本函数结果之前。
 */
export async function searchVscodeWorkspaceFiles(
  params: VscodeWorkspaceSearchParams,
): Promise<VscodeWorkspaceSearchHit[]> {
  const query = params.query.trim()
  if (!query || !params.workspaceFolder) return []

  const instance = getWorker()
  if (!instance) {
    return searchVscodeWorkspaceFilesCore(params)
  }

  const requestId = nextRequestId
  nextRequestId += 1
  const skipPaths = [...(params.skipPaths instanceof Set ? params.skipPaths : params.skipPaths)]

  return new Promise<VscodeWorkspaceSearchHit[]>((resolve, reject) => {
    const onAbort = () => {
      instance.postMessage({ type: 'abort', requestId } satisfies VscodeWorkspaceSearchWorkerRequest)
      pending.delete(requestId)
      resolve([])
    }

    if (params.signal?.aborted) {
      resolve([])
      return
    }

    pending.set(requestId, {
      onProgress: params.onProgress,
      resolve: (hits) => {
        params.signal?.removeEventListener('abort', onAbort)
        resolve(hits)
      },
      reject: (error) => {
        params.signal?.removeEventListener('abort', onAbort)
        reject(error)
      },
    })

    params.signal?.addEventListener('abort', onAbort, { once: true })

    instance.postMessage({
      type: 'search',
      requestId,
      query,
      skipPaths,
      workspaceFolder: params.workspaceFolder!,
    } satisfies VscodeWorkspaceSearchWorkerRequest)
  }).catch(async (error) => {
    if (params.signal?.aborted) return []
    console.warn('[vscode-workspace-search] Worker 失败，回退主线程', error)
    return searchVscodeWorkspaceFilesCore(params)
  })
}
