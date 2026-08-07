/**
 * 可视化纯函数（可单测）：频谱/波形数据到坐标的映射、跨帧平滑、
 * 频段能量、逐字高亮进度与可视化配色。
 */

/**
 * 频域数据（0-255）→ barCount 个柱高（0-1）。
 * 对数分桶：低频桶窄、高频桶宽，避免能量集中在低频几个桶；
 * 再做 0.8 次幂提升，让中低能量也有可见高度。
 */
export function computeBarHeights(freqData: Uint8Array, barCount: number): number[] {
  const heights: number[] = []
  const n = freqData.length
  if (n === 0 || barCount <= 0) {
    return heights
  }
  for (let i = 0; i < barCount; i += 1) {
    const lo = Math.floor((i / barCount) ** 2 * n)
    let hi = Math.min(n, Math.floor(((i + 1) / barCount) ** 2 * n))
    // 保证桶区间非空（首桶/浮点下溢时）
    if (hi <= lo) {
      hi = Math.min(n, lo + 1)
    }
    const count = hi - lo
    let sum = 0
    for (let j = lo; j < hi; j += 1) {
      sum += freqData[j]
    }
    heights.push(Math.min(1, Math.pow(sum / count / 255, 0.8)))
  }
  return heights
}

/**
 * 时域数据（0-255，中心 128）→ pointCount 个采样点（-1..1，0 为中心）。
 * 按均匀间隔采样，UI 据此画波形线条。
 */
export function computeWavePoints(timeData: Uint8Array, pointCount: number): number[] {
  const points: number[] = []
  const n = timeData.length
  if (n === 0 || pointCount <= 0) {
    return points
  }
  for (let i = 0; i < pointCount; i += 1) {
    const idx = Math.min(n - 1, Math.floor((i / pointCount) * n))
    points.push((timeData[idx] - 128) / 128)
  }
  return points
}

/**
 * 跨帧平滑：上升快（attack 越大越跟手）、回落慢（decay 越大落越慢）。
 * 返回与 next 等长的新数组；prev 长度不足时按 0 起步。
 */
export function smoothLevels(
  prev: readonly number[],
  next: readonly number[],
  attack = 0.6,
  decay = 0.86,
): number[] {
  const out = new Array<number>(next.length)
  for (let i = 0; i < next.length; i += 1) {
    const p = i < prev.length ? prev[i] : 0
    const t = next[i]
    out[i] = t > p ? p + (t - p) * attack : p * decay + t * (1 - decay)
  }
  return out
}

/** 峰值帽：不低于当前柱高，每帧按 fallPerFrame 缓慢下落。 */
export function computePeaks(
  prev: readonly number[],
  levels: readonly number[],
  fallPerFrame = 0.007,
): number[] {
  const out = new Array<number>(levels.length)
  for (let i = 0; i < levels.length; i += 1) {
    const p = i < prev.length ? prev[i] : 0
    out[i] = Math.max(levels[i], p - fallPerFrame)
  }
  return out
}

/** 频域区间能量（bin 下标按比例取平均，0..1）：如 bass ≈ [0.01, 0.1]。 */
export function bandEnergy(freqData: Uint8Array, fromRatio: number, toRatio: number): number {
  const n = freqData.length
  if (n === 0) {
    return 0
  }
  const lo = Math.max(0, Math.min(n - 1, Math.floor(fromRatio * n)))
  let hi = Math.min(n, Math.ceil(toRatio * n))
  if (hi <= lo) {
    hi = Math.min(n, lo + 1)
  }
  let sum = 0
  for (let i = lo; i < hi; i += 1) {
    sum += freqData[i]
  }
  return Math.min(1, sum / (hi - lo) / 255)
}

/** 无音频输入时的待机柱高（0..1）：两组正弦叠加的缓慢呼吸。 */
export function computeIdleLevels(count: number, timeSec: number): number[] {
  const out = new Array<number>(count)
  for (let i = 0; i < count; i += 1) {
    const a = 0.5 + 0.5 * Math.sin(timeSec * 1.3 + i * 0.42)
    const b = 0.5 + 0.5 * Math.sin(timeSec * 0.7 + i * 0.13)
    out[i] = 0.05 + 0.05 * a * b
  }
  return out
}

