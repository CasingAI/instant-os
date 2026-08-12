/**
 * 分轨可视化绘制辅助：颜色混合、onset 脉冲、节拍冲击曲线。
 */

import { STEM_COLORS, STEM_IDS } from '../stems/stems-types.ts'
import type { StemId } from '../stems/stems-types.ts'
import { hexToRgb, withAlpha } from './music-visualizer-math.ts'
import type { StemVizSample } from './music-stems-features.ts'

export { withAlpha }

/** 节拍冲击：相位接近 0 时返回 0..1 短脉冲。 */
export function beatPulse(beatPhase: number, width = 0.12): number {
  const d = Math.min(beatPhase, 1 - beatPhase)
  if (d >= width) return 0
  return 1 - d / width
}

/** onset 脉冲整形：阈值以下为 0，以上映射到 0..1。 */
export function onsetPulse(onset: number, threshold = 0.18): number {
  if (onset <= threshold) return 0
  return Math.min(1, (onset - threshold) / (1 - threshold))
}

/** 多轨能量加权混合为 RGB。 */
export function mixStemColors(
  sample: StemVizSample,
  stemIds: readonly StemId[] = STEM_IDS,
): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  let w = 0
  for (const id of stemIds) {
    const e = sample.byStem[id]?.energy ?? 0
    if (e <= 0.001) continue
    const rgb = hexToRgb(STEM_COLORS[id])
    if (!rgb) continue
    r += rgb[0] * e
    g += rgb[1] * e
    b += rgb[2] * e
    w += e
  }
  if (w < 1e-6) return [80, 80, 90]
  return [Math.round(r / w), Math.round(g / w), Math.round(b / w)]
}

export function rgbCss(rgb: [number, number, number], alpha = 1): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}

export function stemColor(id: StemId, alpha = 1): string {
  return withAlpha(STEM_COLORS[id], alpha)
}

/** 全轨能量均值。 */
export function meanEnergy(sample: StemVizSample): number {
  let sum = 0
  for (const id of STEM_IDS) {
    sum += sample.byStem[id]?.energy ?? 0
  }
  return sum / STEM_IDS.length
}

/** 钳制。 */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export { STEM_COLORS, STEM_IDS }
