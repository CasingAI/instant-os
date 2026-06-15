import { useEffect, useMemo, useRef } from 'preact/hooks'
import { WindowModal } from '../../window/window-modal.tsx'
import type { GeneratedAppRuntimeErrorEntry } from './generated-app-runtime-error-types.ts'
import './generated-app-error-dialog.css'

type GeneratedAppErrorDialogProps = {
  appName: string
  themeColor?: string
  errors: GeneratedAppRuntimeErrorEntry[]
  alertOpen: boolean
  detailsOpen: boolean
  onIgnore: () => void
  onSuppressAlerts: () => void
  onOpenDetails: () => void
  onCloseDetails: () => void
}

function formatErrorTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function kindLabel(kind: GeneratedAppRuntimeErrorEntry['kind']): string {
  return kind === 'unhandledrejection' ? 'Promise' : '脚本'
}

export function GeneratedAppErrorDialog({
  appName,
  themeColor,
  errors,
  alertOpen,
  detailsOpen,
  onIgnore,
  onSuppressAlerts,
  onOpenDetails,
  onCloseDetails,
}: GeneratedAppErrorDialogProps) {
  const detailsListRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!detailsOpen) {
      return
    }

    const container = detailsListRef.current
    if (!container) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight
    })

    return () => window.cancelAnimationFrame(frame)
  }, [detailsOpen, errors])

  const latestError = errors[errors.length - 1]

  const alertActions = useMemo(
    () => [
      {
        key: 'suppress',
        label: '不再提醒',
        tone: 'secondary' as const,
        onClick: () => onSuppressAlerts(),
      },
      {
        key: 'ignore',
        label: '忽略错误',
        tone: 'secondary' as const,
        onClick: () => onIgnore(),
      },
      {
        key: 'details',
        label: '查看详情',
        tone: 'primary' as const,
        onClick: () => onOpenDetails(),
      },
    ],
    [onSuppressAlerts, onIgnore, onOpenDetails],
  )

  const detailActions = useMemo(
    () => [
      {
        key: 'close',
        label: '关闭',
        tone: 'primary' as const,
        onClick: () => onCloseDetails(),
      },
    ],
    [onCloseDetails],
  )

  return (
    <>
      <WindowModal
        open={alertOpen}
        title={`${appName} 遇到问题`}
        role="alertdialog"
        themeColor={themeColor}
        panelClass="generated-app-error-alert-modal"
        onClose={onIgnore}
        actions={alertActions}
      >
        <div class="generated-app-error-alert">
          <div class="generated-app-error-alert__icon" aria-hidden="true">
            !
          </div>
          <div class="generated-app-error-alert__copy">
            <p class="window-modal__message">
              该程序在运行时遇到异常。你可以选择不再提醒、暂时忽略此提示，或查看错误详情。
            </p>
            {errors.length > 1 && (
              <p class="generated-app-error-alert__count">已累计 {errors.length} 条异常。</p>
            )}
          </div>
        </div>
      </WindowModal>

      <WindowModal
        open={detailsOpen}
        title={`${appName} 错误详情`}
        wide
        themeColor={themeColor}
        onClose={onCloseDetails}
        actions={detailActions}
      >
        <div class="generated-app-error-details">
          <p class="generated-app-error-details__summary">
            {errors.length > 0
              ? `共记录 ${errors.length} 条异常。程序继续运行时若再出现异常，会自动追加到下方列表。`
              : '暂无异常记录。'}
          </p>
          <div ref={detailsListRef} class="generated-app-error-details__list">
            {errors.length === 0 ? (
              <p class="generated-app-error-details__empty">当前没有可显示的错误。</p>
            ) : (
              errors.map((entry) => (
                <article key={entry.id} class="generated-app-error-details__item">
                  <div class="generated-app-error-details__meta">
                    <span>{formatErrorTime(entry.timestamp)}</span>
                    <span class="generated-app-error-details__kind">{kindLabel(entry.kind)}</span>
                  </div>
                  <pre class="generated-app-error-details__text">{entry.text}</pre>
                </article>
              ))
            )}
          </div>
          {latestError && (
            <p class="generated-app-error-details__summary">最近一条：{latestError.text.split('\n')[0]}</p>
          )}
        </div>
      </WindowModal>
    </>
  )
}
