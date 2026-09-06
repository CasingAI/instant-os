import type { ComponentChildren, JSX } from 'preact'
import './button.css'

export type ButtonTone = 'secondary' | 'primary' | 'danger'
export type ButtonVariant = 'filled' | 'borderless'

export type ButtonProps = {
  children?: ComponentChildren
  /** 按钮色调（仅 filled 生效；borderless 固定白字，传入不生效） */
  tone?: ButtonTone
  /** 形态：filled 实体按钮（默认，渐变底+边框）；borderless 单一类型裸文字/图标——无底无边固定白字，按下时一团纯白光晕垫于内容之下，松手即熄 */
  variant?: ButtonVariant
  /** 图标内容；与文字互斥——传入即只渲染图标（不渲染 children），children 转作无障碍名回退；例外见 showBothIconAndText */
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
  /** 挂载回调：拿到最外层 <button> 真实节点（锚定弹层等场景靠它定位）；卸载时以 null 回调 */
  ref?: (el: HTMLButtonElement | null) => void
  onClick?: JSX.MouseEventHandler<HTMLButtonElement>
}

/** iOS 6 拟物按钮：灰底 / 蓝主按钮 / 危险红，另有 borderless 裸形态（单一白字裸按钮 + 按下光晕垫于内容之下）；可通过 --ios-button-* CSS 变量换皮 */
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
  ref,
  onClick,
}: ButtonProps) {
  const iconOnly = !!icon && !showBothIconAndText
  const classes = [
    'ios-button',
    `ios-button--${tone}`,
    variant === 'borderless' ? 'ios-button--borderless' : undefined,
    iconOnly ? 'ios-button--icon' : undefined,
    icon && showBothIconAndText ? 'ios-button--icon-text' : undefined,
    busy ? 'ios-button--busy' : undefined,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type={type}
      ref={ref}
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
          {iconOnly ? undefined : <span class="ios-button__label">{children}</span>}
        </>
      )}
    </button>
  )
}

// icon-only 由「传了 icon 且未开 showBothIconAndText」直接推断，挂 .ios-button--icon 类；
// 纯图标钮默认几何：左右 padding 0（配 min-width 28px 成 28×28 方钮）、图标 24px、字重 400（见 button.css），
// 类名同时保留作外部应用覆盖几何的钩子；
// 图标与文字默认互斥：icon 存在时文字不渲染，屏幕阅读器名从 children 回退（见下方 extractText）；
// 唯一例外是 showBothIconAndText——图标文字并排同显（挂 .ios-button--icon-text，左内边距归零，见 button.css），
// 仅供用户明确要求时使用
// busy 时文案被 spinner 替换，屏幕阅读器仍需从 children 里取到可读标签
//
// ⚠️ 任何情况下都强烈不推荐用 Unicode 字符（← → ＋ ✓ ✕ …）来表达图案：
// 字符图标在不同系统/字体下形状不一、缺字时直接显示成方框，粗细和对齐也没法跟图标库统一。
// 图标一律传 <Icon>（Material Symbols）或自绘元素，本项目内置图标见 src/ui 下的 Icon 组件；
// 下方涉及「字符图标」的兼容样式只是对历史遗留的兜底，不是允许新代码这么写。
function extractText(children: ComponentChildren): string | undefined {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(extractText).filter(Boolean).join('') || undefined
  return undefined
}
