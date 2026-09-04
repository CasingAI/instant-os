/**
 * PageButtonGroup 压缩级联纯函数：输入可用宽与测量值，输出边距/间距/压扁比例。
 * 从 page-button-group.tsx 原样抽出（数值行为不变），便于单测锁定「压缩逻辑不改」。
 */

export const GAP_MAX = 6
export const GAP_MIN = 1
export const PAD_MAX = 14
export const PAD_MIN = 2
/** 按钮左右边框合计 */
export const BORDER = 2
/** 图标方钮固定边长，与 page-action-button.css 的 .page-action-button--icon 一致 */
export const ICON_SIDE = 28

export type GroupLayoutInput = {
  /** 组内容器可用宽（调用方先扣掉 1px 子像素余量） */
  avail: number
  /** 参与文字压缩的按钮数（双态按钮在文字档也计入；可为 0） */
  count: number
  /** 上述按钮 label 自然宽之和 */
  textSum: number
  /** 固定占地：icon 方钮实测宽 + 图标档下双态方钮（ICON_SIDE × 个数） */
  fixed: number
  /** 组内 flex 间距槽数 = 按钮总数 - 1 */
  ngaps: number
}

export type GroupLayout = {
  /** 按钮左右内边距（--pg-pad），[PAD_MIN, PAD_MAX] */
  pad: number
  /** 按钮间距（--pg-gap），[GAP_MIN, GAP_MAX] */
  gap: number
  /** label 压扁比例（--pg-label-scale），[0, 1]；<0.999 视为进入压扁档 */
  scale: number
}

/**
 * 三级连续级联（无跳变）：
 *   1. 边距档：剩余空间先全给左右边距（PAD_MAX → PAD_MIN），间距保持 GAP_MAX；
 *   2. 间距档：边距到 PAD_MIN 仍放不下时间距 GAP_MAX → GAP_MIN 连续收缩；
 *   3. 压扁档：间距到 GAP_MIN 仍放不下时 label 整体 scaleX 1 → 0，没有下限。
 * 双态按钮的「退化为图标」不在本函数内——组件侧先按纯文字档试探，
 * scale < 1 时把双态钮折算成 ICON_SIDE 固定占地后重跑本函数。
 */
export function computeGroupLayout(input: GroupLayoutInput): GroupLayout {
  const { avail, count, textSum, fixed, ngaps } = input

  // 没有文字按钮可压（全组双态已退化为方钮/方钮组）：边距无事可做，
  // 间距按剩余空间在 [GAP_MIN, GAP_MAX] 内分配，scale 归零
  if (count === 0) {
    const gap = ngaps > 0
      ? Math.min(GAP_MAX, Math.max(GAP_MIN, (avail - fixed) / ngaps))
      : GAP_MAX
    return { pad: PAD_MIN, gap, scale: 0 }
  }

  // 1. 边距档：边距+间距之外还剩多少给 padding 与 gap 分
  const free = avail - fixed - count * BORDER - textSum
  let pad = Math.min(PAD_MAX, (free - ngaps * GAP_MAX) / (2 * count))
  let gap = GAP_MAX
  let scale = 1
  if (pad < PAD_MIN) {
    // 2. 间距档：边距到 PAD_MIN 仍放不下时，间距连续收缩
    pad = PAD_MIN
    gap = ngaps > 0
      ? Math.min(GAP_MAX, (free - 2 * count * PAD_MIN) / ngaps)
      : GAP_MAX
    if (gap < GAP_MIN) {
      // 3. 压扁档：间距到 GAP_MIN 仍放不下时，文字整体连续压扁（1 → 0，无下限）
      gap = GAP_MIN
      const minFootprint =
        count * (BORDER + PAD_MIN * 2) + ngaps * GAP_MIN + fixed
      scale = textSum > 0 ? Math.max(0, (avail - minFootprint) / textSum) : 0
    }
  }
  pad = Math.max(PAD_MIN, Math.min(PAD_MAX, pad))
  gap = Math.max(GAP_MIN, Math.min(GAP_MAX, gap))
  if (scale > 1) scale = 1
  return { pad, gap, scale }
}
