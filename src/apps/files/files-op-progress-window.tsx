/**
 * 文件操作进度面板：顶部横条，下方明细（项数 / 体积 / 速度 / 当前名 / 剩余时间）。
 * 窗框、标题、拖动、关闭由系统迷你窗（dialog chrome）负责。
 */
import type { FilesOpProgressUiState } from './files-run-with-op-progress.ts'
import { formatFilesByteSize } from './files-path.ts'
import './files-op-progress-window.css'

export type FilesOpProgressPanelProps = {
  state: FilesOpProgressUiState
}

export function FilesOpProgressPanel({ state }: FilesOpProgressPanelProps) {
  const fraction = Math.min(1, Math.max(0, state.fraction ?? 0))
  const percent = Math.round(fraction * 100)
  const showItems = state.items && state.items.total > 0
  const showBytes = state.bytes && state.bytes.total > 0
  const showDetailLabel = !showItems && !showBytes && state.detailLabel
  const detailParts: string[] = []
  if (showItems) {
    detailParts.push(
      `${state.items!.done.toLocaleString()} / ${state.items!.total.toLocaleString()} 项`,
    )
  }
  if (showBytes) {
    detailParts.push(
      `${formatFilesByteSize(state.bytes!.done)} / ${formatFilesByteSize(state.bytes!.total)}`,
    )
  }
  return (
    <div class="files-op-progress-panel">
      <div
        class="files-op-progress-panel__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={state.title}
      >
        <div class="files-op-progress-panel__bar-fill" style={{ width: `${percent}%` }} />
      </div>
      <div class="files-op-progress-panel__info">
        {showDetailLabel ? (
          <div class="files-op-progress-panel__detail">{state.detailLabel}</div>
        ) : null}
        {detailParts.length > 0 ? (
          <div class="files-op-progress-panel__detail">{detailParts.join(' · ')}</div>
        ) : null}
        {state.currentName ? (
          <div class="files-op-progress-panel__current" title={state.currentName}>
            正在处理「{state.currentName}」
          </div>
        ) : null}
        <div class="files-op-progress-panel__remaining">
          {state.speedLabel ? `${state.speedLabel} · ` : ''}
          {state.remainingLabel}
        </div>
      </div>
    </div>
  )
}
