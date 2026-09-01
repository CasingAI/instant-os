import type { ComponentChildren } from 'preact'
import { createContext } from 'preact'
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { CloseIcon } from '../icons/app-icons.tsx'
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

export type WindowModalAlign = 'center' | 'top'

export type WindowModalTitleAlign = 'center' | 'left'

export type WindowModalProps = {
  open: boolean
  title: string
  /** 主标题下方的辅助说明 */
  subtitle?: string
  /** 标题对齐方式，默认居中 */
  titleAlign?: WindowModalTitleAlign
  role?: 'dialog' | 'alertdialog'
  themeColor?: string
  wide?: boolean
  scrollBody?: boolean
  align?: WindowModalAlign
  titleId?: string
  panelClass?: string
  onClose?: () => void
  /** 在标题栏右上角显示关闭按钮（点击走 onClose） */
  showCloseButton?: boolean
  children?: ComponentChildren
  /** 显示在 body 下方、actions 上方的页脚区域（自带顶部横线分隔） */
  footer?: ComponentChildren
  actions?: WindowModalAction[]
  /** 显示在 header 标题右侧的操作按钮 */
  headerActions?: WindowModalAction[]
}

function slugifyTitle(title: string): string {
  return title.replace(/\s+/g, '-').toLowerCase()
}

function ActionButton({
  action,
  closing,
}: {
  action: WindowModalAction
  closing: boolean
}): preact.JSX.Element {
  return (
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
      {action.busy ? <span class="window-modal__btn-spinner" aria-hidden="true" /> : action.label}
    </button>
  )
}

function CloseButton({
  disabled,
  onClick,
}: {
  disabled: boolean
  onClick: () => void
}): preact.JSX.Element {
  return (
    <button
      type="button"
      class="window-modal__close"
      aria-label="关闭"
      disabled={disabled}
      onClick={onClick}
    >
      <CloseIcon />
    </button>
  )
}

export function WindowModal({
  open,
  title,
  subtitle,
  titleAlign = 'center',
  role = 'dialog',
  themeColor,
  wide,
  scrollBody,
  align = 'center',
  titleId,
  panelClass,
  onClose,
  showCloseButton,
  children,
  footer,
  actions,
  headerActions,
}: WindowModalProps) {
  const overlayRoot = useContext(WindowModalOverlayContext)
  const [visible, setVisible] = useState(open)
  const [closing, setClosing] = useState(false)
  // 关闭动画期间父级常把 children/actions 清空；保留最后一帧内容避免闪成空壳
  const contentRef = useRef({
    title,
    subtitle,
    titleAlign,
    role,
    themeColor,
    wide,
    scrollBody,
    align,
    titleId,
    panelClass,
    onClose,
    showCloseButton,
    children,
    footer,
    actions,
    headerActions,
  })
  if (open) {
    contentRef.current = {
      title,
      subtitle,
      titleAlign,
      role,
      themeColor,
      wide,
      scrollBody,
      align,
      titleId,
      panelClass,
      onClose,
      showCloseButton,
      children,
      footer,
      actions,
      headerActions,
    }
  }
  const display = contentRef.current
  const displayActions = display.actions
  const displayHeaderActions = display.headerActions
  const actionsMode = (displayActions?.length ?? 0) > 2 ? 'many' : 'pair'
  const displayTitleId = useMemo(
    () => display.titleId ?? `window-modal-${slugifyTitle(display.title)}-title`,
    [display.title, display.titleId],
  )
  const displaySubtitleId = useMemo(
    () =>
      display.subtitle
        ? `${display.titleId ?? `window-modal-${slugifyTitle(display.title)}`}-subtitle`
        : undefined,
    [display.subtitle, display.title, display.titleId],
  )
  const hasHeaderActions = (displayHeaderActions?.length ?? 0) > 0
  const hasCloseButton = Boolean(display.showCloseButton)
  const closeDisabled = closing || !display.onClose
  const headerClass = [
    'window-modal__header',
    display.titleAlign === 'left' ? 'window-modal__header--title-left' : '',
    hasCloseButton ? 'window-modal__header--with-close' : '',
    hasHeaderActions ? 'window-modal__header--with-actions' : '',
    display.subtitle ? 'window-modal__header--with-subtitle' : '',
  ]
    .filter(Boolean)
    .join(' ')

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
      class={`window-modal-backdrop${closing ? ' window-modal-backdrop--closing' : ''}${display.align === 'top' ? ' window-modal-backdrop--top' : ''}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) display.onClose?.()
      }}
    >
      <div
        class={`window-modal${display.wide ? ' window-modal--wide' : ''}${closing ? ' window-modal--closing' : ''}${display.align === 'top' ? ' window-modal--top' : ''}${display.panelClass ? ` ${display.panelClass}` : ''}`}
        style={panelStyle}
        role={display.role}
        aria-modal="true"
        aria-labelledby={displayTitleId}
        aria-describedby={displaySubtitleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div class={headerClass}>
          <div class="window-modal__title-block">
            <h3 class="window-modal__title" id={displayTitleId}>
              {display.title}
            </h3>
            {display.subtitle && (
              <p class="window-modal__subtitle" id={displaySubtitleId}>
                {display.subtitle}
              </p>
            )}
          </div>
          {(hasHeaderActions || hasCloseButton) && (
            <div class="window-modal__header-trailing">
              {hasHeaderActions && (
                <div class="window-modal__header-actions">
                  {displayHeaderActions!.map((action) => (
                    <ActionButton key={action.key ?? action.label} action={action} closing={closing} />
                  ))}
                </div>
              )}
              {hasCloseButton && (
                <CloseButton
                  disabled={closeDisabled}
                  onClick={() => display.onClose?.()}
                />
              )}
            </div>
          )}
        </div>
        {display.children && (
          <div
            class={`window-modal__body${display.scrollBody ? ' window-modal__body--scroll' : ''}`}
          >
            {display.children}
          </div>
        )}
        {display.footer && <div class="window-modal__footer">{display.footer}</div>}
        {displayActions && displayActions.length > 0 && (
          <div class={`window-modal__actions window-modal__actions--${actionsMode}`}>
            {displayActions.map((action) => (
              <ActionButton key={action.key ?? action.label} action={action} closing={closing} />
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
