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

function clipHalfPlane(poly: Pt[], dist: (p: Pt) => number): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const da = dist(a)
    const db = dist(b)
    const aIn = da >= 0
    const bIn = db >= 0
    const cut = () => {
      const t = da / (da - db)
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    if (bIn) {
      if (!aIn) {
        out.push(cut())
      }
      out.push(b)
    } else if (aIn) {
      out.push(cut())
    }
  }
  return out
}

function toPolygonStyle(pts: Pt[]): string | null {
  // 去掉折线恰好扫过矩形角点时产生的重复顶点，退化成 <3 点即视为空区域
  const deduped = pts.filter(
    (p, i) =>
      i === 0 ||
      Math.abs(p.x - pts[i - 1].x) > 0.01 ||
      Math.abs(p.y - pts[i - 1].y) > 0.01,
  )
  if (deduped.length < 3) {
    return null
  }
  return `polygon(${deduped.map((p) => `${p.x.toFixed(2)}px ${p.y.toFixed(2)}px`).join(', ')})`
}

// 纸角绕过半圈后折回指尖：2t = L + πR。
const CORNER_RADIUS_MAX_RATIO = 0.24
const CORNER_RADIUS_TRACK_SCALE = 0.085

export type Crease = {
  /** 铰点（折痕上一点）：C − t·n */
  kx: number
  ky: number
  /** 单位法向（F → C 方向）；折痕垂直于它，d = dot(P−K, n) > 0 的一侧卷起 */
  nx: number
  ny: number
  /** 卷筒半径 */
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
    len * CORNER_RADIUS_TRACK_SCALE,
    ((w + h) / Math.SQRT2) * CORNER_RADIUS_MAX_RATIO,
  )
  const t = (len + radius * Math.PI) / 2
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
    flatClip: toPolygonStyle(clipHalfPlane(rect, (p) => s - (p.x + p.y))),
    flapClip: toPolygonStyle(clipHalfPlane(rect, (p) => p.x + p.y - s)),
  }
}
