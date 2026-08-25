import {
  estimateFilesOpDurationMs,
  estimateRemainingMs,
  filesOpProgressFraction,
  formatFilesOpRemainingLabel,
  FILES_OP_PROGRESS_OBSERVE_MS,
  shouldShowFilesOpProgressAtObserve,
  type FilesOpProgressSnapshot,
} from './files-op-progress-policy.ts'
import { recordSystemDebugTimeline } from '../../os/system-debug-log.ts'
import type { FilesVfsOpProgress } from './files-vfs.ts'

export type FilesOpProgressKind = 'import' | 'paste' | 'delete' | 'compress' | 'extract'

/** 用户取消长操作的哨兵：调用方应吞掉（toast「已取消」），不走错误弹窗路径。 */
export class FilesOpCancelledError extends Error {
  constructor() {
    super('操作已取消')
    this.name = 'FilesOpCancelledError'
  }
}

export function isFilesOpCancelledError(err: unknown): err is FilesOpCancelledError {
  return err instanceof FilesOpCancelledError
}

export type FilesOpProgressUiState = {
  title: string
  remainingLabel: string
  fraction: number
  /** 补充信息（字节数 / 项数），由 task 在 report 里附带 */
  detailLabel?: string
  /** 取消入口；缺省表示该操作不可取消 */
  onCancel?: () => void
  /** 已请求取消：等待任务在下一个检查点停下并清理 */
  cancelPending?: boolean
}

/** report 可附带 detailLabel（迷你窗的「x / y · 项数」行），done/total 仍是工作单位。 */
export type FilesOpProgressReport = FilesVfsOpProgress & { detailLabel?: string }

function titleForKind(kind: FilesOpProgressKind): string {
  if (kind === 'import') return '正在导入…'
  if (kind === 'paste') return '正在粘贴…'
  if (kind === 'compress') return '正在压缩…'
  if (kind === 'extract') return '正在解压…'
  return '正在删除…'
}

export async function runFilesOpWithProgress<T>(params: {
  kind: FilesOpProgressKind
  totalWork: number
  estimatedTotalMs?: number
  onUiChange: (state: FilesOpProgressUiState | undefined) => void
  /** 协作取消信号：task 在检查点检查并抛 FilesOpCancelledError */
  signal?: AbortSignal
  /** 取消动作（如 controller.abort）；提供后 UI 显示取消按钮 */
  cancel?: () => void
  task: (
    report: (progress: FilesOpProgressReport) => void,
    signal: AbortSignal | undefined,
  ) => Promise<T>
}): Promise<T> {
  const startedAt = performance.now()
  let done = 0
  let detailLabel: string | undefined
  let cancelPending = false
  const total = Math.max(1, params.totalWork)
  const estimatedTotalMs = params.estimatedTotalMs ?? estimateFilesOpDurationMs(total)
  let dialogShown = false
  let observeTimer: number | undefined
  let uiTimer: number | undefined

  const snapshot = (): FilesOpProgressSnapshot => ({
    done,
    total,
    elapsedMs: performance.now() - startedAt,
    estimatedTotalMs,
  })

  const pushUi = () => {
    if (!dialogShown) return
    const remaining = estimateRemainingMs(snapshot())
    params.onUiChange({
      title: titleForKind(params.kind),
      remainingLabel: formatFilesOpRemainingLabel(remaining),
      fraction: filesOpProgressFraction(done, total),
      ...(detailLabel !== undefined ? { detailLabel } : {}),
      ...(params.cancel ? { onCancel: requestCancel } : {}),
      ...(cancelPending ? { cancelPending: true } : {}),
    })
  }

  const report = (progress: FilesOpProgressReport) => {
    done = Math.min(total, Math.max(0, progress.done))
    if (progress.detailLabel !== undefined) detailLabel = progress.detailLabel
    pushUi()
  }

  function requestCancel(): void {
    if (cancelPending) return
    cancelPending = true
    params.cancel?.()
    pushUi()
  }

  const clearTimers = () => {
    if (observeTimer !== undefined) {
      window.clearTimeout(observeTimer)
      observeTimer = undefined
    }
    if (uiTimer !== undefined) {
      window.clearInterval(uiTimer)
      uiTimer = undefined
    }
  }

  observeTimer = window.setTimeout(() => {
    observeTimer = undefined
    if (shouldShowFilesOpProgressAtObserve(snapshot())) {
      dialogShown = true
      pushUi()
      uiTimer = window.setInterval(pushUi, 250)
    }
  }, FILES_OP_PROGRESS_OBSERVE_MS)

  try {
    return await params.task(report, params.signal)
  } finally {
    clearTimers()
    params.onUiChange(undefined)
    // 所有文件 App 重操作（导入/粘贴/删除/压缩/解压）的统一咽喉：端到端耗时面包屑
    const elapsedMs = performance.now() - startedAt
    if (elapsedMs > 200) {
      recordSystemDebugTimeline({
        layer: 'files',
        op: `op-${params.kind}-done`,
        detail: `work=${total} done=${done}`,
        durationMs: Math.round(elapsedMs),
      })
    }
  }
}
