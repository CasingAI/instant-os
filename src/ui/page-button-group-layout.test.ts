/**
 * PageButtonGroup 压缩级联纯函数：golden 数值 + 与旧实现的逐位等价。
 * 运行：node --experimental-strip-types src/ui/page-button-group-layout.test.ts
 */
import assert from 'node:assert/strict'
import {
  BORDER,
  GAP_MAX,
  GAP_MIN,
  ICON_SIDE,
  PAD_MAX,
  PAD_MIN,
  computeGroupLayout,
} from './page-button-group-layout.ts'

// 常量与 CSS 几何的契约
{
  assert.equal(ICON_SIDE, 28, '与 .page-action-button--icon 固定边一致')
  assert.equal(BORDER, 2)
  assert.deepEqual([PAD_MIN, PAD_MAX, GAP_MIN, GAP_MAX], [2, 14, 1, 6])
}

// 旧实现（抽函数前的 applyPressure 内联公式），作为等价性基准
function legacyLayout(
  avail: number,
  count: number,
  textSum: number,
  iconFixed: number,
  ngaps: number,
): { pad: number; gap: number; scale: number } {
  const free = avail - iconFixed - count * BORDER - textSum
  let pad = Math.min(PAD_MAX, (free - ngaps * GAP_MAX) / (2 * count))
  let gap = GAP_MAX
  let scale = 1
  if (pad < PAD_MIN) {
    pad = PAD_MIN
    gap = ngaps > 0
      ? Math.min(GAP_MAX, (free - 2 * count * PAD_MIN) / ngaps)
      : GAP_MAX
    if (gap < GAP_MIN) {
      gap = GAP_MIN
      const minFootprint =
        count * (BORDER + PAD_MIN * 2) + ngaps * GAP_MIN + iconFixed
      scale = textSum > 0 ? Math.max(0, (avail - minFootprint) / textSum) : 0
    }
  }
  pad = Math.max(PAD_MIN, Math.min(PAD_MAX, pad))
  gap = Math.max(GAP_MIN, Math.min(GAP_MAX, gap))
  if (scale > 1) scale = 1
  return { pad, gap, scale }
}

// golden：边距档（宽裕 → 满边距）
{
  assert.deepEqual(
    computeGroupLayout({ avail: 400, count: 2, textSum: 100, fixed: 28, ngaps: 2 }),
    { pad: 14, gap: 6, scale: 1 },
  )
  // 边距档中段：边距随空间连续收缩
  assert.deepEqual(
    computeGroupLayout({ avail: 180, count: 2, textSum: 100, fixed: 28, ngaps: 2 }),
    { pad: 9, gap: 6, scale: 1 },
  )
}

// golden：间距档（边距到底 2px，间距 6 → 1 收缩中）
{
  assert.deepEqual(
    computeGroupLayout({ avail: 150, count: 2, textSum: 100, fixed: 28, ngaps: 2 }),
    { pad: 2, gap: 5, scale: 1 },
  )
}

// golden：压扁档（间距到底 1px，label 按剩余空间压扁）
{
  assert.deepEqual(
    computeGroupLayout({ avail: 100, count: 2, textSum: 100, fixed: 28, ngaps: 2 }),
    { pad: 2, gap: 1, scale: 0.58 },
  )
  // 压扁比例夹取：正好放得下 → 1；彻底放不下 → 0
  assert.equal(computeGroupLayout({ avail: 142, count: 2, textSum: 100, fixed: 28, ngaps: 2 }).scale, 1)
  assert.equal(computeGroupLayout({ avail: 40, count: 2, textSum: 100, fixed: 28, ngaps: 2 }).scale, 0)
  // 空 label：不产生 NaN，直接压没
  assert.equal(computeGroupLayout({ avail: 40, count: 2, textSum: 0, fixed: 28, ngaps: 2 }).scale, 0)
}

// golden：count = 0（全组已退化为方钮）——间距按剩余空间分配、无 NaN
{
  assert.deepEqual(
    computeGroupLayout({ avail: 100, count: 0, textSum: 0, fixed: 56, ngaps: 1 }),
    { pad: 2, gap: 6, scale: 0 },
  )
  assert.deepEqual(
    computeGroupLayout({ avail: 57, count: 0, textSum: 0, fixed: 56, ngaps: 1 }),
    { pad: 2, gap: 1, scale: 0 },
  )
  assert.deepEqual(
    computeGroupLayout({ avail: 54, count: 0, textSum: 0, fixed: 56, ngaps: 1 }),
    { pad: 2, gap: 1, scale: 0 },
    '剩余为负时间距夹在 GAP_MIN',
  )
}

// 等价性 fuzz：与旧内联公式逐位一致（压缩逻辑不改的回归证明）。
// LCG 确定性伪随机，覆盖三级档位与边界。
{
  let seed = 0x2f6e2b1
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
  }
  for (let i = 0; i < 2000; i++) {
    const count = 1 + Math.floor(next() * 6)
    const textSum = next() * 400
    const fixed = Math.floor(next() * 5) * 28
    const ngaps = Math.floor(next() * 8)
    const avail = next() * 600
    assert.deepEqual(
      computeGroupLayout({ avail, count, textSum, fixed, ngaps }),
      legacyLayout(avail, count, textSum, fixed, ngaps),
      `avail=${avail} count=${count} textSum=${textSum} fixed=${fixed} ngaps=${ngaps}`,
    )
  }
}
