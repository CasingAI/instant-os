import VscodeTypescriptResolveWorker from './vscode-typescript-resolve.worker.ts?worker'
import {
  clearTypescriptResolveCaches,
  resolveBareModulesForEntriesCore,
} from './vscode-typescript-resolve-core.ts'
import type {
  VscodeTypescriptResolveEntry,
  VscodeTypescriptResolveResult,
  VscodeTypescriptResolveWorkerRequest,
  VscodeTypescriptResolveWorkerResponse,
} from './vscode-typescript-resolve-protocol.ts'

type PendingResolve = {
  resolve: (result: VscodeTypescriptResolveResult) => void
  reject: (error: Error) => void
}

let worker: Worker | undefined
let workerFailed = false
let nextRequestId = 1
const pending = new Map<number, PendingResolve>()

function getWorker(): Worker | undefined {
  if (workerFailed) return undefined
  if (worker) return worker

  try {
    const instance = new VscodeTypescriptResolveWorker()
    instance.onmessage = (event: MessageEvent<VscodeTypescriptResolveWorkerResponse>) => {
      const message = event.data
      const job = pending.get(message.requestId)
      if (!job) return
      pending.delete(message.requestId)
      if (message.type === 'done') {
        job.resolve(message.result)
        return
      }
      job.reject(new Error(message.message))
    }
    instance.onerror = () => {
      workerFailed = true
      for (const [id, job] of pending) {
        pending.delete(id)
        job.reject(new Error('TypeScript 解析 Worker 失败'))
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

export type ResolveBareModulesClientParams = {
  workspaceFolder: string
  entries: readonly VscodeTypescriptResolveEntry[]
  maxPackageFilesTotal: number
  maxPackageFilesPerResolve: number
  clearMissing?: boolean
  signal?: AbortSignal
}

/**
 * 在 Worker 中解析裸包；不可用时回退主线程。
 */
export async function resolveBareModulesForEntries(
  params: ResolveBareModulesClientParams,
): Promise<VscodeTypescriptResolveResult> {
  const instance = getWorker()
  if (!instance) {
    return resolveBareModulesForEntriesCore(params)
  }

  const requestId = nextRequestId
  nextRequestId += 1

  return new Promise<VscodeTypescriptResolveResult>((resolve, reject) => {
    const onAbort = () => {
      instance.postMessage({
        type: 'abort',
        requestId,
      } satisfies VscodeTypescriptResolveWorkerRequest)
      pending.delete(requestId)
      resolve({ files: [] })
    }

    if (params.signal?.aborted) {
      resolve({ files: [] })
      return
    }

    pending.set(requestId, {
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
      type: 'resolve',
      requestId,
      workspaceFolder: params.workspaceFolder,
      entries: [...params.entries],
      maxPackageFilesTotal: params.maxPackageFilesTotal,
      maxPackageFilesPerResolve: params.maxPackageFilesPerResolve,
      clearMissing: params.clearMissing === true,
    } satisfies VscodeTypescriptResolveWorkerRequest)
  }).catch(async (error) => {
    if (params.signal?.aborted) return { files: [] }
    console.warn('[vscode-typescript-resolve] Worker 失败，回退主线程', error)
    return resolveBareModulesForEntriesCore(params)
  })
}

export function clearBareModulesResolveState(): void {
  clearTypescriptResolveCaches()
  const instance = getWorker()
  if (!instance) return
  const requestId = nextRequestId
  nextRequestId += 1
  instance.postMessage({ type: 'clear', requestId } satisfies VscodeTypescriptResolveWorkerRequest)
}
