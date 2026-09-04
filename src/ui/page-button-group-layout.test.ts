/**
 * PageButtonGroup 压缩级联纯函数：golden 数值 + 与旧三级实现的等价/单调/不溢出不变量。
 * 运行：node --experimental-strip-types src/ui/page-button-group-layout.test.ts
 */
import assert from 'node:assert/strict'
import {
  BORDER,
  GAP_MAX,
  GAP_MIN,
  ICON_SIDE,
  ICON_SIDE_MIN,
  PAD_MAX,
  PAD_MIN,
  computeGroupLayout,
} from './page-button-group-layout.ts'

const EPS = 1e-9

function almostEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS
}

function assertAlmostDeepEqual(
  actual: { pad: number; gap: number; side: number; scale: number },
  expected: { pad: number; gap: number; side: number; scale: number },
  message?: string,
): void {
  assert.ok(almostEqual(actual.pad, expected.pad), `${message ?? ''} pad=${actual.pad}`)
  assert.ok(almostEqual(actual.gap, expected.gap), `${message ?? ''} gap=${actual.gap}`)
  assert.ok(almostEqual(actual.side, expected.side), `${message ?? ''} side=${actual.side}`)
  assert.ok(almostEqual(actual.scale, expected.scale), `${message ?? ''} scale=${actual.scale}`)
}

// 常量与 CSS 几何的契约
{
  assert.equal(ICON_SIDE, 28, '与 .page-action-button--icon 固定边一致')
  assert.equal(ICON_SIDE_MIN, 20, '按 ≤14px glyph 设计：13px 图标在 20px 盒内仍有呼吸')
  assert.equal(BORDER, 2)
  assert.deepEqual([PAD_MIN, PAD_MAX, GAP_MIN, GAP_MAX], [2, 14, 1, 6])
}

// 旧三级实现（方钮为刚性 fixed 项），作为 squares=0 时的等价性基准
function legacyLayout(
  avail: number,
  count: number,
  textSum: number,
  fixed: number,
  ngaps: number,
): { pad: number; gap: number; side: number; scale: number } {
  const free = avail - fixed - count * BORDER - textSum
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
        count * (BORDER + PAD_MIN * 2) + ngaps * GAP_MIN + fixed
      scale = textSum > 0 ? Math.max(0, (avail - minFootprint) / textSum) : 0
    }
  }
  pad = Math.max(PAD_MIN, Math.min(PAD_MAX, pad))
  gap = Math.max(GAP_MIN, Math.min(GAP_MAX, gap))
  if (scale > 1) scale = 1
  return { pad, gap, side: ICON_SIDE, scale }
}

// golden：边距档（宽裕 → 满边距，方钮保持 28）
{
  assert.deepEqual(
    computeGroupLayout({ avail: 400, count: 2, textSum: 100, squares: 1, ngaps: 2 }),
    { pad: 14, gap: 6, side: 28, scale: 1 },
  )
  // 边距档中段：边距随空间连续收缩
  assert.deepEqual(
    computeGroupLayout({ avail: 180, count: 2, textSum: 100, squares: 1, ngaps: 2 }),
    { pad: 9, gap: 6, side: 28, scale: 1 },
  )
}

// golden：间距档（边距到底 2px，间距 6 → 1 收缩中，方钮仍 28）
{
  assert.deepEqual(
    computeGroupLayout({ avail: 150, count: 2, textSum: 100, squares: 1, ngaps: 2 }),
    { pad: 2, gap: 5, side: 28, scale: 1 },
  )
  // 间距恰好到底（=1）仍在间距档，方钮未动
  assert.deepEqual(
    computeGroupLayout({ avail: 142, count: 2, textSum: 100, squares: 1, ngaps: 2 }),
    { pad: 2, gap: 1, side: 28, scale: 1 },
  )
}

