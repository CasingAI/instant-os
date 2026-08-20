import type { ComponentChildren } from 'preact'
import { createContext } from 'preact'
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import './window-modal.css'

export const WindowModalOverlayContext = createContext<HTMLElement | undefined>(undefined)

const CLOSE_ANIMATION_MS = 200

export type WindowModalActionTone = 'primary' | 'secondary' | 'danger'

export type WindowModalAction = {
  key?: string
  label: string
  tone?: WindowModalActionTone
  disabled?: boolean
  /** 在按钮文案前显示转圈（用于异步提交） */
  busy?: boolean
  onClick: () => void | boolean | Promise<void | boolean>
}

export type WindowModalProps = {
  open: boolean
  title: string
  role?: 'dialog' | 'alertdialog'
  themeColor?: string
  wide?: boolean
  scrollBody?: boolean
  titleId?: string
  panelClass?: string
  onClose?: () => void
  children?: ComponentChildren
  actions?: WindowModalAction[]
}

function slugifyTitle(title: string): string {
  return title.replace(/\s+/g, '-').toLowerCase()
}

export function WindowModal({
  open,
  title,
  role = 'dialog',
  themeColor,
  wide,
  scrollBody,
  titleId,
  panelClass,
  onClose,
  children,
  actions,
}: WindowModalProps) {
  const overlayRoot = useContext(WindowModalOverlayContext)
  const [visible, setVisible] = useState(open)
  const [closing, setClosing] = useState(false)
  // 关闭动画期间父级常把 children/actions 清空；保留最后一帧内容避免闪成空壳
  const contentRef = useRef({
    title,
    role,
    themeColor,
    wide,
    scrollBody,
    titleId,
    panelClass,
    onClose,
    children,
    actions,
  })
  if (open) {
    contentRef.current = {
      title,
      role,
      themeColor,
      wide,
      scrollBody,
      titleId,
      panelClass,
      onClose,
      children,
      actions,
    }
  }
  const display = contentRef.current
  const displayActions = display.actions
  const actionsMode = (displayActions?.length ?? 0) > 2 ? 'many' : 'pair'
  const displayTitleId = useMemo(
    () => display.titleId ?? `window-modal-${slugifyTitle(display.title)}-title`,
    [display.title, display.titleId],
  )

  useEffect(() => {
    if (open) {
      setVisible(true)
      setClosing(false)
      return
    }

    if (!visible) {
      return
    }

    setClosing(true)
    const timer = window.setTimeout(() => {
      setVisible(false)
      setClosing(false)
    }, CLOSE_ANIMATION_MS)

    return () => window.clearTimeout(timer)
  }, [open, visible])

  if (!visible && !open) {
    return undefined
  }

  const panelStyle = display.themeColor
    ? ({ '--window-modal-theme': display.themeColor } as Record<string, string>)
    : undefined

  const modal = (
    <div
      class={`window-modal-backdrop${closing ? ' window-modal-backdrop--closing' : ''}`}
      role="presentation"
      onClick={display.onClose}
    >
      <div
        class={`window-modal${display.wide ? ' window-modal--wide' : ''}${closing ? ' window-modal--closing' : ''}${display.panelClass ? ` ${display.panelClass}` : ''}`}
        style={panelStyle}
        role={display.role}
        aria-modal="true"
        aria-labelledby={displayTitleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div class="window-modal__header">
          <h3 class="window-modal__title" id={displayTitleId}>
            {display.title}
          </h3>
        </div>
        {display.children && (
          <div
            class={`window-modal__body${display.scrollBody ? ' window-modal__body--scroll' : ''}`}
          >
            {display.children}
          </div>
        )}
        {displayActions && displayActions.length > 0 && (
          <div class={`window-modal__actions window-modal__actions--${actionsMode}`}>
            {displayActions.map((action) => (
              <button
                key={action.key ?? action.label}
                type="button"
                class={`window-modal__btn window-modal__btn--${action.tone ?? 'secondary'}${
                  action.busy ? ' window-modal__btn--busy' : ''
                }`}
                disabled={action.disabled || closing}
                aria-busy={action.busy || undefined}
                aria-label={action.busy ? action.label : undefined}
                onClick={() => void action.onClick()}
              >
                {action.busy ? (
                  <span class="window-modal__btn-spinner" aria-hidden="true" />
                ) : (
                  action.label
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  if (overlayRoot) {
    return createPortal(modal, overlayRoot)
  }

  return modal
}
