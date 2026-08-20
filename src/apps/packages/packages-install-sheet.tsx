import { useEffect, useRef, useState } from 'preact/hooks'
import { WindowModal } from '../../window/window-modal.tsx'
import type { PackageTaskProgress, PackageTaskStatus } from '../../packages/package-public.ts'
import './packages-install-sheet.css'

export type PackagesInstallSheetProps = {
  open: boolean
  headline: string
  status: PackageTaskStatus | 'idle'
  progress?: PackageTaskProgress
  lines: string[]
  error?: string
  onCancel: () => void
  onDone: () => void
}

function phaseLabel(
  progress: PackageTaskProgress | undefined,
  status: PackageTaskStatus | 'idle',
  headline: string,
): string {
  if (status === 'succeeded') return 'Complete'
  if (status === 'failed') return 'Failed'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'pending' || status === 'idle') return 'Preparing'
  if (headline.includes('卸载')) return 'Removing Packages'
  if (headline.includes('检查')) return 'Checking for Updates'
  switch (progress?.phase) {
    case 'resolve':
      return 'Resolving Dependencies'
    case 'download':
      return 'Downloading Packages'
    case 'extract':
      return 'Extracting Packages'
    case 'link':
      return 'Installing Packages'
    case 'lifecycle':
      return 'Configuring Packages'
    default:
      return headline.includes('更新') ? 'Updating Software' : 'Installing Software'
  }
}

/**
 * 窗口内安装/检查过程面板：走系统 WindowModal（窗口 overlay + 进出场动画）。
 * 保持挂载、用 open 切换，才能播关闭动画。
 */
export function PackagesInstallSheet({
  open,
  headline,
  status,
  progress,
  lines,
  error,
  onCancel,
  onDone,
}: PackagesInstallSheetProps) {
  const consoleRef = useRef<HTMLPreElement>(null)
  const running = status === 'pending' || status === 'running'
  const finished = status === 'succeeded' || status === 'failed' || status === 'cancelled'
  const phase = phaseLabel(progress, status, headline)
  const percent = progress?.percent
  const hasPercent = typeof percent === 'number'
  const fillRatio = hasPercent
    ? Math.max(0, Math.min(1, percent / 100))
    : finished
      ? 1
      : 0

  // 相位文案交叉淡入，避免直接闪切
  const [phaseShown, setPhaseShown] = useState('')
  const [phaseFade, setPhaseFade] = useState<'in' | 'out'>('out')
  useEffect(() => {
    if (!open) {
      setPhaseShown('')
      setPhaseFade('out')
      return
    }
    if (!phaseShown) {
      setPhaseShown(phase)
      // 下一帧再淡入，避免和弹层同帧硬切
      const raf = requestAnimationFrame(() => setPhaseFade('in'))
      return () => cancelAnimationFrame(raf)
    }
    if (phase === phaseShown) return
    setPhaseFade('out')
    const timer = window.setTimeout(() => {
      setPhaseShown(phase)
      setPhaseFade('in')
    }, 140)
    return () => window.clearTimeout(timer)
  }, [open, phase, phaseShown])

  useEffect(() => {
    const el = consoleRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lines, progress, error])

  return (
    <WindowModal
      open={open}
      title={headline}
      wide
      panelClass="packages-install-sheet"
      onClose={finished ? onDone : undefined}
      actions={
        running
          ? [
              {
                key: 'cancel',
                label: '取消',
                tone: 'secondary',
                onClick: onCancel,
              },
            ]
          : [
              {
                key: 'done',
                label: '完成',
                tone: 'primary',
                onClick: onDone,
              },
            ]
      }
    >
      <div class="packages-install-sheet__body">
        <div class="packages-install-sheet__status" aria-live="polite">
          <span
            class={`packages-install-sheet__status-phase packages-install-sheet__status-phase--${phaseFade}`}
          >
            {phaseShown}
          </span>
          <span
            class={`packages-install-sheet__status-pct${hasPercent || finished ? ' packages-install-sheet__status-pct--on' : ''}`}
          >
            {hasPercent ? `${Math.round(percent)}%` : finished ? '100%' : '—'}
          </span>
        </div>
        <div
          class={`packages-install-sheet__track${running && !hasPercent ? ' packages-install-sheet__track--indet' : ''}`}
          aria-hidden="true"
        >
          <div
            class="packages-install-sheet__fill"
            style={{ transform: `scaleX(${fillRatio})` }}
          />
        </div>

        <pre ref={consoleRef} class="packages-install-sheet__console">
          {lines.length === 0 && !error
            ? 'Preparing…'
            : [...lines, error ? `Error: ${error}` : undefined].filter(Boolean).join('\n')}
        </pre>
      </div>
    </WindowModal>
  )
}
