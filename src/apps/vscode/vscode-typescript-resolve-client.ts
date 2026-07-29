import VscodeTypescriptResolveWorker from './vscode-typescript-resolve.worker.ts?worker'
import { isWorkerHeapSampleMessage } from '../../os/worker-heap-sampler.ts'
import {
  removeWorkerHeapReport,
  upsertWorkerHeapReport,
} from '../../os/worker-heap-reports.ts'
import { appendVscodeInternalLog } from './vscode-internal-log.ts'
import {
  clearTypescriptResolveCaches,
  resolveBareModulesForEntriesCore,
} from './vscode-typescript-resolve-core.ts'
import { extractImportSpecs } from './vscode-typescript-module-resolve.ts'
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

const SERVICE_ID = 'vscode-typescript-resolve' as const

let worker: Worker | undefined
let workerFailed = false
let nextRequestId = 1
const pending = new Map<number, PendingResolve>()

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
    appendVscodeInternalLog('ts-resolve-worker', '启动 TypeScript 解析 Worker')
    const instance = new VscodeTypescriptResolveWorker()
    instance.onmessage = (event: MessageEvent<VscodeTypescriptResolveWorkerResponse>) => {
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
      pending.delete(message.requestId)
      if (message.type === 'done') {
        job.resolve(message.result)
        return
      }
      job.reject(new Error(message.message))
    }
    instance.onerror = () => {
      workerFailed = true
      appendVscodeInternalLog('ts-resolve-worker', 'Worker onerror，后续回退主线程', 'error')
      for (const [id, job] of pending) {
        pending.delete(id)
        job.reject(new Error('TypeScript 解析 Worker 失败'))
      }
      worker?.terminate()
      worker = undefined
      clearWorkerHeap()
    }
    worker = instance
    registerWorkerAlive()
    return worker
  } catch (error) {
    workerFailed = true
    clearWorkerHeap()
    appendVscodeInternalLog(
      'ts-resolve-worker',
      `Worker 创建失败: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    )
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

function entriesHaveBareImports(entries: readonly VscodeTypescriptResolveEntry[]): boolean {
  return entries.some((entry) => extractImportSpecs(entry.text).bare.length > 0)
}

function isEmptyResolveResult(result: VscodeTypescriptResolveResult): boolean {
  return result.files.length === 0 && (result.resolvedCount ?? 0) === 0
}

async function resolveViaWorker(
  instance: Worker,
  params: ResolveBareModulesClientParams,
): Promise<VscodeTypescriptResolveResult> {
  const requestId = nextRequestId
  nextRequestId += 1
  appendVscodeInternalLog('ts-resolve-worker', `请求 #${requestId} 发往 Worker`)

  return new Promise<VscodeTypescriptResolveResult>((resolve, reject) => {
    const onAbort = () => {
      instance.postMessage({
        type: 'abort',
        requestId,
      } satisfies VscodeTypescriptResolveWorkerRequest)
      pending.delete(requestId)
      appendVscodeInternalLog('ts-resolve-worker', `请求 #${requestId} 已取消`, 'warn')
      resolve({ files: [] })
    }

    if (params.signal?.aborted) {
      resolve({ files: [] })
      return
    }

    pending.set(requestId, {
      resolve: (result) => {
        params.signal?.removeEventListener('abort', onAbort)
        appendVscodeInternalLog(
          'ts-resolve-worker',
          `请求 #${requestId} 完成 files=${result.files.length} resolved=${result.resolvedCount ?? 0}`,
        )
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
  })
}

function replayResolveLogs(result: VscodeTypescriptResolveResult): void {
  for (const entry of result.logs ?? []) {
    appendVscodeInternalLog('ts-resolve', entry.message, entry.level)
  }
}

/**
 * 在 Worker 中解析裸包；不可用或空结果且存在 bare import 时回退主线程。
 */
export async function resolveBareModulesForEntries(
  params: ResolveBareModulesClientParams,
): Promise<VscodeTypescriptResolveResult> {
  const instance = getWorker()
  if (!instance) {
    appendVscodeInternalLog('ts-resolve-worker', '无 Worker，主线程解析')
    const result = await resolveBareModulesForEntriesCore(params)
    replayResolveLogs(result)
    return result
  }

  try {
    const result = await resolveViaWorker(instance, params)
    if (params.signal?.aborted) return result

    if (isEmptyResolveResult(result) && entriesHaveBareImports(params.entries)) {
      appendVscodeInternalLog('ts-resolve-worker', 'Worker 空结果，回退主线程', 'warn')
      replayResolveLogs(result)
      const fallback = await resolveBareModulesForEntriesCore(params)
      replayResolveLogs(fallback)
      return fallback
    }
    replayResolveLogs(result)
    return result
  } catch (error) {
    if (params.signal?.aborted) return { files: [] }
    appendVscodeInternalLog(
      'ts-resolve-worker',
      `Worker 失败，回退主线程: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    )
    const fallback = await resolveBareModulesForEntriesCore(params)
    replayResolveLogs(fallback)
    return fallback
  }
}

export function clearBareModulesResolveState(): void {
  clearTypescriptResolveCaches()
  const instance = getWorker()
  if (!instance) return
  const requestId = nextRequestId
  nextRequestId += 1
  instance.postMessage({ type: 'clear', requestId } satisfies VscodeTypescriptResolveWorkerRequest)
}
