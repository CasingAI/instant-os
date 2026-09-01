import type { ComponentChildren } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import './page-button-group.css'

export type PageButtonGroupProps = {
  /** 一组 PageActionButton（可混入 icon 方钮，方钮不参与压缩/折叠） */
  children?: ComponentChildren
  class?: string
}

const GAP = 6
const PAD_MAX = 14
const PAD_MIN = 2
const BORDER = 2
/** 文字压扁的极限比例（再扁就收按钮） */
const SCALE_FLOOR = 0.6

/**
 * 按钮组：一组操作按钮的统一容器。压缩程度按「内容自然宽 / 可用宽」的
 * 压缩率决定，而不是绝对宽度——同样宽度下按钮越多越早压缩，单按钮永不压缩。
 *
 * 实现：挂载时一次性测量各文字按钮的内容自然宽（label 的边界宽，
 * 此时尚未压缩）与 icon 方钮的固定宽，之后 ResizeObserver 监听组宽，
 * 按三级压缩级联实时重算，并把每个可见按钮的布局宽度显式写死：
 *   1. 边距档：左右边距 14px → 2px 连续分配（空间越多边距越宽，无跳变）；
 *   2. 压扁档：边距到 2px 仍放不下时，label 按比例 scaleX 1 → 0.6 连续
 *      压扁——transform 不改布局，因此按钮布局宽同步收窄为
 *      文字宽 × 比例，文字画满分配到的宽度（替代省略号）；
 *   3. 折叠档：压扁到 0.6 仍放不下时，才从右往左收走靠右按钮，
 *      剩余按钮重新参与 1、2 档分配（不再出现残肢文字）。
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
    // 单个文字按钮没有压缩需求（也无需折叠）
    if (textButtons.length < 2) return

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
    // prefix[i] = 前 i 个按钮（文字 + 边框）的总宽
    const prefix = [0]
    for (const w of textWidths) {
      prefix.push(prefix[prefix.length - 1] + w + BORDER)
    }

    const applyPressure = () => {
      const width = el.getBoundingClientRect().width
      // 1px 余量防子像素取整溢出（宁可早半步压扁/折叠，不出现残肢/溢出）
      const avail = width - 1
      // 1. 折叠档：剩余按钮压扁到极限仍放不下时，从右往左收
      let folds = 0
      while (folds < textButtons.length - 1) {
        const kept = textButtons.length - folds
        const textSum = prefix[kept] - BORDER * kept
        const gaps = GAP * (kept + iconButtons.length - 1)
        const needSquashed =
          SCALE_FLOOR * textSum +
          kept * (BORDER + PAD_MIN * 2) +
          iconFixed +
          gaps
        if (needSquashed <= avail) break
        folds++
      }
      const kept = textButtons.length - folds
      const textSum = prefix[kept] - BORDER * kept
      const gaps = GAP * (kept + iconButtons.length - 1)
      // 2. 边距档：剩余空间先全部给边距（14px → 2px）
      let pad =
        (avail - iconFixed - gaps - textSum - kept * BORDER) / (2 * kept)
      let scale = 1
      if (pad < PAD_MIN) {
        // 3. 压扁档：边距到 2px 还放不下时，文字整体压扁（1 → 0.6）
        scale =
          (avail - iconFixed - gaps - kept * (BORDER + PAD_MIN * 2)) / textSum
        if (scale < SCALE_FLOOR) scale = SCALE_FLOOR
        pad = PAD_MIN
      }
      pad = Math.min(PAD_MAX, pad)

      for (let i = 0; i < textButtons.length; i++) {
        const hidden = i >= textButtons.length - folds
        const button = textButtons[i]
        button.style.display = hidden ? 'none' : ''
        if (!hidden) {
          button.style.width = `${(scale * textWidths[i] + BORDER + pad * 2).toFixed(2)}px`
        }
      }
      el.classList.toggle('pg-shrink-label', scale < 0.999)
      el.style.setProperty('--pg-pad', `${pad.toFixed(2)}px`)
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