import type { ComponentChildren } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import './page-button-group.css'

export type PageButtonGroupProps = {
  /** 一组 PageActionButton（可混入 icon 方钮，方钮不参与压缩） */
  children?: ComponentChildren
  class?: string
}

const GAP_MAX = 6
const GAP_MIN = 1
const PAD_MAX = 14
const PAD_MIN = 2
const BORDER = 2

/**
 * 按钮组：一组操作按钮的统一容器。压缩程度按「内容自然宽 / 可用宽」的
 * 压缩率决定，而不是绝对宽度——同样宽度下按钮越多越早压缩，单按钮永不压缩。
 *
 * 实现：挂载时一次性测量各文字按钮的内容自然宽（label 的边界宽，
 * 此时尚未压缩）与 icon 方钮的固定宽，之后 ResizeObserver 监听组宽，
 * 按三级压缩级联实时重算，并把每个按钮的布局宽度显式写死：
 *   1. 边距档：左右边距 14px → 2px 连续分配（空间越多边距越宽，无跳变）；
 *   2. 间距档：边距到 2px 仍放不下时，按钮间距 6px → 1px 连续收缩；
 *   3. 压扁档：间距到 1px 仍放不下时，label 按比例 scaleX 1 → 0 连续压扁，
 *      没有下限——压成空按钮也绝不隐藏、绝不折叠。
 *      transform 不改布局，按钮布局宽同步收窄为 文字宽 × 比例；压扁以
 *      label 自身中心为原点，文字始终精确居中（见 page-button-group.css）。
 * 组内按钮 flex-shrink: 0，宽度完全由测量决定，杜绝 flex 二次压缩产生的
 * 残肢边距与省略号。
 */
export function PageButtonGroup({
  children,
  class: className,
}: PageButtonGroupProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const textButtons = Array.from(
      el.querySelectorAll<HTMLElement>(
        '.page-action-button:not(.page-action-button--icon)',
      ),
    )
    if (textButtons.length === 0) return

    // 用边界宽拿小数精度（scrollWidth 只给整数）；元素处于隐藏子树时测到 0，
    // 此时放弃接管，按钮保持系统默认外观
    const textWidths = textButtons.map((button) => {
      const label = button.querySelector('.page-action-button__label')
      return label instanceof HTMLElement
        ? label.getBoundingClientRect().width
        : 0
    })
    const iconButtons = Array.from(
      el.querySelectorAll<HTMLElement>('.page-action-button--icon'),
    )
    const iconFixed = iconButtons.reduce(
      (sum, icon) => sum + icon.getBoundingClientRect().width,
      0,
    )
    if (textWidths.some((w) => w <= 0) || (iconButtons.length > 0 && iconFixed <= 0)) {
      return
    }
    const count = textButtons.length
    const textSum = textWidths.reduce((sum, w) => sum + w, 0)
    const ngaps = count + iconButtons.length - 1
    // 全体按钮在「边距 2px + 间距 1px + 文字压没」时的最小占地；
    // 可用宽低于它只能溢出
    const minFootprint = count * (BORDER + PAD_MIN * 2) + ngaps * GAP_MIN + iconFixed

    const applyPressure = () => {
      const width = el.getBoundingClientRect().width
      // 1px 余量防子像素取整溢出（宁可早半步压扁，不出现残肢/溢出）
      const avail = width - 1
      // 边距+间距之外还剩多少给 padding 与 gap 分
      const free = avail - iconFixed - count * BORDER - textSum
      // 1. 边距档：剩余空间先全给左右边距（14px → 2px），间距保持 6px
      let pad = Math.min(
        PAD_MAX,
        (free - ngaps * GAP_MAX) / (2 * count),
      )
      let gap = GAP_MAX
      let scale = 1
      if (pad < PAD_MIN) {
        // 2. 间距档：边距到 2px 仍放不下时，按钮间距 6px → 1px 连续收缩
        pad = PAD_MIN
        gap = ngaps > 0
          ? Math.min(GAP_MAX, (free - 2 * count * PAD_MIN) / ngaps)
          : GAP_MAX
        if (gap < GAP_MIN) {
          // 3. 压扁档：间距到 1px 仍放不下时，文字整体连续压扁（1 → 0，无下限）
          gap = GAP_MIN
          scale = textSum > 0 ? Math.max(0, (avail - minFootprint) / textSum) : 0
        }
      }
      pad = Math.max(PAD_MIN, Math.min(PAD_MAX, pad))
      gap = Math.max(GAP_MIN, Math.min(GAP_MAX, gap))
      if (scale > 1) scale = 1

      for (let i = 0; i < count; i++) {
        textButtons[i].style.width = `${(
          scale * textWidths[i] +
          BORDER +
          pad * 2
        ).toFixed(2)}px`
      }
      el.classList.toggle('pg-shrink-label', scale < 0.999)
      el.style.setProperty('--pg-pad', `${pad.toFixed(2)}px`)
      el.style.setProperty('--pg-gap', `${gap.toFixed(2)}px`)
      el.style.setProperty('--pg-label-scale', scale.toFixed(3))
    }

    applyPressure()
    const observer = new ResizeObserver(applyPressure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      class={`page-button-group${className ? ` ${className}` : ''}`}
    >
      {children}
    </div>
  )
}
