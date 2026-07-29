import VscodeWorkspaceSearchWorker from './vscode-workspace-search.worker.ts?worker'
import { isWorkerHeapSampleMessage } from '../../os/worker-heap-sampler.ts'
import {
  removeWorkerHeapReport,
  upsertWorkerHeapReport,
} from '../../os/worker-heap-reports.ts'
import {
  matchVscodeOpenFiles,
  searchVscodeWorkspaceFilesCoreDetailed,
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

export type VscodeWorkspaceSearchClientResult = {
  hits: VscodeWorkspaceSearchHit[]
  patternError: string | undefined
}

type PendingSearch = {
  onProgress?: (hits: VscodeWorkspaceSearchHit[]) => void
  resolve: (result: VscodeWorkspaceSearchClientResult) => void
  reject: (error: Error) => void
}

const SERVICE_ID = 'vscode-workspace-search' as const

let worker: Worker | undefined
let workerFailed = false
let nextRequestId = 1
const pending = new Map<number, PendingSearch>()

function clearWorkerHeap(): void {
  removeWorkerHeapReport(SERVICE_ID)
}

function registerWorkerAlive(): void {
  upsertWorkerHeapReport({
    id: SERVICE_ID,
    usedBytes: undefined,
    totalBytes: undefined,
    limitBytes: undefined,
    memorySupported: false,
  })
}

function getWorker(): Worker | undefined {
  if (workerFailed) return undefined
  if (worker) return worker

  try {
    const instance = new VscodeWorkspaceSearchWorker()
    instance.onmessage = (event: MessageEvent<VscodeWorkspaceSearchWorkerResponse>) => {
      const message = event.data
      if (isWorkerHeapSampleMessage(message)) {
        upsertWorkerHeapReport({
          id: SERVICE_ID,
          usedBytes: message.usedBytes,
          totalBytes: message.totalBytes,
          limitBytes: message.limitBytes,
          memorySupported: message.memorySupported,
        })
        return
      }
      const job = pending.get(message.requestId)
      if (!job) return

      if (message.type === 'progress') {
        job.onProgress?.(message.hits)
        return
      }

      pending.delete(message.requestId)
      if (message.type === 'done') {
        job.resolve({ hits: message.hits, patternError: message.patternError })
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
      clearWorkerHeap()
    }
    worker = instance
    registerWorkerAlive()
    return worker
  } catch {
    workerFailed = true
    clearWorkerHeap()
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
  const result = await searchVscodeWorkspaceFilesDetailed(params)
  return result.hits
}

export async function searchVscodeWorkspaceFilesDetailed(
  params: VscodeWorkspaceSearchParams,
): Promise<VscodeWorkspaceSearchClientResult> {
  const query = params.query.trim()
  if (!query || !params.workspaceFolder) return { hits: [], patternError: undefined }
  if (params.onlyOpenEditors) return { hits: [], patternError: undefined }

  const instance = getWorker()
  if (!instance) {
    return searchVscodeWorkspaceFilesCoreDetailed(params)
  }

  const requestId = nextRequestId
  nextRequestId += 1
  const skipPaths = [...(params.skipPaths instanceof Set ? params.skipPaths : params.skipPaths)]
  const onlyPaths = params.onlyPaths
    ? [...(params.onlyPaths instanceof Set ? params.onlyPaths : params.onlyPaths)]
    : undefined

  return new Promise<VscodeWorkspaceSearchClientResult>((resolve, reject) => {
    const onAbort = () => {
      instance.postMessage({ type: 'abort', requestId } satisfies VscodeWorkspaceSearchWorkerRequest)
      pending.delete(requestId)
      resolve({ hits: [], patternError: undefined })
    }

    if (params.signal?.aborted) {
      resolve({ hits: [], patternError: undefined })
      return
    }

    pending.set(requestId, {
      onProgress: params.onProgress,
      resolve: (result) => {
        params.signal?.removeEventListener('abort', onAbort)
        resolve(result)
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
      isCaseSensitive: params.isCaseSensitive,
      matchWholeWord: params.matchWholeWord,
      isRegex: params.isRegex,
      filesToInclude: params.filesToInclude,
      filesToExclude: params.filesToExclude,
      useExcludeSettingsAndIgnoreFiles: params.useExcludeSettingsAndIgnoreFiles,
      onlyOpenEditors: params.onlyOpenEditors,
      onlyPaths,
      contextLines: params.contextLines,
    } satisfies VscodeWorkspaceSearchWorkerRequest)
  }).catch(async (error) => {
    if (params.signal?.aborted) return { hits: [], patternError: undefined }
    console.warn('[vscode-workspace-search] Worker 失败，回退主线程', error)
    return searchVscodeWorkspaceFilesCoreDetailed(params)
  })
}
