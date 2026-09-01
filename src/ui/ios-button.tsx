import type { ComponentChildren, JSX } from 'preact'
import './ios-button.css'

export type IosButtonTone = 'secondary' | 'primary' | 'danger'
export type IosButtonSize = 'default' | 'compact'

export type IosButtonProps = {
  children?: ComponentChildren
  tone?: IosButtonTone
  size?: IosButtonSize
  /** 方形图标按钮（导航箭头等） */
  icon?: boolean
  /** 异步进行中：以转圈替换文案并标记 aria-busy */
  busy?: boolean
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  title?: string
  class?: string
  'aria-label'?: string
  onClick?: JSX.MouseEventHandler<HTMLButtonElement>
}

/** iOS 6 拟物按钮：灰底 / 蓝主按钮 / 危险红；可通过 --ios-button-* CSS 变量换皮 */
export function IosButton({
  children,
  tone = 'secondary',
  size = 'default',
  icon = false,
  busy = false,
  type = 'button',
  disabled = false,
  title,
  class: className,
  'aria-label': ariaLabel,
  onClick,
}: IosButtonProps) {
  const classes = [
    'ios-button',
    `ios-button--${tone}`,
    size === 'compact' ? 'ios-button--compact' : undefined,
    icon ? 'ios-button--icon' : undefined,
    busy ? 'ios-button--busy' : undefined,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type={type}
      class={classes}
      disabled={disabled}
      title={title}
      aria-busy={busy || undefined}
      aria-label={busy ? (ariaLabel ?? extractText(children)) : ariaLabel}
      onClick={onClick}
    >
      {busy ? <span class="ios-button__spinner" aria-hidden="true" /> : children}
    </button>
  )
}

// busy 时文案被 spinner 替换，屏幕阅读器仍需从 children 里取到可读标签
function extractText(children: ComponentChildren): string | undefined {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(extractText).filter(Boolean).join('') || undefined
  return undefined
}
