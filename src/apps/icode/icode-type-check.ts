/**
 * 类型检查宿主入口（第五期）：懒加载 Worker，一轮草稿写入结束或用户明确要求时查一次。
 * 不做后台常驻检查服务；检查不是模型调用，不进「AI 用量」。
 */
import type {
  IcodeTypeCheckRequest,
  IcodeTypeCheckResponse,
  IcodeTypeCheckDiagnostic,
} from './icode-type-check-core.ts'

export type { IcodeTypeCheckDiagnostic }

let worker: Worker | undefined
let runIdCounter = 0
const pendingRuns = new Map<number, { resolve: (value: IcodeTypeCheckResponse) => void }>()

function ensureWorker(): Worker {
  if (worker) {
    return worker
  }
  worker = new Worker(new URL('./icode-type-check.worker.ts', import.meta.url), {
    type: 'module',
  })
  worker.onmessage = (event: MessageEvent<IcodeTypeCheckResponse>) => {
    const response = event.data
    const pending = pendingRuns.get(response.runId)
    if (pending) {
      pendingRuns.delete(response.runId)
      pending.resolve(response)
    }
  }
  worker.onerror = () => {
    for (const [id, pending] of pendingRuns) {
      pendingRuns.delete(id)
      pending.resolve({
        type: 'instant-os-icode-type-check-result',
        runId: id,
        diagnostics: [],
        error: '类型检查 Worker 异常',
      })
    }
  }
  return worker
}

/** 对当前草稿源码树跑一次完整 TypeScript 检查（旁路信号，不挡任何关键路径） */
export async function runIcodeTypeCheck(input: {
  files: Record<string, string>
  entryPath: string
}): Promise<IcodeTypeCheckDiagnostic[]> {
  const activeWorker = ensureWorker()
  const runId = ++runIdCounter
  const request: IcodeTypeCheckRequest = {
    type: 'instant-os-icode-type-check',
    runId,
    files: input.files,
    entryPath: input.entryPath,
  }
  const response = await new Promise<IcodeTypeCheckResponse>((resolve) => {
    pendingRuns.set(runId, { resolve })
    activeWorker.postMessage(request)
  })
  if (response.error) {
    throw new Error(response.error)
  }
  return response.diagnostics
}
