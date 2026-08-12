/**
 * 分轨可视化 · 流体
 */
import type { StemId } from '../stems/stems-types.ts'
import { STEM_IDS } from '../stems/stems-types.ts'
import type { StemVizSample } from './music-stems-features.ts'
import { beatPulse, beatWave, decay, meanEnergy, onsetPulse, rgb, rgbArr, stemColor, MUSIC_ACCENT } from './music-stems-viz-math.ts'

export type FluidDrawState = {
  kickLevel: number; time: number
  ripples: { life: number; maxLife: number; x: number; y: number; strength: number }[]
  smoothE: Record<StemId, number>
}
export function createFluidDrawState(): FluidDrawState {
  const se = {} as Record<StemId, number>; for (const id of STEM_IDS) se[id] = 0
  return { kickLevel: 0, time: 0, ripples: [], smoothE: se }
}
const BANDS: StemId[] = ['bass', 'drums', 'other', 'other2', 'piano', 'guitar', 'vocals']

export function drawStemFluid(ctx: CanvasRenderingContext2D, w: number, h: number, sample: StemVizSample, dt: number, st: FluidDrawState): void {
  st.time += dt; const cx = w / 2, cy = h / 2
  const mean = meanEnergy(sample), pulse = beatPulse(sample.beatPhase, 0.08, 2.2)
  const kick = onsetPulse(sample.drumsOnset, 0.08)
  const bass = sample.byStem.bass?.energy ?? 0, vocal = sample.byStem.vocals?.energy ?? 0
  st.kickLevel = decay(st.kickLevel, kick, dt, 8)
  if (kick > 0.3) st.ripples.push({ life: 0, maxLife: 0.9, x: cx + (Math.random() - 0.5) * w * 0.3, y: cy + (Math.random() - 0.5) * h * 0.3, strength: 0.55 + kick * 0.6 })
  ctx.fillStyle = '#030308'; ctx.fillRect(0, 0, w, h)
  const horizon = h * 0.55, depth = h * 0.45, swell = 1 + bass * 0.18 + pulse * 0.06 + st.kickLevel * 0.1
  for (let bi = 0; bi < 7; bi++) {
    const id = BANDS[bi]!, e = sample.byStem[id]?.energy ?? 0
    const low = sample.byStem[id]?.bands.low ?? 0, mid = sample.byStem[id]?.bands.mid ?? 0, high = sample.byStem[id]?.bands.high ?? 0
    const prev = st.smoothE[id] ?? 0; st.smoothE[id] = e > prev ? e : prev + (e - prev) * Math.min(1, dt * 12)
    const sm = st.smoothE[id]!, bandY = horizon + (bi / 7) * depth - depth * 0.5
    const amp = (22 + sm * 75 + low * 35 + pulse * 18) * swell
    const freq = 1.5 + bi * 0.5 + mid * 1.3, phase = st.time * (1 + sample.bpm / 110) + bi * 0.9 + sample.beatPhase * Math.PI
    ctx.beginPath(); ctx.moveTo(-10, h + 10)
    for (let si = 0; si <= 80; si++) {
      const t = si / 80, x = t * (w + 20) - 10
      const yOff = Math.sin(t * Math.PI * freq + phase) * amp * (0.6 + sm * 0.4) + Math.sin(t * Math.PI * freq * 2.3 + phase * 1.4) * amp * high * 0.45
      ctx.lineTo(x, bandY + yOff)
    }
    ctx.lineTo(w + 10, h + 10); ctx.closePath()
    const grad = ctx.createLinearGradient(0, bandY - amp, 0, h)
    grad.addColorStop(0, stemColor(id, 0.25 + sm * 0.5 + pulse * 0.12))
    grad.addColorStop(0.5, stemColor(id, 0.1 + sm * 0.2)); grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad; ctx.fill()
    ctx.beginPath()
    for (let si = 0; si <= 80; si++) {
      const t = si / 80, x = t * (w + 20) - 10
      const yOff = Math.sin(t * Math.PI * freq + phase) * amp * (0.6 + sm * 0.4) + Math.sin(t * Math.PI * freq * 2.3 + phase * 1.4) * amp * high * 0.45
      si === 0 ? ctx.moveTo(x, bandY + yOff) : ctx.lineTo(x, bandY + yOff)
    }
    ctx.strokeStyle = stemColor(id, 0.35 + sm * 0.65 + pulse * 0.18); ctx.lineWidth = 1.2 + sm * 2.8 + pulse * 1.2; ctx.stroke()
  }
  for (let i = st.ripples.length - 1; i >= 0; i--) {
    const r = st.ripples[i]!; r.life += dt
    if (r.life >= r.maxLife) { st.ripples.splice(i, 1); continue }
    const t = r.life / r.maxLife, a = (1 - t) * r.strength, rad = Math.min(w, h) * (0.05 + t * 0.55)
    ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(255,235,240,${a * 0.75})`; ctx.lineWidth = 2.5 + (1 - t) * 5; ctx.stroke()
  }
  if (vocal > 0.05) {
    const strands = 2 + Math.floor(vocal * 4)
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.sin(st.time * 0.8) * 0.15)
    for (let s = 0; s < strands; s++) {
      const off = (s - strands / 2) * 65
      ctx.beginPath(); ctx.moveTo(-w * 0.4, h * 0.25 + off)
      ctx.bezierCurveTo(-w * 0.15, cy + Math.sin(st.time * 2 + s) * 85 + off, w * 0.15, cy + Math.cos(st.time * 1.7 + s) * 65 + off, w * 0.4, h * 0.15 + off)
      ctx.strokeStyle = stemColor('vocals', 0.15 + vocal * 0.4 + pulse * 0.1); ctx.lineWidth = 1.8 + vocal * 3.5; ctx.lineCap = 'round'; ctx.stroke()
    }
    ctx.restore()
  }
  const glowR = Math.min(w, h) * 0.28 * (1 + st.kickLevel * 0.45 + pulse * 0.22)
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR)
  glow.addColorStop(0, rgbArr(MUSIC_ACCENT, 0.18 + mean * 0.3 + st.kickLevel * 0.22))
  glow.addColorStop(0.5, rgb(200, 60, 100, 0.06 + mean * 0.12)); glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, glowR, 0, Math.PI * 2); ctx.fill()
  if (st.kickLevel > 0.08) { ctx.fillStyle = `rgba(255,240,245,${st.kickLevel * 0.3})`; ctx.fillRect(0, 0, w, h) }
  const vig = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, Math.max(w, h) * 0.75)
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, `rgba(0,0,0,${0.35 - st.kickLevel * 0.08})`)
  ctx.fillStyle = vig; ctx.fillRect(0, 0, w, h)
}
