import type { ComponentChildren } from 'preact'
import { createContext } from 'preact'
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { createPortal } from 'preact/compat'
import { CloseIcon } from '../icons/app-icons.tsx'
import { Button } from '../ui/button.tsx'
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

export type WindowModalTitleSize = 'default' | 'large'

/** actions 按钮排布：'auto' 按数量自动（≤2 个横排等分、>2 个纵排）；'row' 恒为横排等分（窄容器自动塌缩为纵排）；'column' 恒为纵排 */
export type WindowModalActionsLayout = 'auto' | 'row' | 'column'

export type WindowModalProps = {
  open: boolean
  title: string
  /** 主标题下方的辅助说明 */
  subtitle?: string
  /** 标题对齐方式，默认居中 */
  titleAlign?: WindowModalTitleAlign
  /** 标题字号档位，默认 'default'；'large' 用于需要强调的对话框标题 */
  titleSize?: WindowModalTitleSize
  role?: 'dialog' | 'alertdialog'
  themeColor?: string
  wide?: boolean
  scrollBody?: boolean
  /** 面板高度策略：'auto'（默认，随内容自适应）| 'grow'（撑满可用高度，内容区自动填满并滚动） */
  heightType?: 'auto' | 'grow'
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
  /** actions 排布方式，默认 'auto' 按按钮数量自动切换横排/纵排 */
  actionsLayout?: WindowModalActionsLayout
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
    <Button
      key={action.key ?? action.label}
      class="window-modal__btn"
      tone={action.tone ?? 'secondary'}
      busy={action.busy}
      disabled={action.disabled || closing}
      onClick={() => void action.onClick()}
    >
      {action.label}
    </Button>
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
    <Button icon class="window-modal__close" aria-label="关闭" disabled={disabled} onClick={onClick}>
      <CloseIcon />
    </Button>
  )
}

export function WindowModal({
  open,
  title,
  subtitle,
  titleAlign,
  titleSize,
  role,
  themeColor,
  wide,
  scrollBody,
  heightType,
  align,
  titleId,
  panelClass,
  onClose,
  showCloseButton,
  children,
  footer,
  actions,
  headerActions,
  actionsLayout,
}: WindowModalProps) {
  const overlayRoot = useContext(WindowModalOverlayContext)
  const [visible, setVisible] = useState(open)
  const [closing, setClosing] = useState(false)
  // 关闭动画期间父级常把 children/actions 清空；保留最后一帧内容避免闪成空壳
  const contentRef = useRef({
    title,
    subtitle,
    titleAlign,
    titleSize,
    role,
    themeColor,
    wide,
    scrollBody,
    heightType,
    align,
    titleId,
    panelClass,
    onClose,
    showCloseButton,
    children,
    footer,
    actions,
    headerActions,
    actionsLayout,
  })
  if (open) {
    contentRef.current = {
      title,
      subtitle,
      titleAlign,
      titleSize,
      role,
      themeColor,
      wide,
      scrollBody,
      heightType,
      align,
      titleId,
      panelClass,
      onClose,
      showCloseButton,
      children,
      footer,
      actions,
      headerActions,
      actionsLayout,
    }
  }
  const display = contentRef.current
  const displayActions = display.actions
  const displayHeaderActions = display.headerActions
  const actionsMode =
    display.actionsLayout === 'row'
      ? 'row'
      : display.actionsLayout === 'column' || (displayActions?.length ?? 0) > 2
        ? 'many'
        : 'pair'
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
        class={`window-modal${display.wide ? ' window-modal--wide' : ''}${closing ? ' window-modal--closing' : ''}${display.align === 'top' ? ' window-modal--top' : ''}${display.heightType === 'grow' ? ' window-modal--grow' : ''}${display.panelClass ? ` ${display.panelClass}` : ''}`}
        style={panelStyle}
        role={display.role}
        aria-modal="true"
        aria-labelledby={displayTitleId}
        aria-describedby={displaySubtitleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div class={headerClass}>
          <div class="window-modal__title-block">
            <h3
              class={`window-modal__title${
                display.titleSize === 'large' ? ' window-modal__title--large' : ''
              }`}
              id={displayTitleId}
            >
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