// golden：方钮收缩档（间距到底 1px，方钮 28 → 20 连续收缩，文字不压）
{
  // 中段：side = avail - count*(BORDER+2*PAD_MIN) - textSum - ngaps
  assert.deepEqual(
    computeGroupLayout({ avail: 138, count: 2, textSum: 100, squares: 1, ngaps: 2 }),
    { pad: 2, gap: 1, side: 24, scale: 1 },
  )
  // 紧贴间距档边界连续（141.9 → side 27.9）
  assertAlmostDeepEqual(
    computeGroupLayout({ avail: 141.9, count: 2, textSum: 100, squares: 1, ngaps: 2 }),
    { pad: 2, gap: 1, side: 27.9, scale: 1 },
    '方钮档入口',
  )
  // 收缩到底（side=20）时 scale 恰为 1，压扁档无跳变
  assert.deepEqual(
    computeGroupLayout({ avail: 134, count: 2, textSum: 100, squares: 1, ngaps: 2 }),
    { pad: 2, gap: 1, side: 20, scale: 1 },
  )
}

// golden：压扁档（方钮钉在 20，minFootprint 以 20 计）
{
  assert.deepEqual(
    computeGroupLayout({ avail: 100, count: 2, textSum: 100, squares: 1, ngaps: 2 }),
    { pad: 2, gap: 1, side: 20, scale: 0.66 },
  )
  // 压扁比例夹取：正好放得下 → 1；彻底放不下 → 0
  assert.equal(computeGroupLayout({ avail: 134, count: 2, textSum: 100, squares: 1, ngaps: 2 }).scale, 1)
  assert.equal(computeGroupLayout({ avail: 34, count: 2, textSum: 100, squares: 1, ngaps: 2 }).scale, 0)
  assert.equal(computeGroupLayout({ avail: 20, count: 2, textSum: 100, squares: 1, ngaps: 2 }).scale, 0)
  // 空 label 且方钮收到底（进入压扁档）：NaN 守卫生效，scale 归零
  assert.equal(computeGroupLayout({ avail: 34, count: 2, textSum: 0, squares: 1, ngaps: 2 }).scale, 0)
  // 空 label 但方钮未收到底：压力被收缩档吸收，无 NaN、scale 保持 1
  assert.deepEqual(
    computeGroupLayout({ avail: 40, count: 2, textSum: 0, squares: 1, ngaps: 2 }),
    { pad: 2, gap: 1, side: 26, scale: 1 },
  )
  // 无方钮组：与旧三级同解（minFootprint 不含方钮项）
  assert.deepEqual(
    computeGroupLayout({ avail: 100, count: 2, textSum: 100, squares: 0, ngaps: 2 }),
    { pad: 2, gap: 1, side: 28, scale: 0.86 },
  )
}

// golden：纯方钮组（count=0）——间距 6→1 后方钮 28→20，不再溢出无解
{
  assert.deepEqual(
    computeGroupLayout({ avail: 200, count: 0, textSum: 0, squares: 3, ngaps: 2 }),
    { pad: 2, gap: 6, side: 28, scale: 0 },
  )
  assert.deepEqual(
    computeGroupLayout({ avail: 90, count: 0, textSum: 0, squares: 3, ngaps: 2 }),
    { pad: 2, gap: 3, side: 28, scale: 0 },
  )
  assert.deepEqual(
    computeGroupLayout({ avail: 80, count: 0, textSum: 0, squares: 3, ngaps: 2 }),
    { pad: 2, gap: 1, side: 26, scale: 0 },
  )
  assert.deepEqual(
    computeGroupLayout({ avail: 62, count: 0, textSum: 0, squares: 3, ngaps: 2 }),
    { pad: 2, gap: 1, side: 20, scale: 0 },
  )
  // 彻底放不下：方钮钉在 20（声明性溢出）
  assert.deepEqual(
    computeGroupLayout({ avail: 50, count: 0, textSum: 0, squares: 3, ngaps: 2 }),
    { pad: 2, gap: 1, side: 20, scale: 0 },
  )
}

