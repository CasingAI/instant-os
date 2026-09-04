import type { ComponentChildren, JSX } from 'preact'
import './button.css'

export type ButtonTone = 'secondary' | 'primary' | 'danger'
export type ButtonSize = 'default' | 'compact'

export type ButtonProps = {
  children?: ComponentChildren
  tone?: ButtonTone
  size?: ButtonSize
  /** 图标内容（元素或字符）；与文字互斥——传入即只渲染图标（方形图标按钮），children 不再显示、转作无障碍名回退；例外见 showBothIconAndText */
  icon?: ComponentChildren
  /** 受控例外：icon 与文字并排同显，不再退化为方形图标钮。仅当用户明确要求按钮带图标时才启用；
   *  未经用户要求默认不得传此属性——icon 互斥设计的目的就是避免主动给按钮乱配图标 */
  showBothIconAndText?: boolean
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
export function Button({
  children,
  tone = 'secondary',
  size = 'default',
  icon,
  showBothIconAndText = false,
  busy = false,
  type = 'button',
  disabled = false,
  title,
  class: className,
  'aria-label': ariaLabel,
  onClick,
}: ButtonProps) {
  const iconOnly = !!icon && !showBothIconAndText
  const classes = [
    'ios-button',
    `ios-button--${tone}`,
    size === 'compact' ? 'ios-button--compact' : undefined,
    iconOnly ? 'ios-button--icon' : undefined,
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
      aria-label={ariaLabel ?? (busy || iconOnly ? extractText(children) : undefined)}
      onClick={onClick}
    >
      {busy ? (
        <span class="ios-button__spinner" aria-hidden="true" />
      ) : (
        <>
          {icon ? <span class="ios-button__icon">{icon}</span> : undefined}
          {iconOnly ? undefined : children}
        </>
      )}
    </button>
  )
}

// 方形图标按钮（.ios-button--icon）由「传了 icon 且未开 showBothIconAndText」直接推断，不再有独立布尔开关；
// 图标与文字默认互斥：icon 存在时文字不渲染，屏幕阅读器名从 children 回退（见下方 extractText）；
// 唯一例外是 showBothIconAndText——图标文字并排同显、走常规胶囊样式，仅供用户明确要求时使用
// busy 时文案被 spinner 替换，屏幕阅读器仍需从 children 里取到可读标签
function extractText(children: ComponentChildren): string | undefined {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(extractText).filter(Boolean).join('') || undefined
  return undefined
}
