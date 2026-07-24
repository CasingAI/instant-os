import { WindowModal } from '../../window/window-modal.tsx'
import './files-op-progress-dialog.css'

export type FilesOpProgressDialogProps = {
  open: boolean
  title: string
  remainingLabel: string
  fraction: number
  themeColor?: string
}

export function FilesOpProgressDialog({
  open,
  title,
  remainingLabel,
  fraction,
  themeColor,
}: FilesOpProgressDialogProps) {
  const clamped = Math.min(1, Math.max(0, fraction))
  const percent = Math.round(clamped * 100)

  return (
    <WindowModal open={open} title={title} themeColor={themeColor} role="dialog">
      <p class="files-op-progress__remaining">{remainingLabel}</p>
      <div
        class="files-op-progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={title}
      >
        <span class="files-op-progress__fill" style={{ width: `${percent}%` }} />
      </div>
    </WindowModal>
  )
}
