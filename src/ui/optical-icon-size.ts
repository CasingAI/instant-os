import type { IconFamily } from './icon.tsx'

/*
 * 按钮内图标的光学字号：借鉴苹果「高斯模糊提取字形轮廓、按轮廓定大小」的思路。
 * Material Symbols 各字形在同样 font-size 下视觉大小不同——light_mode（太阳）墨迹占满
 * 字面框显得大，arrow_back/arrow_forward（箭头）细长显小，单一字号无法兼顾。
 *
 * 做法：把图标名当文字画到离屏 canvas 上 → ctx.filter='blur()' 原生高斯模糊（GPU 加速）
 * → 读 alpha 通道按相对阈值取「视觉轮廓」→ 用轮廓外接框的几何均值 √(宽×高) 当视觉直径。
 * 模糊+阈值让靠边的小点、细碎笔画（对视觉重量贡献小）自动落到阈值以下被排除，
 * 只剩成块的形体参与测量——这正是外接框方案做不到的。
 * 每个图标只量一次、结果缓存，稳态零开销；测量失败一律回退 button.css 缺省的 20px。
 */

const FAMILY_FONT: Record<IconFamily, string> = {
  outlined: '"Material Symbols Outlined"',
  rounded: '"Material Symbols Rounded"',
  sharp: '"Material Symbols Sharp"',
}

/** 测量用的参考字号：越大采样越细，画布开销仍在毫秒级 */
const REFERENCE_SIZE = 96
/** 画布边长：参考字号的 1.7 倍，装得下满幅字形加模糊外扩 */
const CANVAS_SIZE = Math.round(REFERENCE_SIZE * 1.7)
/** 模糊半径（相对参考字号）：大到能摊薄细碎笔画与噪点，小到不糊掉主体轮廓 */
const BLUR_RADIUS = REFERENCE_SIZE / 16
/** 阈值取「最大 alpha 的比例」而非绝对值：细笔画模糊后整体变淡，相对阈值保证成块形体按同一标准存活 */
const ALPHA_THRESHOLD_RATIO = 0.3

/**
 * 期望的视觉直径（渲染后像素）：字号 = TARGET × 参考字号 / 测得的视觉直径。
 * 按三个锚点校准——太阳（light_mode，轮廓占满字面框）→ MIN 20px，
 * 常规图标（轮廓约 3/4 字面框）→ 20px 附近，箭头（细长）→ 打满 MAX 24px。
 * 目测不合适时调这里和 MIN/MAX，不用动测量逻辑。
 */
const TARGET_DIAMETER = 15
const MIN_FONT_SIZE = 20
const MAX_FONT_SIZE = 24

/** 缓存按 family|字重|图标名 分键；FILL/GRAD 轴 canvas 画不进去，忽略（对轮廓影响小） */
type CacheKey = `${IconFamily}|${number}|${string}`
const cache = new Map<CacheKey, Promise<number | null>>()
/** 已出结果的光学字号，供渲染时同步取用（首次渲染前 promise 未决则拿不到，走 20px 兜底） */
const resolved = new Map<CacheKey, number>()

function measure(key: CacheKey, name: string): Promise<number | null> {
  const [family, weight] = key.split('|') as [IconFamily, string]
  const fontSpec = `${weight} ${REFERENCE_SIZE}px ${FAMILY_FONT[family]}`
  return (async () => {
    if (typeof document === 'undefined') return null
    // 先确保该字形的连字可用（字体文件就绪），否则 canvas 会量到「名字文本」而不是图标
    try {
      await document.fonts.load(fontSpec, name)
    } catch {
      return null
    }
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_SIZE
    canvas.height = CANVAS_SIZE
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.filter = `blur(${BLUR_RADIUS}px)`
    ctx.font = fontSpec
    ctx.fillStyle = '#000'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(name, CANVAS_SIZE / 2, CANVAS_SIZE / 2)
    // 只看 alpha：字形画成黑色不透明，模糊后 alpha 即墨量分布
    const { data } = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    let maxAlpha = 0
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > maxAlpha) maxAlpha = data[i]
    }
    // 峰值近乎为零说明量到的不是字形（字体没加载成），放弃
    if (maxAlpha < 16) return null
    const threshold = maxAlpha * ALPHA_THRESHOLD_RATIO
    let minX = CANVAS_SIZE
    let minY = CANVAS_SIZE
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < CANVAS_SIZE; y++) {
      for (let x = 0; x < CANVAS_SIZE; x++) {
        if (data[(y * CANVAS_SIZE + x) * 4 + 3] >= threshold) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) return null
    const diameter = Math.sqrt((maxX - minX + 1) * (maxY - minY + 1))
    const clamped = Math.min(
      MAX_FONT_SIZE,
      Math.max(MIN_FONT_SIZE, (TARGET_DIAMETER * REFERENCE_SIZE) / diameter),
    )
    return Math.round(clamped)
  })()
}

/** 取按钮内某图标的光学字号：已量过同步返回缓存值；没量过返回 null（调用方先用 20px 兜底渲染） */
export function getCachedOpticalFontSize(
  name: string,
  family: IconFamily,
  weight: number,
): number | null {
  const key: CacheKey = `${family}|${weight}|${name}`
  return resolved.get(key) ?? null
}

/** 发起测量并缓存结果（同键不重复量）；返回最终字号，null 表示量不出来、用兜底值 */
export function measureOpticalFontSize(
  name: string,
  family: IconFamily,
  weight: number,
): Promise<number | null> {
  const key: CacheKey = `${family}|${weight}|${name}`
  let cached = cache.get(key)
  if (!cached) {
    cached = measure(key, name)
    cached.then((size) => {
      if (size != null) resolved.set(key, size)
    })
    cache.set(key, cached)
  }
  return cached
}
