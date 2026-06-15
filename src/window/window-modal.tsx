import type { ComponentChildren } from 'preact'
import { createContext } from 'preact'
import { useContext, useEffect, useMemo, useState } from 'preact/hooks'
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
  const resolvedTitleId = useMemo(
    () => titleId ?? `window-modal-${slugifyTitle(title)}-title`,
    [title, titleId],
  )

  const overlayRoot = useContext(WindowModalOverlayContext)
  const actionsMode = (actions?.length ?? 0) > 2 ? 'many' : 'pair'
  const [visible, setVisible] = useState(open)
  const [closing, setClosing] = useState(false)

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

  if (!visible) {
    return undefined
  }

  const panelStyle = themeColor
    ? ({ '--window-modal-theme': themeColor } as Record<string, string>)
    : undefined

  const modal = (
    <div
      class={`window-modal-backdrop${closing ? ' window-modal-backdrop--closing' : ''}`}
      role="presentation"
      onClick={onClose}
    >
      <div
        class={`window-modal${wide ? ' window-modal--wide' : ''}${closing ? ' window-modal--closing' : ''}${panelClass ? ` ${panelClass}` : ''}`}
        style={panelStyle}
        role={role}
        aria-modal="true"
        aria-labelledby={resolvedTitleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div class="window-modal__header">
          <h3 class="window-modal__title" id={resolvedTitleId}>
            {title}
          </h3>
        </div>
        {children && (
          <div class={`window-modal__body${scrollBody ? ' window-modal__body--scroll' : ''}`}>
            {children}
          </div>
        )}
        {actions && actions.length > 0 && (
          <div class={`window-modal__actions window-modal__actions--${actionsMode}`}>
            {actions.map((action) => (
              <button
                key={action.key ?? action.label}
                type="button"
                class={`window-modal__btn window-modal__btn--${action.tone ?? 'secondary'}`}
                disabled={action.disabled}
                onClick={() => void action.onClick()}
              >
                {action.label}
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
