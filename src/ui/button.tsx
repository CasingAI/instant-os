import type { ComponentChildren, JSX } from 'preact'
import './button.css'

export type ButtonTone = 'secondary' | 'primary' | 'danger'
export type ButtonVariant = 'filled' | 'borderless'

export type ButtonProps = {
  children?: ComponentChildren
  tone?: ButtonTone
  /** 形态：filled 实体按钮（默认，渐变底+边框）；borderless 裸文字/图标——无底无边，按下时一团亮白光晕叠于内容上方，松手即熄 */
  variant?: ButtonVariant
  /** 图标内容（元素或字符）；与文字互斥——传入即只渲染图标（不渲染 children），children 转作无障碍名回退；例外见 showBothIconAndText */
  icon?: ComponentChildren
  /** 受控例外：icon 与文字并排同显。仅当用户明确要求按钮带图标时才启用；
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

/** iOS 6 拟物按钮：灰底 / 蓝主按钮 / 危险红，另有 borderless 裸形态（裸文字/图标 + 按下光晕叠于内容上方）；可通过 --ios-button-* CSS 变量换皮 */
export function Button({
  children,
  tone = 'secondary',
  variant = 'filled',
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
    variant === 'borderless' ? 'ios-button--borderless' : undefined,
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

// icon-only 由「传了 icon 且未开 showBothIconAndText」直接推断，挂 .ios-button--icon 类；该类已无基础样式，
// 图标钮与文字钮完全同规格（28px 高、min-width 48、padding 0 8px），类名仅作外部应用覆盖几何的钩子保留；
// 图标与文字默认互斥：icon 存在时文字不渲染，屏幕阅读器名从 children 回退（见下方 extractText）；
// 唯一例外是 showBothIconAndText——图标文字并排同显，仅供用户明确要求时使用
// busy 时文案被 spinner 替换，屏幕阅读器仍需从 children 里取到可读标签
function extractText(children: ComponentChildren): string | undefined {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(extractText).filter(Boolean).join('') || undefined
  return undefined
}
