// 卷页折线几何：折线恒为对角方向的直线 x + y = s（右手系 y 向下，s 从 W+H 的
// 右下角一路推进到 0 的左上角），翻起区域 = { x + y > s }，留平区域 = { x + y <= s }。
// 裁剪多边形用 Sutherland–Hodgman 对半平面裁矩形，任意 s（含折线只切到边框一角时）
// 都得到正确的顶点序列，避免手写分情况的多边形顶点表。

type Pt = { x: number; y: number }

type FoldSplit = {
  /** 留平部分（仍在平面上的页面剩余区域）的 clip-path polygon；空区域返回 null */
  flatClip: string | null
  /** 翻起部分（折线外侧、将被卷起的区域）的 clip-path polygon；空区域返回 null */
  flapClip: string | null
}

function clipHalfPlane(poly: Pt[], keep: (p: Pt) => boolean, s: number): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const aIn = keep(a)
    const bIn = keep(b)
    if (bIn) {
      if (!aIn) {
        const t = (s - (a.x + a.y)) / ((b.x + b.y) - (a.x + a.y))
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      }
      out.push(b)
    } else if (aIn) {
      const t = (s - (a.x + a.y)) / ((b.x + b.y) - (a.x + a.y))
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
  }
  return out
}

function toPolygonStyle(pts: Pt[]): string | null {
  // 去掉折线恰好扫过矩形角点时产生的重复顶点，退化成 <3 点即视为空区域
  const deduped = pts.filter(
    (p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) > 0.01 || Math.abs(p.y - pts[i - 1].y) > 0.01,
  )
  if (deduped.length < 3) {
    return null
  }
  return `polygon(${deduped.map((p) => `${p.x.toFixed(2)}px ${p.y.toFixed(2)}px`).join(', ')})`
}

// ── 「纸角钉在指尖」的折痕反解（WebGL 方案三专用）──
//
// 手指捏住纸角：折痕垂直于「纸角原位 C ↔ 手指 F」连线。纸角 C 到铰线的弧长 t
// 分两段消耗——绕柱面 πR（落点从铰线鼓到 R 再折回柱顶正上方）+ 沿切线反向平铺
// (t−πR)；要求纸角恰好落在 F（铰线另一侧、距铰线 L−t），即 t − πR = L − t：
//
//     t = (L + πR) / 2，且需 t ≥ πR ⇔ R ≤ L/π
//
// 卷径取 R = min(R_max, κL)、κ = 1/(2π)：κL ≤ L/2π 恒有解；距离近时卷径随距离
// 收紧（捏角起步是锐折），距离远时封顶在旧版的 0.24·uMax（拖远是大半径缓卷）。

/** 圆柱半径上限（对角总长的占比，与旧版 axisFromProgress 一致） */
const CORNER_RADIUS_MAX_RATIO = 0.24
/** 卷径随「角↔手指」距离伸缩的系数；1/(2π) 时翻扣纸背长度恰为距离的 1/4 */
const CORNER_RADIUS_TRACK = 1 / (2 * Math.PI)

export type Crease = {
  /** 铰点（折痕上一点）：C − t·n */
  kx: number
  ky: number
  /** 单位法向（F → C 方向）；折痕垂直于它，d = dot(P−K, n) > 0 的一侧卷起 */
  nx: number
  ny: number
  /** 卷径 */
  radius: number
}

/** 由手指位置反解折痕。F = C（合上）时 n 退化 为零向量，着色器里 d 恒为 0、整页原位。 */
export function creaseFromFinger(finger: { x: number; y: number }, w: number, h: number): Crease {
  const dx = w - finger.x
  const dy = h - finger.y
  const len = Math.max(Math.hypot(dx, dy), 1)
  const nx = dx / len
  const ny = dy / len
  const radius = Math.min(
    ((w + h) / Math.SQRT2) * CORNER_RADIUS_MAX_RATIO,
    CORNER_RADIUS_TRACK * len,
  )
  const t = (len + Math.PI * radius) / 2
  return { kx: w - nx * t, ky: h - ny * t, nx, ny, radius }
}

/** 给定折线位置 s 与舞台尺寸，算出留平/翻起两块各自的 clip-path。 */
export function foldSplit(s: number, w: number, h: number): FoldSplit {
  const rect: Pt[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
  return {
    flatClip: toPolygonStyle(clipHalfPlane(rect, (p) => p.x + p.y <= s, s)),
    flapClip: toPolygonStyle(clipHalfPlane(rect, (p) => p.x + p.y >= s, s)),
  }
}
