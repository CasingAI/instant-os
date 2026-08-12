/**
 * 分轨可视化 · 伪3D Plasma
 * 经典 Winamp plasma：低分辨率像素渲染拉满全屏。
 */
import type { StemId } from '../stems/stems-types.ts'
import { STEM_IDS } from '../stems/stems-types.ts'
import type { StemVizSample } from './music-stems-features.ts'
import { beatPulse, clamp, decay, hslToRgb, meanEnergy, onsetPulse, MUSIC_ACCENT } from './music-stems-viz-math.ts'

export type PlasmaDrawState = {
  kickLevel: number; time: number; hueShift: number; smoothE: Record<StemId, number>
}
export function createPlasmaDrawState(): PlasmaDrawState {
  const se = {} as Record<StemId, number>; for (const id of STEM_IDS) se[id] = 0
  return { kickLevel: 0, time: 0, hueShift: 0, smoothE: se }
}

export function drawStemPlasma(ctx: CanvasRenderingContext2D, w: number, h: number, sample: StemVizSample, dt: number, st: PlasmaDrawState): void {
  st.time += dt
  const mean = meanEnergy(sample), pulse = beatPulse(sample.beatPhase, 0.08, 2.2)
  const kick = onsetPulse(sample.drumsOnset, 0.08)
  const bass = sample.byStem.bass?.energy ?? 0, drums = sample.byStem.drums?.energy ?? 0
  st.kickLevel = decay(st.kickLevel, kick, dt, 7)
  st.hueShift += dt * (15 + drums * 60 + st.kickLevel * 40)
  for (const id of STEM_IDS) { const e = sample.byStem[id]?.energy ?? 0; const prev = st.smoothE[id] ?? 0; st.smoothE[id] = prev + (e - prev) * Math.min(1, dt * 8) }
  const se = st.smoothE, pw = 128, ph = 80
  const t = st.time, f1 = 1.2 + bass * 1.8 + pulse * 0.5
  const f2 = 0.9 + (se.guitar ?? 0) * 1.5 + (se.piano ?? 0) * 1.2, f3 = 1.5 + (se.vocals ?? 0) * 2
  const p1 = t * 0.7 + se.bass * 3, p2 = t * 0.5 + se.drums * 4, p3 = t * 0.9 + st.kickLevel * 5
  const imgData = ctx.createImageData(pw, ph), data = imgData.data
  const sat = clamp(0.65 + mean * 0.35, 0.5, 1)
  for (let py = 0; py < ph; py++) {
    const ny = py / ph
    for (let px = 0; px < pw; px++) {
      const nx = px / pw
      const v1 = Math.sin(nx * f1 * 6.283 + p1) + Math.sin(ny * f1 * 6.283 - p1 * 0.7)
      const v2 = Math.sin((nx + ny) * f2 * 6.283 + p2) + Math.sin(Math.sqrt(nx * nx + ny * ny) * f3 * 6.283 - p3)
      const v3 = Math.sin(nx * 3 + ny * 4 + t * 1.3) * se.other * 0.3
      const v4 = Math.sin(Math.sqrt((nx - 0.5) * (nx - 0.5) + (ny - 0.5) * (ny - 0.5)) * 6 + t * 0.8) * st.kickLevel * 0.5
      const val = (v1 + v2 + v3 + v4 + 4) / 8
      const hue = (val * 360 + st.hueShift + (se.vocals ?? 0) * 40) % 360
      const lit = clamp(0.12 + val * 0.45 + pulse * 0.08 + st.kickLevel * 0.12, 0.05, 0.7)
      const [r, g, b] = hslToRgb(hue, sat, lit)
      const idx = (py * pw + px) * 4
      data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255
    }
  }
  // use an offscreen canvas to draw the low-res pixels
  const offscreen = new OffscreenCanvas(pw, ph)
  const offCtx = offscreen.getContext('2d')!
  offCtx.putImageData(imgData, 0, 0)
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'medium'
  ctx.drawImage(offscreen, 0, 0, pw, ph, 0, 0, w, h)
  if (st.kickLevel > 0.1) { ctx.fillStyle = `rgba(255,240,245,${st.kickLevel * 0.25})`; ctx.fillRect(0, 0, w, h) }
  const cx = w / 2, cy = h / 2
  const vig = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, Math.max(w, h) * 0.7)
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, `rgba(0,0,0,${0.35 - st.kickLevel * 0.08})`)
  ctx.fillStyle = vig; ctx.fillRect(0, 0, w, h)
}