// 等价性 fuzz：squares=0 时与旧三级实现逐位一致（方钮刚性是唯一的旧语义，收窄于此）。
// ngaps=0（单按钮组）除外：旧版被「gap 恒为 GAP_MAX」卡住永远不压扁、只能溢出，
// 本次顺带修正为允许压扁，故等价断言仅覆盖 ngaps ≥ 1。LCG 确定性伪随机。
{
  let seed = 0x2f6e2b1
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
  }
  for (let i = 0; i < 2000; i++) {
    const count = 1 + Math.floor(next() * 6)
    const textSum = next() * 400
    const ngaps = 1 + Math.floor(next() * 7)
    const avail = next() * 600
    assertAlmostDeepEqual(
      computeGroupLayout({ avail, count, textSum, squares: 0, ngaps }),
      legacyLayout(avail, count, textSum, 0, ngaps),
      `avail=${avail} count=${count} textSum=${textSum} ngaps=${ngaps}`,
    )
  }
}

// golden：单按钮组（ngaps=0）——旧版溢出死角，现在正常进入压扁档
{
  assert.deepEqual(
    computeGroupLayout({ avail: 50, count: 1, textSum: 40, squares: 0, ngaps: 0 }),
    { pad: 4, gap: 6, side: 28, scale: 1 },
  )
  assert.deepEqual(
    computeGroupLayout({ avail: 46, count: 1, textSum: 40, squares: 0, ngaps: 0 }),
    { pad: 2, gap: 6, side: 28, scale: 1 },
  )
  assertAlmostDeepEqual(
    computeGroupLayout({ avail: 45, count: 1, textSum: 40, squares: 0, ngaps: 0 }),
    // gap 进深档后置为 GAP_MIN——单按钮组没有间距槽，纯形式值
    { pad: 2, gap: 1, side: 28, scale: 0.975 },
    '单按钮压扁',
  )
}

// 不变量 fuzz：avail 递减 ⇒ pad/gap/side/scale 单调不增；有解域内写入总宽 ≤ avail
{
  let seed = 0x51ed270b
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
  }
  const fit = (l: { pad: number; gap: number; side: number; scale: number }, c: number, t: number, q: number, g: number) =>
    l.scale * t + c * (BORDER + 2 * l.pad) + q * l.side + g * l.gap

  for (let i = 0; i < 200; i++) {
    const count = 1 + Math.floor(next() * 6)
    const textSum = next() * 400
    const squares = Math.floor(next() * 6)
    const ngaps = count + squares - 1 + Math.floor(next() * 2)
    let prev = computeGroupLayout({ avail: 700, count, textSum, squares, ngaps })
    for (let avail = 699.5; avail >= 0; avail -= 0.5) {
      const layout = computeGroupLayout({ avail, count, textSum, squares, ngaps })
      assert.ok(layout.pad <= prev.pad + EPS, `pad 回涨 avail=${avail}`)
      assert.ok(layout.gap <= prev.gap + EPS, `gap 回涨 avail=${avail}`)
      assert.ok(layout.side <= prev.side + EPS, `side 回涨 avail=${avail}`)
      assert.ok(layout.scale <= prev.scale + EPS, `scale 回涨 avail=${avail}`)
      // 有解域（avail ≥ 最小占地）内不得溢出
      const minFootprint =
        count * (BORDER + 2 * PAD_MIN) + squares * ICON_SIDE_MIN + ngaps * GAP_MIN
      if (avail >= minFootprint - EPS) {
        assert.ok(
          fit(layout, count, textSum, squares, ngaps) <= avail + 1e-6,
          `溢出 avail=${avail}`,
        )
      }
      prev = layout
    }
  }

  // 纯方钮组同性质
  {
    const squares = 3
    const ngaps = 2
    let prev = computeGroupLayout({ avail: 300, count: 0, textSum: 0, squares, ngaps })
    for (let avail = 299.5; avail >= 0; avail -= 0.5) {
      const layout = computeGroupLayout({ avail, count: 0, textSum: 0, squares, ngaps })
      assert.ok(layout.gap <= prev.gap + EPS, `纯方钮 gap 回涨 avail=${avail}`)
      assert.ok(layout.side <= prev.side + EPS, `纯方钮 side 回涨 avail=${avail}`)
      prev = layout
    }
  }
}
