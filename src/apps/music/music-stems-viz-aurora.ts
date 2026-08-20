/**
 * 分轨可视化 · 极光
 */
import { STEM_IDS } from '../stems/stems-types.ts'
import type { StemVizSample } from './music-stems-features.ts'
import { beatPulse, decay, meanEnergy, onsetPulse, rgbArr, stemColor, MUSIC_ACCENT } from './music-stems-viz-math.ts'

type AuroraBand = { stemIdx: number; yBase: number; phase: number; width: number }
const BANDS: AuroraBand[] = [
  { stemIdx: 6, yBase: 0.18, phase: 0, width: 0.14 }, { stemIdx: 4, yBase: 0.28, phase: 1.2, width: 0.11 },
  { stemIdx: 5, yBase: 0.37, phase: 2.5, width: 0.1 }, { stemIdx: 0, yBase: 0.48, phase: 0.8, width: 0.17 },
  { stemIdx: 3, yBase: 0.58, phase: 3.1, width: 0.08 }, { stemIdx: 2, yBase: 0.67, phase: 1.9, width: 0.09 },
  { stemIdx: 1, yBase: 0.78, phase: 0.3, width: 0.13 },
]
export type AuroraDrawState = { kickLevel: number; time: number; burst: number }
export function createAuroraDrawState(): AuroraDrawState { return { kickLevel: 0, time: 0, burst: 0 } }

export function drawStemAurora(ctx: CanvasRenderingContext2D, w: number, h: number, sample: StemVizSample, dt: number, st: AuroraDrawState): void {
  st.time += dt
  const mean = meanEnergy(sample), pulse = beatPulse(sample.beatPhase, 0.08, 2.2)
  const kick = onsetPulse(sample.drumsOnset, 0.08)
  const vocal = sample.byStem.vocals?.energy ?? 0
  st.kickLevel = decay(st.kickLevel, kick, dt, 6)
  st.burst += (0 - st.burst) * Math.min(1, dt * 3)
  if (kick > 0.35) st.burst = kick * 1.5
  ctx.fillStyle = '#040310'; ctx.fillRect(0, 0, w, h)
  // stars
  for (let i = 0; i < 60; i++) {
    const hash = (42 * (i + 1) * 1307) % 10007
    const sx = hash % w, sy = (hash * 31) % (h * 0.6)
    const sa = 0.15 + Math.sin(st.time * 2 + i) * 0.1
    ctx.beginPath(); ctx.fillStyle = `rgba(255,255,255,${sa})`; ctx.arc(sx, sy, 0.5 + (hash % 30) / 30, 0, Math.PI * 2); ctx.fill()
  }
  const t = st.time
  for (const band of BANDS) {
    const id = STEM_IDS[band.stemIdx]!, e = sample.byStem[id]?.energy ?? 0
    const low = sample.byStem[id]?.bands.low ?? 0, high = sample.byStem[id]?.bands.high ?? 0
    const onset = sample.byStem[id]?.onset ?? 0
    const baseY = h * band.yBase, bandH = h * band.width * (0.8 + e * 0.8 + st.burst * 0.3)
    const alpha = (0.15 + e * 0.55 + pulse * 0.15 + st.burst * 0.2) * (0.4 + high * 0.6)
    for (let layer = 0; layer < 3; layer++) {
      const layerAlpha = alpha * (0.5 - layer * 0.15), layerH = bandH * (1 - layer * 0.2), offset = layer * 8
      ctx.beginPath(); ctx.moveTo(-20, h + 10)
      for (let si = 0; si <= 48; si++) {
        const sx = (si / 48) * (w + 40) - 20, nx = si / 48
        const wave1 = Math.sin(nx * 9.42 + t * (0.6 + e * 0.8) + band.phase) * layerH * 0.3
        const wave2 = Math.sin(nx * 17.3 + t * 1.1 + band.phase * 2) * layerH * 0.15 * (1 + low)
        const wave3 = Math.sin(nx * 25.1 + t * 1.8) * layerH * 0.08 * high
        const burstWave = Math.sin(nx * 6.28 + t * 3) * st.burst * layerH * 0.25
        ctx.lineTo(sx, baseY + wave1 + wave2 + wave3 + burstWave + offset)
      }
      ctx.lineTo(w + 20, h + 10); ctx.closePath()
      const grad = ctx.createLinearGradient(0, baseY - layerH, 0, baseY + layerH)
      grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.3, stemColor(id, layerAlpha * 0.7))
      grad.addColorStop(0.5, stemColor(id, layerAlpha)); grad.addColorStop(0.7, stemColor(id, layerAlpha * 0.7))
      grad.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = grad; ctx.fill()
    }
    if (e > 0.1) {
      ctx.beginPath()
      for (let si = 0; si <= 48; si++) {
        const sx = (si / 48) * (w + 40) - 20, nx = si / 48
        const wave1 = Math.sin(nx * 9.42 + t * (0.6 + e * 0.8) + band.phase) * bandH * 0.3
        const wave2 = Math.sin(nx * 17.3 + t * 1.1 + band.phase * 2) * bandH * 0.15 * (1 + low)
        const burstWave = Math.sin(nx * 6.28 + t * 3) * st.burst * bandH * 0.25
        const y = baseY + wave1 + wave2 + burstWave
        si === 0 ? ctx.moveTo(sx, y) : ctx.lineTo(sx, y)
      }
      ctx.strokeStyle = stemColor(id, 0.2 + e * 0.4 + pulse * 0.15); ctx.lineWidth = 1.5 + e * 2.5 + st.burst * 2; ctx.stroke()
    }
    if (onset > 0.2) {
      const ox = w * (0.15 + band.stemIdx * 0.1), colH = h * onset * 0.4
      const g = ctx.createLinearGradient(ox, baseY - colH, ox, baseY + colH)
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, stemColor(id, onset * 0.5)); g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g; ctx.fillRect(ox - 20, baseY - colH, 40, colH * 2)
    }
  }
  const horizG = ctx.createLinearGradient(0, h * 0.85, 0, h)
  horizG.addColorStop(0, 'rgba(0,0,0,0)'); horizG.addColorStop(1, `rgba(30,15,40,${0.3 + mean * 0.15})`)
  ctx.fillStyle = horizG; ctx.fillRect(0, h * 0.85, w, h * 0.15)
  if (st.kickLevel > 0.1) { ctx.fillStyle = `rgba(200,230,255,${st.kickLevel * 0.15})`; ctx.fillRect(0, 0, w, h) }
  if (vocal > 0.06) {
    const gR = Math.min(w, h) * 0.4, g = ctx.createRadialGradient(w * 0.5, h * 0.15, 0, w * 0.5, h * 0.15, gR)
    g.addColorStop(0, rgbArr(MUSIC_ACCENT, 0.08 + vocal * 0.2)); g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h * 0.5)
  }
}
