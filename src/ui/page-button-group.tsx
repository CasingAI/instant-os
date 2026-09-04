import type { ComponentChildren } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { BORDER, ICON_SIDE, computeGroupLayout } from './page-button-group-layout.ts'
import './page-button-group.css'

export type PageButtonGroupProps = {
  /** 一组 PageActionButton（可混入 icon 方钮与 icon+文字双态钮：方钮不参与压缩，双态钮放不下时整钮退化为方钮） */
  children?: ComponentChildren
  class?: string
}

/**
 * 按钮组：一组操作按钮的统一容器。压缩程度按「内容自然宽 / 可用宽」的
 * 压缩率决定，而不是绝对宽度——同样宽度下按钮越多越早压缩，单按钮永不压缩。
 *
 * 实现：挂载时一次性测量各文字按钮的内容自然宽（label 的边界宽，
 * 此时尚未压缩）与 icon 方钮的固定宽，之后 ResizeObserver 监听组宽，
 * 按多级压缩级联实时重算，并把每个按钮的布局宽度显式写死：
 *   1. 边距档：左右边距 14px → 2px 连续分配（空间越多边距越宽，无跳变）；
 *   2. 间距档：边距到 2px 仍放不下时，按钮间距 6px → 1px 连续收缩；
 *   3. 退位档：间距到 1px 仍放不下时，双态按钮（icon + 文字）先整钮退化
 *      为 28px 图标方钮（文字消失、图标恢复，见 pg-icon-mode），把文字
 *      空间让给纯文字按钮——让完后够用就止步于此；
 *   4. 压扁档：双态退光仍放不下时，纯文字按钮 label 按比例 scaleX 1 → 0
 *      连续压扁，没有下限——压成空按钮也绝不隐藏、绝不折叠。
 *      transform 不改布局，按钮布局宽同步收窄为 文字宽 × 比例；压扁以
 *      label 自身中心为原点，文字始终精确居中（见 page-button-group.css）。
 * 组内按钮 flex-shrink: 0，宽度完全由测量决定，杜绝 flex 二次压缩产生的
 * 残肢边距与省略号。级联数学抽在 page-button-group-layout.ts（纯函数，
 * 单测锁定与旧实现逐位等价）。
 */
export function PageButtonGroup({
  children,
  class: className,
}: PageButtonGroupProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const buttons = Array.from(
      el.querySelectorAll<HTMLElement>('.page-action-button'),
    )
    const textButtons = buttons.filter(
      (button) =>
        !button.classList.contains('page-action-button--icon') &&
        !button.classList.contains('page-action-button--dual'),
    )
    const dualButtons = buttons.filter((button) =>
      button.classList.contains('page-action-button--dual'),
    )
    if (textButtons.length + dualButtons.length === 0) return

    // 用边界宽拿小数精度（scrollWidth 只给整数）；元素处于隐藏子树时测到 0，
    // 此时放弃接管，按钮保持系统默认外观。双态钮在文字档图标是 display:none，
    // 与文字钮一样只量 label
    const labelWidth = (button: HTMLElement) => {
      const label = button.querySelector('.page-action-button__label')
      return label instanceof HTMLElement
        ? label.getBoundingClientRect().width
        : 0
    }
    const textWidths = textButtons.map(labelWidth)
    const dualWidths = dualButtons.map(labelWidth)
    const iconButtons = Array.from(
      el.querySelectorAll<HTMLElement>('.page-action-button--icon'),
    )
    const iconFixed = iconButtons.reduce(
      (sum, icon) => sum + icon.getBoundingClientRect().width,
      0,
    )
    if (
      [...textWidths, ...dualWidths].some((w) => w <= 0) ||
      (iconButtons.length > 0 && iconFixed <= 0)
    ) {
      return
    }
    const textSum = textWidths.reduce((sum, w) => sum + w, 0)
    const dualSum = dualWidths.reduce((sum, w) => sum + w, 0)
    const ngaps = buttons.length - 1

    const applyPressure = () => {
      // 1px 余量防子像素取整溢出（宁可早半步压扁，不出现残肢/溢出）
      const avail = el.getBoundingClientRect().width - 1
      // 文字段：全部文字按钮（含双态）先一起按文字参与边距/间距压缩
      let layout = computeGroupLayout({
        avail,
        count: textButtons.length + dualButtons.length,
        textSum: textSum + dualSum,
        fixed: iconFixed,
        ngaps,
      })
      let iconMode = false
      if (layout.scale < 0.999 && dualButtons.length > 0) {
        // 3. 退位档：文字放不下 → 双态按钮整钮退化为 28px 图标方钮，
        //    腾出的空间重跑级联分给纯文字按钮；仍不够才进入压扁档
        iconMode = true
        layout = computeGroupLayout({
          avail,
          count: textButtons.length,
          textSum,
          fixed: iconFixed + dualButtons.length * ICON_SIDE,
          ngaps,
        })
      }
      el.classList.toggle('pg-icon-mode', iconMode)
      el.classList.toggle('pg-shrink-label', layout.scale < 0.999)
      el.style.setProperty('--pg-pad', `${layout.pad.toFixed(2)}px`)
      el.style.setProperty('--pg-gap', `${layout.gap.toFixed(2)}px`)
      el.style.setProperty('--pg-label-scale', layout.scale.toFixed(3))

      for (let i = 0; i < textButtons.length; i++) {
        textButtons[i].style.width = `${(
          layout.scale * textWidths[i] +
          BORDER +
          layout.pad * 2
        ).toFixed(2)}px`
      }
      for (let i = 0; i < dualButtons.length; i++) {
        dualButtons[i].style.width = iconMode
          ? `${ICON_SIDE}px`
          : `${(
              layout.scale * dualWidths[i] +
              BORDER +
              layout.pad * 2
            ).toFixed(2)}px`
      }
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
