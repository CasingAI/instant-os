import type { ComponentChildren, JSX } from 'preact'
import './page-action-button.css'

export type PageActionButtonTone = 'plain' | 'default' | 'danger'

export type PageActionButtonProps = {
  children?: ComponentChildren
  tone?: PageActionButtonTone
  /** 持久选中态（如「已收藏」「已读」）；配 plain 使用，视觉为蓝底白字 */
  activated?: boolean
  /**
   * 图标内容。只传 icon（无文字）→ 28px 方形图标按钮（配 aria-label 使用）；
   * icon + 文字 → 双态按钮：平时是文字按钮，在 PageButtonGroup 里放不下时
   * 整钮退化为图标方钮（见 page-button-group.tsx 的退位档）。
   */
  icon?: ComponentChildren
  disabled?: boolean
  /** 提交中：文字前显示转圈 */
  busy?: boolean
  class?: string
  'aria-label'?: string
  title?: string
  onClick?: JSX.MouseEventHandler<HTMLButtonElement>
}

/**
 * Header 操作按钮（自包含）：plain/default/danger、activated 选中态、disabled、busy、
 * icon 方钮；icon+文字为双态按钮（宽时文字，组内放不下退化为方钮）。
 * 默认 flex-shrink:1、min-width 84px —— 操作多时与系统其他地方一样挤压而不是滚动。
 */
export function PageActionButton({
  children,
  tone = 'plain',
  activated = false,
  icon,
  disabled = false,
  busy = false,
  class: className,
  'aria-label': ariaLabel,
  title,
  onClick,
}: PageActionButtonProps) {
  const hasLabel = children !== undefined
  const classes = [
    'page-action-button',
    `page-action-button--${tone}`,
    activated ? 'page-action-button--activated' : undefined,
    icon && !hasLabel ? 'page-action-button--icon' : undefined,
    icon && hasLabel ? 'page-action-button--dual' : undefined,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      class={classes}
      disabled={disabled || busy}
      aria-label={ariaLabel ?? (icon ? extractText(children) : undefined)}
      title={title}
      onClick={onClick}
    >
      {icon ? (
        <span class="page-action-button__icon" aria-hidden="true">
          {icon}
        </span>
      ) : undefined}
      {busy ? <span class="page-action-button__spinner" aria-hidden="true" /> : undefined}
      {children !== undefined ? (
        <span class="page-action-button__label">{children}</span>
      ) : undefined}
    </button>
  )
}

// 双态按钮退化后 label 被 display:none，屏幕阅读器名需提前从 children 取到
function extractText(children: ComponentChildren): string | undefined {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(extractText).filter(Boolean).join('') || undefined
  return undefined
}