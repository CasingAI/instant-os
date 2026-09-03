import {
  estimateFilesOpDurationMs,
  estimateRemainingMs,
  filesOpProgressFraction,
  formatFilesOpRemainingLabel,
  FILES_OP_PROGRESS_MIN_VISIBLE_MS,
  type FilesOpProgressSnapshot,
} from './files-op-progress-policy.ts'
import {
  createFilesOpProgressSessionId,
  publishFilesOpProgress,
} from './files-op-progress-session.ts'
import { recordSystemDebugTimeline } from '../../os/system-debug-log.ts'
import { formatFilesByteSize } from './files-path.ts'
import type { FilesVfsOpProgress } from './files-vfs.ts'

export type FilesOpProgressKind = 'import' | 'paste' | 'delete' | 'compress' | 'extract' | 'sparse'

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
  /** 统计阶段：总量未定时圆饼走旋转弧线，而不是停在 0 的空饼 */
  indeterminate?: boolean
  /** 补充信息（字节数 / 项数），由 task 在 report 里附带 */
  detailLabel?: string
  /** 当前正在处理的名字（路径末段） */
  currentName?: string
  /** 树内真实进度：已处理 / 总节点数（不是顶层选中项数） */
  items?: { done: number; total: number }
  /** 树内真实进度：已处理 / 总字节数 */
  bytes?: { done: number; total: number }
  /** 速度文案（有字节进度时按已处理字节 / 已过时间估算）；无体积的操作（删除）不出现 */
  speedLabel?: string
  /** 取消入口；缺省表示该操作不可取消 */
  onCancel?: () => void
  /** 已请求取消：等待任务在下一个检查点停下并清理 */
  cancelPending?: boolean
}

/** report 可附带 detailLabel（调用方自定义口径，如「x / y 个文件」）、当前名与
 *  树内真实项数/字节数（迷你窗直接展示，不再让调用方拼「x / y 项」）。
 *  done/total 仍是工作单位。 */
export type FilesOpProgressReport = FilesVfsOpProgress & {
  detailLabel?: string
  currentName?: string
  items?: { done: number; total: number }
  bytes?: { done: number; total: number }
}

function titleForKind(kind: FilesOpProgressKind): string {
  if (kind === 'import') return '正在导入…'
  if (kind === 'paste') return '正在粘贴…'
  if (kind === 'compress') return '正在压缩…'
  if (kind === 'extract') return '正在解压…'
  if (kind === 'sparse') return '正在稀疏化…'
  return '正在删除…'
}

/** 提供 estimate 时入口态文案：窗口立刻出现，进度条停在 0 */
export const FILES_OP_PROGRESS_ESTIMATING_LABEL = '正在统计需要处理的内容…'

/** 速度采样下限：开跑头几百毫秒按总耗时折算会虚高，先不显示 */
const SPEED_MIN_SAMPLE_MS = 600

