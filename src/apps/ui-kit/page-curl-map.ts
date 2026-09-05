import { useLayoutEffect } from 'preact/hooks'

// 仿 iOS 6 地图配色：奶油底 + 灰蓝水域 + 白路网 + 草绿公园
const WATER = '#a5c8e2'
const WATER_LABEL = '#5e88b5'
const LAND = '#f8f4e8'
const LAND_EDGE = '#d8ceB4'
const PARK = '#cbe3ae'
const ROAD_EDGE = '#d9d3c3'
const ROAD = '#ffffff'
const ROAD_MAJOR = '#fde79b'
const ROAD_MAJOR_EDGE = '#e3c469'
const LABEL = '#6f6b60'
const LABEL_HALO = 'rgba(255, 255, 255, 0.9)'

/** 确定性伪随机——每次重绘出同一张地图，拖动中重绘不闪变 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawRoad(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  edge: string,
  fill: string,
): void {
  ctx.lineCap = 'butt'
  ctx.strokeStyle = edge
  ctx.lineWidth = width + 2
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  ctx.strokeStyle = fill
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

function roadLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  angle: number,
  size: number,
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.font = `${size}px "Helvetica Neue", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.strokeStyle = LABEL_HALO
  ctx.lineWidth = 3
  ctx.strokeText(text, 0, 0)
  ctx.fillStyle = LABEL
  ctx.fillText(text, 0, 0)
  ctx.restore()
}

/** 画一张仿 iOS 6 风格的假地图：水域 + 海岸线 + 路网 + 公园 + 标注 + 定位点。
 *  纯装饰，无交互；三个卷页方案共用（CSS 方案画进 canvas 元素，WebGL 方案整体当纹理上传）。 */
export function drawFakeMap(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const rng = mulberry32(20120611)
  const rand = (a: number, b: number) => a + rng() * (b - a)

  // 水域打底
  ctx.fillStyle = WATER
  ctx.fillRect(0, 0, w, h)

  // 陆地：右侧大块，左侧留出海湾，海岸线用带抖动的折线
  ctx.fillStyle = LAND
  ctx.strokeStyle = LAND_EDGE
  ctx.lineWidth = 1.5
  ctx.beginPath()
  const coastX = w * 0.16
  ctx.moveTo(coastX + rand(-14, 14), -8)
  let px = coastX
  let py = -8
  while (py < h + 8) {
    py += h / 7
    px = coastX + rand(-h * 0.075, h * 0.075) + (py / h) * w * 0.05
    ctx.lineTo(px, py)
  }
  ctx.lineTo(w + 8, h + 8)
  ctx.lineTo(w + 8, -8)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // 公园绿地
  ctx.fillStyle = PARK
  const parkCount = 5
  for (let i = 0; i < parkCount; i++) {
    const pw = rand(w * 0.08, w * 0.16)
    const ph = rand(h * 0.07, h * 0.14)
    roundRect(ctx, rand(w * 0.3, w * 0.86) - pw / 2, rand(h * 0.08, h * 0.9) - ph / 2, pw, ph, 6)
    ctx.fill()
  }

  // 路网：横向 + 纵向白路，间隔带抖动
  const gapY = h / 6
  const gapX = w / 7
  for (let y = gapY * 0.7; y < h; y += gapY) {
    drawRoad(ctx, w * 0.2, y + rand(-5, 5), w + 8, y + rand(-5, 5), 4.5, ROAD_EDGE, ROAD)
  }
  for (let x = w * 0.3; x < w; x += gapX) {
    drawRoad(ctx, x + rand(-5, 5), -8, x + rand(-5, 5), h + 8, 4.5, ROAD_EDGE, ROAD)
  }

  // 主干道：一条黄色大道 + 一条斜向高速
  drawRoad(ctx, w * 0.18, h * 0.42, w + 8, h * 0.42 + h * 0.05, 7, ROAD_MAJOR_EDGE, ROAD_MAJOR)
  drawRoad(ctx, w * 0.36, h + 8, w * 0.78, -8, 6.5, ROAD_MAJOR_EDGE, ROAD_MAJOR)

  // 街道名（沿路旋转）
  roadLabel(ctx, 'De Anza Blvd', w * 0.62, h * 0.24, -Math.PI / 2, 10)
  roadLabel(ctx, 'Stevens Creek Blvd', w * 0.6, h * 0.63, -0.06, 10)
  roadLabel(ctx, 'Interstate 280', w * 0.56, h * 0.82, -1.05, 10)
  roadLabel(ctx, 'N Tantau Ave', w * 0.82, h * 0.42, -Math.PI / 2, 9)
  roadLabel(ctx, 'Maria Ln', w * 0.47, h * 0.15, 0.02, 9)

  // 城市标注
  ctx.font = '600 15px "Helvetica Neue", sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.strokeStyle = LABEL_HALO
  ctx.lineWidth = 4
  ctx.strokeText('Cupertino', w * 0.52, h * 0.34)
  ctx.fillStyle = '#55524a'
  ctx.fillText('Cupertino', w * 0.52, h * 0.34)
  ctx.font = '400 11px "Helvetica Neue", sans-serif'
  ctx.strokeStyle = LABEL_HALO
  ctx.lineWidth = 3
  ctx.strokeText('Sunnyvale', w * 0.74, h * 0.86)
  ctx.fillStyle = LABEL
  ctx.fillText('Sunnyvale', w * 0.74, h * 0.86)

  // 水域名
  ctx.save()
  ctx.translate(w * 0.075, h * 0.62)
  ctx.rotate(-Math.PI / 2)
  ctx.font = 'italic 12px "Georgia", serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = WATER_LABEL
  ctx.fillText('San Francisco Bay', 0, 0)
  ctx.restore()

  // 蓝色定位点：白圈 + 光晕
  const dotX = w * 0.66
  const dotY = h * 0.47
  const halo = ctx.createRadialGradient(dotX, dotY, 2, dotX, dotY, 22)
  halo.addColorStop(0, 'rgba(58, 128, 220, 0.45)')
  halo.addColorStop(1, 'rgba(58, 128, 220, 0)')
  ctx.fillStyle = halo
  ctx.fillRect(dotX - 22, dotY - 22, 44, 44)
  ctx.beginPath()
  ctx.arc(dotX, dotY, 7.5, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(dotX, dotY, 5.5, 0, Math.PI * 2)
  ctx.fillStyle = '#2f7bd9'
  ctx.fill()
}

/** 把假地图画到指定 canvas（按 dpr 放大保证清晰）；尺寸变化时重绘。
 *  enabled 翻 false→true 时（如翻起面被条件渲染卸下再挂回）必须重跑一次，
 *  否则新 canvas 元素拿不到内容。CSS 两方案的平面页与翻起面各自挂一个 canvas，都走这里。 */
export function useMapCanvas(
  canvasRef: { current: HTMLCanvasElement | null },
  w: number,
  h: number,
  enabled = true,
): void {
  useLayoutEffect(() => {
    if (!enabled) {
      return
    }
    const canvas = canvasRef.current
    if (!canvas || w <= 0 || h <= 0) {
      return
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.max(1, Math.round(w * dpr))
    canvas.height = Math.max(1, Math.round(h * dpr))
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawFakeMap(ctx, w, h)
  }, [canvasRef, w, h, enabled])
}

/** 离屏画一张地图 canvas，供 WebGL texImage2D 一次性上传。 */
export function renderMapCanvas(w: number, h: number, dpr: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * dpr))
  canvas.height = Math.max(1, Math.round(h * dpr))
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawFakeMap(ctx, w, h)
  }
  return canvas
}
