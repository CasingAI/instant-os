/**
 * 分轨可视化绘制辅助。
 */
import { STEM_COLORS, STEM_IDS } from '../stems/stems-types.ts'
import type { StemId } from '../stems/stems-types.ts'
import { hexToRgb, withAlpha } from './music-visualizer-math.ts'
import type { StemVizSample } from './music-stems-features.ts'
export { withAlpha }
export const MUSIC_ACCENT: [number, number, number] = [250, 45, 85]
export const STEMS_VIZ_BG = '#030308'
export const BEATS_PER_BAR = 4
export function beatPulse(beatPhase: number, width = 0.09, power = 2): number {
  const d = Math.min(beatPhase, 1 - beatPhase)
  if (d >= width) return 0
  return (1 - d / width) ** power
}
export function beatWave(beatPhase: number): number {
  return 0.5 - 0.5 * Math.cos(beatPhase * Math.PI * 2)
}
export function barAccent(beatPhase: number, timeSec: number, bpm: number): number {
  const idx = Math.floor((timeSec * Math.max(1, bpm)) / 60 + beatPhase) % 4
  if (idx === 0) return 1
  if (idx === 2) return 0.55
  return 0.2
}
export function onsetPulse(onset: number, threshold = 0.12): number {
  if (onset <= threshold) return 0
  return Math.min(1, (onset - threshold) / (1 - threshold))
}
export function decay(current: number, target: number, dt: number, rate: number): number {
  if (target > current) return target
  return current * Math.exp(-dt * rate)
}
/** 指数衰减趋向目标值；超过则瞬跳。 */
export function decayToward(current: number, target: number, dt: number, rate: number): number {
  if (target >= current) return target
  return target + (current - target) * Math.exp(-dt * rate)
}
export function mixStemColors(sample: StemVizSample): [number, number, number] {
  let r = 0, g = 0, b = 0, w = 0
  for (const id of STEM_IDS) {
    const e = sample.byStem[id]?.energy ?? 0
    if (e <= 0.001) continue
    const rgb = hexToRgb(STEM_COLORS[id])
    if (!rgb) continue
    r += rgb[0] * e; g += rgb[1] * e; b += rgb[2] * e; w += e
  }
  if (w < 1e-6) return [100, 95, 110]
  return [r / w | 0, g / w | 0, b / w | 0]
}
export function rgb(r: number, g: number, b: number, a = 1): string {
  return `rgba(${r},${g},${b},${a})`
}
export function rgbArr(c: [number, number, number], a = 1): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`
}
export function rgbCss(c: [number, number, number] | undefined, alpha = 1): string {
  if (!c) return `rgba(0,0,0,${alpha})`
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`
}
export function stemColor(id: StemId, alpha = 1): string {
  return withAlpha(STEM_COLORS[id], alpha)
}
export function meanEnergy(sample: StemVizSample): number {
  let sum = 0
  for (const id of STEM_IDS) sum += sample.byStem[id]?.energy ?? 0
  return sum / STEM_IDS.length
}
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  if (h < 60) return [(c + m) * 255 | 0, (x + m) * 255 | 0, m * 255 | 0]
  if (h < 120) return [(x + m) * 255 | 0, (c + m) * 255 | 0, m * 255 | 0]
  if (h < 180) return [m * 255 | 0, (c + m) * 255 | 0, (x + m) * 255 | 0]
  if (h < 240) return [m * 255 | 0, (x + m) * 255 | 0, (c + m) * 255 | 0]
  if (h < 300) return [(x + m) * 255 | 0, m * 255 | 0, (c + m) * 255 | 0]
  return [(c + m) * 255 | 0, m * 255 | 0, (x + m) * 255 | 0]
}
export function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number, mean: number, pulse: number, kick: number): void {
  ctx.fillStyle = STEMS_VIZ_BG
  ctx.fillRect(0, 0, w, h)
  const cx = w * 0.5, cy = h * 0.5
  const r = Math.max(w, h) * 0.6
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
  g.addColorStop(0, rgb(MUSIC_ACCENT[0], MUSIC_ACCENT[1], MUSIC_ACCENT[2], 0.04 + mean * 0.1 + pulse * 0.07 + kick * 0.1))
  g.addColorStop(0.5, rgb(30, 14, 28, 0.07 + mean * 0.05))
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}
export { STEM_COLORS, STEM_IDS }