/** 无音频输入时的待机波形（-1..1）：缓慢行进的低幅正弦。 */
export function computeIdleWave(count: number, timeSec: number): number[] {
  const out = new Array<number>(count)
  for (let i = 0; i < count; i += 1) {
    const x = count > 1 ? i / (count - 1) : 0
    out[i] = 0.12 * Math.sin(x * 6 + timeSec * 1.8) * Math.sin(x * 2.2 - timeSec * 0.9)
  }
  return out
}

/**
 * 返回 timeMs 前最后一个词条的索引（-1 表示还没到第一个词）。
 * words 需按 timeMs 升序。
 */
export function computeActiveWordIndex<T extends { timeMs: number }>(
  words: readonly T[],
  timeMs: number,
): number {
  let index = -1
  for (let i = 0; i < words.length; i += 1) {
    if (words[i].timeMs <= timeMs) {
      index = i
    } else {
      break
    }
  }
  return index
}

/** 当前词的填充进度（0..1）：从词时间戳到下一个词（或行尾）线性推进。 */
export function wordFill(
  words: readonly { timeMs: number }[],
  index: number,
  timeMs: number,
  lineEndMs: number,
): number {
  const word = words[index]
  if (!word) {
    return 0
  }
  const next = index + 1 < words.length ? words[index + 1].timeMs : lineEndMs
  const span = Math.max(1, next - word.timeMs)
  return Math.min(1, Math.max(0, (timeMs - word.timeMs) / span))
}

/** 无逐字时间戳的行：整行填充进度（0..1）。 */
export function lineFill(lineStartMs: number, lineEndMs: number, timeMs: number): number {
  const span = Math.max(1, lineEndMs - lineStartMs)
  return Math.min(1, Math.max(0, (timeMs - lineStartMs) / span))
}

/** #rrggbb → [r, g, b]（0-255）；非法输入返回 undefined。 */
export function hexToRgb(hex: string): [number, number, number] | undefined {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) {
    return undefined
  }
  const value = match[1]
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ]
}

/** hex 颜色加透明度 → rgba() 字符串；非法输入原样返回。 */
export function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) {
    return hex
  }
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}

/** #rrggbb → hsl 三元组（h: 0-360，s/l: 0-100，保留精度避免回转换色漂移）；非法输入返回 undefined。 */
export function hexToHsl(
  hex: string,
): { h: number; s: number; l: number } | undefined {
  const rgb = hexToRgb(hex)
  if (!rgb) {
    return undefined
  }
  const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) {
    return { h: 0, s: 0, l: l * 100 }
  }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) {
    h = (g - b) / d + (g < b ? 6 : 0)
  } else if (max === g) {
    h = (b - r) / d + 2
  } else {
    h = (r - g) / d + 4
  }
  return { h: h * 60, s: s * 100, l: l * 100 }
}

/** hsl（h: 0-360，s/l: 0-1）→ [r, g, b]（0-255） */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let rgb: [number, number, number]
  if (h < 60) {
    rgb = [c, x, 0]
  } else if (h < 120) {
    rgb = [x, c, 0]
  } else if (h < 180) {
    rgb = [0, c, x]
  } else if (h < 240) {
    rgb = [0, x, c]
  } else if (h < 300) {
    rgb = [x, 0, c]
  } else {
    rgb = [c, 0, x]
  }
  return [
    Math.round((rgb[0] + m) * 255),
    Math.round((rgb[1] + m) * 255),
    Math.round((rgb[2] + m) * 255),
  ]
}

/** 回退主题红 #fa2d55 的 HSL（模块加载时计算，输入合法必然有效） */
const FALLBACK_ACCENT_HSL = hexToHsl('#fa2d55') ?? { h: 0, s: 0, l: 50 }

/**
 * 由主题色派生可视化三色系（RGB 三元组）：[主色, 互补色, 邻近亮色]，
 * 供背景光斑等使用；输入非法时回退到默认主题红。
 */
export function accentTriadRgb(
  hex: string,
): [[number, number, number], [number, number, number], [number, number, number]] {
  const hsl = hexToHsl(hex) ?? FALLBACK_ACCENT_HSL
  const { h, s, l } = hsl
  return [
    hslToRgb(h, s / 100, l / 100),
    hslToRgb((h + 165) % 360, Math.min(100, s + 5) / 100, Math.min(70, l + 4) / 100),
    hslToRgb((h + 38) % 360, s / 100, Math.min(76, l + 14) / 100),
  ]
}
