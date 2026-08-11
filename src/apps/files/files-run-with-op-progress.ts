import {
  estimateFilesOpDurationMs,
  estimateRemainingMs,
  filesOpProgressFraction,
  formatFilesOpRemainingLabel,
  FILES_OP_PROGRESS_OBSERVE_MS,
  shouldShowFilesOpProgressAtObserve,
  type FilesOpProgressSnapshot,
} from './files-op-progress-policy.ts'
import type { FilesVfsOpProgress } from './files-vfs.ts'

export type FilesOpProgressKind = 'paste' | 'delete' | 'compress' | 'extract'

export type FilesOpProgressUiState = {
  title: string
  remainingLabel: string
  fraction: number
}

function titleForKind(kind: FilesOpProgressKind): string {
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
  task: (report: (progress: FilesVfsOpProgress) => void) => Promise<T>
}): Promise<T> {
  const startedAt = performance.now()
  let done = 0
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
    })
  }

  const report = (progress: FilesVfsOpProgress) => {
    done = Math.min(total, Math.max(0, progress.done))
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
    return await params.task(report)
  } finally {
    clearTimers()
    params.onUiChange(undefined)
  }
}
