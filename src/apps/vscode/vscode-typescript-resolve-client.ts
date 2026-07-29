import VscodeTypescriptResolveWorker from './vscode-typescript-resolve.worker.ts?worker'
import { defineService } from '../../os/service-supervisor.ts'
import { appendVscodeInternalLog } from './vscode-internal-log.ts'
import type {
  VscodeTypescriptResolveEntry,
  VscodeTypescriptResolveResult,
  VscodeTypescriptResolveWorkerRequest,
  VscodeTypescriptResolveWorkerResponse,
} from './vscode-typescript-resolve-protocol.ts'

type ResolveResponse = Exclude<VscodeTypescriptResolveWorkerResponse, { type: 'heap' }>

const service = defineService<VscodeTypescriptResolveWorkerRequest, ResolveResponse>({
  id: 'vscode-typescript-resolve',
  description: 'TypeScript 裸包解析：在独立 Worker 中解析 import 路径与包文件，避免阻塞编辑器。',
  createWorker: () => new VscodeTypescriptResolveWorker(),
  onRestarted: () => {
    appendVscodeInternalLog('ts-resolve-worker', '服务 Worker 已启动', 'info')
  },
  onLog: (message, level) => {
    appendVscodeInternalLog('ts-resolve-worker', message, level)
  },
})

export type ResolveBareModulesClientParams = {
  workspaceFolder: string
  entries: readonly VscodeTypescriptResolveEntry[]
  maxPackageFilesTotal: number
  maxPackageFilesPerResolve: number
  clearMissing?: boolean
  signal?: AbortSignal
}

function replayResolveLogs(result: VscodeTypescriptResolveResult): void {
  for (const entry of result.logs ?? []) {
    appendVscodeInternalLog('ts-resolve', entry.message, entry.level)
  }
}

/**
 * 在解析服务 Worker 中解析裸包；服务不可用时返回空结果（主线程永不解析）。
 */
export async function resolveBareModulesForEntries(
  params: ResolveBareModulesClientParams,
): Promise<VscodeTypescriptResolveResult> {
  try {
    const result = await service.request<VscodeTypescriptResolveResult>(
      {
        type: 'resolve',
        workspaceFolder: params.workspaceFolder,
        entries: [...params.entries],
        maxPackageFilesTotal: params.maxPackageFilesTotal,
        maxPackageFilesPerResolve: params.maxPackageFilesPerResolve,
        clearMissing: params.clearMissing === true,
      },
      {
        signal: params.signal,
        abortedValue: () => ({ files: [] }),
        route: (message) =>
          message.type === 'done'
            ? { action: 'resolve', value: message.result }
            : { action: 'reject', error: new Error(message.message) },
      },
    )
    replayResolveLogs(result)
    return result
  } catch (error) {
    if (params.signal?.aborted) return { files: [] }
    appendVscodeInternalLog(
      'ts-resolve-worker',
      `服务不可用: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    )
    return { files: [] }
  }
}

export function clearBareModulesResolveState(): void {
  // fire-and-forget；服务不在运行时下新 Worker 天然是空缓存，丢弃即可
  service.post({ type: 'clear' })
}
