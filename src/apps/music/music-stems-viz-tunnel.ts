/**
 * 分轨可视化 · 隧道
 */
import type { StemVizSample } from './music-stems-features.ts'
import { STEM_IDS } from '../stems/stems-types.ts'
import { beatPulse, decay, meanEnergy, onsetPulse, rgbArr, stemColor, MUSIC_ACCENT } from './music-stems-viz-math.ts'

export type TunnelDrawState = { depth: number; kickLevel: number; prevBeat: number; time: number; rot: number }
export function createTunnelDrawState(): TunnelDrawState { return { depth: 0, kickLevel: 0, prevBeat: 0, time: 0, rot: 0 } }

export function drawStemTunnel(ctx: CanvasRenderingContext2D, w: number, h: number, sample: StemVizSample, dt: number, st: TunnelDrawState): void {
  st.time += dt
  const cx = w * 0.5, cy = h * 0.52, mean = meanEnergy(sample)
  const pulse = beatPulse(sample.beatPhase, 0.08, 2.2)
  const kick = onsetPulse(sample.drumsOnset, 0.08)
  const bass = sample.byStem.bass?.energy ?? 0, vocal = sample.byStem.vocals?.energy ?? 0, drums = sample.byStem.drums?.energy ?? 0
  st.kickLevel = decay(st.kickLevel, kick, dt, 8); st.prevBeat = sample.beatPhase
  st.depth += dt * (0.6 + sample.bpm / 80) * (0.5 + mean * 0.8 + drums * 0.5) + st.kickLevel * dt * 7
  st.rot += dt * (0.12 + sample.bpm / 380) * (0.4 + mean * 0.6)
  ctx.fillStyle = '#030308'; ctx.fillRect(0, 0, w, h)
  const maxDim = Math.max(w, h)
  for (let i = 23; i >= 0; i--) {
    const t = ((i + (st.depth % 1)) / 24) % 1
    const radius = maxDim * (0.04 + t * t * 1.15) * (1 + st.kickLevel * 0.28 + pulse * 0.08)
    const wobble = Math.sin(st.time * 2 + i * 0.6) * (bass * 25 + mean * 12)
    const x = cx + Math.sin(st.rot * 2 + i * 0.3) * wobble, y = cy + Math.cos(st.rot * 1.7 + i * 0.4) * wobble * 0.7
    const id = STEM_IDS[i % 7]!, e = sample.byStem[id]?.energy ?? 0
    const alpha = (0.1 + e * 0.6 + pulse * 0.2) * (0.3 + t * 0.7), lw = (1.2 + e * 6 + pulse * 2.5) * (0.3 + t * 0.7)
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, radius), 0, Math.PI * 2)
    ctx.strokeStyle = stemColor(id, alpha); ctx.lineWidth = lw; ctx.stroke()
    if (t > 0.5 && e > 0.12) { ctx.beginPath(); ctx.arc(x, y, Math.max(1, radius), 0, Math.PI * 2); ctx.strokeStyle = `rgba(255,255,255,${0.12 + e * 0.35})`; ctx.lineWidth = Math.max(0.5, lw * 0.35); ctx.stroke() }
  }
  const abyssR = maxDim * 0.07 * (1 + st.kickLevel + pulse * 0.5)
  const abyss = ctx.createRadialGradient(cx, cy, 0, cx, cy, abyssR)
  abyss.addColorStop(0, `rgba(255,245,250,${0.55 + st.kickLevel * 0.45})`)
  abyss.addColorStop(0.4, rgbArr(MUSIC_ACCENT, 0.3 + mean * 0.35 + pulse * 0.25)); abyss.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = abyss; ctx.beginPath(); ctx.arc(cx, cy, abyssR, 0, Math.PI * 2); ctx.fill()
  if (vocal > 0.05) {
    const spokes = 6 + Math.round(vocal * 10), inner = maxDim * 0.04, outer = maxDim * (0.2 + vocal * 0.28)
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(st.rot * 1.5 + sample.beatPhase * Math.PI)
    for (let s = 0; s < spokes; s++) { const a = (s / spokes) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner); ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer); ctx.strokeStyle = stemColor('vocals', 0.15 + vocal * 0.5 + pulse * 0.12); ctx.lineWidth = 1 + vocal * 2.5; ctx.stroke() }
    ctx.restore()
  }
  if (st.kickLevel > 0.08) { ctx.fillStyle = `rgba(255,240,245,${st.kickLevel * 0.35})`; ctx.fillRect(0, 0, w, h) }
  const vig = ctx.createRadialGradient(cx, cy, maxDim * 0.25, cx, cy, maxDim * 0.75)
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, `rgba(0,0,0,${0.38 - st.kickLevel * 0.1})`)
  ctx.fillStyle = vig; ctx.fillRect(0, 0, w, h)
}
