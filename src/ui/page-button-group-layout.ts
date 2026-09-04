/**
 * PageButtonGroup 压缩级联纯函数：输入可用宽与测量值，输出边距/间距/方钮边长/压扁比例。
 * 四级连续阶梯：边距 14→2 → 间距 6→1 → 方钮 28→20 → 文字 scaleX 1→0，
 * 各档对 avail 连续、深档锁定浅档下限；双态钮的「退化为方钮」不在本函数内——
 * 组件侧先按文字档试探，scale < 1 时把双态钮折算进 squares 后重跑本函数。
 */

export const GAP_MAX = 6
export const GAP_MIN = 1
export const PAD_MAX = 14
export const PAD_MIN = 2
/** 按钮左右边框合计 */
export const BORDER = 2
/** 方钮收缩上限（原固定边长），与 page-action-button.css 的 .page-action-button--icon 一致 */
export const ICON_SIDE = 28
/** 方钮收缩下限：视觉可辨识与点击面积的兜底；glyph 随盒等比缩放（--pg-icon-scale），不存在裁切 */
export const ICON_SIDE_MIN = 20

export type GroupLayoutInput = {
  /** 组内容器可用宽（调用方先扣掉 1px 子像素余量） */
  avail: number
  /** 参与文字压缩的按钮数（双态按钮在文字档也计入；可为 0） */
  count: number
  /** 上述按钮 label 自然宽之和 */
  textSum: number
  /** 图标方钮数（纯 --icon 方钮；双态退化后组件侧把它们也计入；可为 0） */
  squares: number
  /** 组内 flex 间距槽数 = 按钮总数 - 1 */
  ngaps: number
}

export type GroupLayout = {
  /** 按钮左右内边距（--pg-pad），[PAD_MIN, PAD_MAX] */
  pad: number
  /** 按钮间距（--pg-gap），[GAP_MIN, GAP_MAX] */
  gap: number
  /** 图标方钮边长（border-box 含边框），[ICON_SIDE_MIN, ICON_SIDE] */
  side: number
  /** label 压扁比例（--pg-label-scale），[0, 1]；<0.999 视为进入压扁档 */
  scale: number
}

export function computeGroupLayout(input: GroupLayoutInput): GroupLayout {
  const { avail, count, textSum, squares, ngaps } = input

  // 纯方钮组：没有文字钮，边距/压扁无事可做；间距 6→1 后方钮连续收缩，
  // 消除旧版「方钮刚性、容器不够只能溢出」的无解角落
  if (count === 0) {
    if (squares === 0 || avail >= squares * ICON_SIDE + ngaps * GAP_MAX) {
      return { pad: PAD_MIN, gap: GAP_MAX, side: ICON_SIDE, scale: 0 }
    }
    const gap = ngaps > 0
      ? Math.max(GAP_MIN, Math.min(GAP_MAX, (avail - squares * ICON_SIDE) / ngaps))
      : GAP_MAX
    const side = Math.max(
      ICON_SIDE_MIN,
      Math.min(ICON_SIDE, (avail - ngaps * gap) / squares),
    )
    return { pad: PAD_MIN, gap, side, scale: 0 }
  }

  // 方钮的刚性占地（收缩档之前按上限计）
  const rigid = squares * ICON_SIDE + count * BORDER + textSum
  // 1. 边距档：剩余空间先全给左右边距（14px → 2px），间距保持 6px、方钮 28px
  let pad = Math.min(PAD_MAX, (avail - rigid - ngaps * GAP_MAX) / (2 * count))
  let gap = GAP_MAX
  let side = ICON_SIDE
  let scale = 1
  if (pad < PAD_MIN) {
    // 2. 间距档：边距到 PAD_MIN 仍放不下时，间距连续收缩
    pad = PAD_MIN
    gap = ngaps > 0
      ? Math.min(GAP_MAX, (avail - rigid - 2 * count * PAD_MIN) / ngaps)
      : GAP_MAX
    // ngaps=0（单按钮组）没有间距可收，直接放行更深的档位——
    // 旧版此处被 gap 恒为 GAP_MAX 卡住，单按钮超宽时只能溢出
    if (gap < GAP_MIN || ngaps === 0) {
      // 3. 方钮收缩档：间距到 GAP_MIN 仍放不下时，方钮 28 → 20 连续收缩，
      //    文字保持不压（能少牺牲少牺牲：8px 盒余量先于整段文字）
      gap = GAP_MIN
      if (squares > 0) {
        side = Math.max(
          ICON_SIDE_MIN,
          Math.min(
            ICON_SIDE,
            (avail - count * (BORDER + 2 * PAD_MIN) - textSum - ngaps * GAP_MIN) /
              squares,
          ),
        )
      }
      // 4. 压扁档：方钮收到下限（或没有方钮）仍放不下时，文字整体连续
      //    压扁（1 → 0，无下限）——压成空按钮也绝不隐藏、绝不折叠
      if (squares === 0 || side <= ICON_SIDE_MIN) {
        const minFootprint =
          count * (BORDER + PAD_MIN * 2) + ngaps * GAP_MIN + squares * ICON_SIDE_MIN
        scale = textSum > 0 ? Math.max(0, (avail - minFootprint) / textSum) : 0
      }
    }
  }
  pad = Math.max(PAD_MIN, Math.min(PAD_MAX, pad))
  gap = Math.max(GAP_MIN, Math.min(GAP_MAX, gap))
  if (scale > 1) scale = 1
  return { pad, gap, side, scale }
}