export async function runFilesOpWithProgress<T>(params: {
  kind: FilesOpProgressKind
  /** 覆盖默认标题（如物化方向与 kind 默认文案不一致时） */
  titleOverride?: string
  /** 任务总量；提供 estimate 时由 estimate 返回值定标，此项可省略 */
  totalWork?: number
  estimatedTotalMs?: number
  /** 最短显示时长；默认 FILES_OP_PROGRESS_MIN_VISIBLE_MS（测试可调短） */
  minVisibleMs?: number
  /**
   * 统计阶段钩子。提供时窗口先显示「正在统计…」，await 得到总量后再进入正式进度。
   * 不传则行为与原先一致：立即用 totalWork 定标并展示。
   */
  estimate?: () => Promise<number>
  /** 可选：调用方本地 UI；系统迷你窗由进度会话自动打开，不必再传 */
  onUiChange?: (state: FilesOpProgressUiState | undefined) => void
  /** 协作取消信号：task 在检查点检查并抛 FilesOpCancelledError */
  signal?: AbortSignal
  /** 取消动作（如 controller.abort）；提供后 UI 显示取消按钮 */
  cancel?: () => void
  task: (
    report: (progress: FilesOpProgressReport) => void,
    signal: AbortSignal | undefined,
  ) => Promise<T>
}): Promise<T> {
  const sessionId = createFilesOpProgressSessionId()
  const startedAt = performance.now()
  let done = 0
  let detailLabel: string | undefined
  let currentName: string | undefined
  let items: { done: number; total: number } | undefined
  let bytes: { done: number; total: number } | undefined
  let cancelPending = false
  let estimating = params.estimate !== undefined
  let total = Math.max(1, params.totalWork ?? 1)
  let estimatedTotalMs = params.estimatedTotalMs ?? estimateFilesOpDurationMs(total)
  const minVisibleMs = Math.max(0, params.minVisibleMs ?? FILES_OP_PROGRESS_MIN_VISIBLE_MS)
  let uiTimer: number | undefined

  const snapshot = (): FilesOpProgressSnapshot => ({
    done,
    total,
    elapsedMs: performance.now() - startedAt,
    estimatedTotalMs,
  })

  const emitUi = (state: FilesOpProgressUiState | undefined) => {
    params.onUiChange?.(state)
    publishFilesOpProgress(sessionId, state)
  }

  const pushUi = () => {
    if (estimating) {
      emitUi({
        title: params.titleOverride ?? titleForKind(params.kind),
        remainingLabel: FILES_OP_PROGRESS_ESTIMATING_LABEL,
        fraction: 0,
        indeterminate: true,
        ...(params.cancel ? { onCancel: requestCancel } : {}),
        ...(cancelPending ? { cancelPending: true } : {}),
      })
      return
    }
    const remaining = estimateRemainingMs(snapshot())
    // 速度按已上报字节 / 已过时间估算（整程均值）；没有字节口径的操作不硬编
    const elapsedMs = performance.now() - startedAt
    const speedLabel =
      bytes && bytes.done > 0 && elapsedMs >= SPEED_MIN_SAMPLE_MS
        ? `${formatFilesByteSize(bytes.done / (elapsedMs / 1000))}/s`
        : undefined
    emitUi({
      title: params.titleOverride ?? titleForKind(params.kind),
      remainingLabel: formatFilesOpRemainingLabel(remaining),
      fraction: filesOpProgressFraction(done, total),
      ...(detailLabel !== undefined ? { detailLabel } : {}),
      ...(currentName !== undefined ? { currentName } : {}),
      ...(items !== undefined ? { items } : {}),
      ...(bytes !== undefined ? { bytes } : {}),
      ...(speedLabel !== undefined ? { speedLabel } : {}),
      ...(params.cancel ? { onCancel: requestCancel } : {}),
      ...(cancelPending ? { cancelPending: true } : {}),
    })
  }

  const report = (progress: FilesOpProgressReport) => {
    done = Math.min(total, Math.max(0, progress.done))
    if (progress.detailLabel !== undefined) detailLabel = progress.detailLabel
    if (progress.currentName !== undefined) currentName = progress.currentName
    if (progress.items !== undefined) items = progress.items
    if (progress.bytes !== undefined) bytes = progress.bytes
    pushUi()
  }

  function requestCancel(): void {
    if (cancelPending) return
    cancelPending = true
    params.cancel?.()
    pushUi()
  }

  const clearTimers = () => {
    if (uiTimer !== undefined) {
      window.clearInterval(uiTimer)
      uiTimer = undefined
    }
  }

  // 立即展示：进度窗的意义就是让用户看到操作在进行。此前「350ms 观察窗 + 剩余
  // ETA≥2s 才弹」的门槛按本地卷吞吐估算，镜像卷实际慢一个量级，大拷贝整程无窗，
  // 用户误以为已完成就推出，写入被截断后静默丢数据。
  pushUi()
  uiTimer = window.setInterval(pushUi, 250)

  let succeeded = false
  try {
    if (params.estimate) {
      const estimated = await params.estimate()
      total = Math.max(1, estimated)
      estimatedTotalMs = params.estimatedTotalMs ?? estimateFilesOpDurationMs(total)
      estimating = false
      report({ done: 0, total })
    }
    const result = await params.task(report, params.signal)
    succeeded = true
    return result
  } catch (error) {
    // 任何取消源（VFS/归档检查点的 throwIfAborted 等）统一转成 FilesOpCancelledError，
    // 调用方用 isFilesOpCancelledError 识别为「已取消」而不是报错弹窗
    if (params.signal?.aborted && !(error instanceof FilesOpCancelledError)) {
      throw new FilesOpCancelledError()
    }
    throw error
  } finally {
    clearTimers()
    if (succeeded) {
      // 完成态立刻可见；窗口保持到最短显示时长再关，避免一闪而过被当成没弹过
      emitUi({
        title: params.titleOverride ?? titleForKind(params.kind),
        remainingLabel: '已完成',
        fraction: 1,
        ...(detailLabel !== undefined ? { detailLabel } : {}),
        ...(currentName !== undefined ? { currentName } : {}),
        ...(items !== undefined ? { items } : {}),
        ...(bytes !== undefined ? { bytes } : {}),
      })
      const remainMs = minVisibleMs - (performance.now() - startedAt)
      if (remainMs > 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, remainMs))
      }
    }
    emitUi(undefined)
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
