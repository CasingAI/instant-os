/**
 * 分轨可视化 · 玻璃
 * 毛玻璃棱镜万花筒
 */
import { STEM_COLORS, STEM_IDS } from '../stems/stems-types.ts'
import type { StemVizSample } from './music-stems-features.ts'
import { beatPulse, decay, meanEnergy, onsetPulse, rgbArr, stemColor, MUSIC_ACCENT } from './music-stems-viz-math.ts'

export type GlassDrawState = { kickLevel: number; time: number; rot: number; shimmer: number }
export function createGlassDrawState(): GlassDrawState { return { kickLevel: 0, time: 0, rot: 0, shimmer: 0 } }

export function drawStemGlass(ctx: CanvasRenderingContext2D, w: number, h: number, sample: StemVizSample, dt: number, st: GlassDrawState): void {
  st.time += dt; const cx = w / 2, cy = h / 2
  const mean = meanEnergy(sample), pulse = beatPulse(sample.beatPhase, 0.08, 2.2)
  const kick = onsetPulse(sample.drumsOnset, 0.08)
  st.kickLevel = decay(st.kickLevel, kick, dt, 7)
  st.rot += dt * (0.2 + sample.bpm / 400) * (0.5 + mean * 0.8)
  st.shimmer += dt * (3 + st.kickLevel * 8)
  ctx.fillStyle = '#040310'; ctx.fillRect(0, 0, w, h)
  const maxR = Math.min(w, h) * 0.45
  const bgGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 1.2)
  bgGlow.addColorStop(0, rgbArr(MUSIC_ACCENT, 0.06 + mean * 0.1 + st.kickLevel * 0.1))
  bgGlow.addColorStop(0.5, `rgba(60,30,90,${0.04 + mean * 0.06})`); bgGlow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = bgGlow; ctx.fillRect(0, 0, w, h)
  const t = st.time, sides = 6 + Math.round(mean * 3)
  const prismR = maxR * (0.25 + mean * 0.15 + pulse * 0.05 + st.kickLevel * 0.08)
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(st.rot)
  ctx.beginPath()
  for (let i = 0; i <= sides; i++) { const a = (i / sides) * Math.PI * 2, r = prismR * (0.95 + Math.sin(a * 2 + t * 3) * 0.05 + pulse * 0.03); i === 0 ? ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) }
  ctx.closePath(); ctx.fillStyle = `rgba(255,245,255,${0.04 + mean * 0.06 + st.kickLevel * 0.08})`; ctx.fill()
  ctx.strokeStyle = `rgba(255,255,255,${0.12 + mean * 0.2 + pulse * 0.15})`; ctx.lineWidth = 1.5 + pulse * 1.5; ctx.stroke()
  ctx.restore()
  for (let fi = 0; fi < 7; fi++) {
    const id = STEM_IDS[fi]!, e = sample.byStem[id]?.energy ?? 0, high = sample.byStem[id]?.bands.high ?? 0, onset = sample.byStem[id]?.onset ?? 0
    const hex = STEM_COLORS[id], rgbM = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
    const rgb: [number, number, number] = rgbM ? [parseInt(rgbM[1]!, 16), parseInt(rgbM[2]!, 16), parseInt(rgbM[3]!, 16)] : [200, 200, 200]
    const a0 = (fi / 7) * Math.PI * 2 + st.rot, a1 = ((fi + 1) / 7) * Math.PI * 2 + st.rot
    const facetR = maxR * (0.5 + e * 0.35 + pulse * 0.05)
    const shimmer = Math.sin(st.shimmer + fi * 1.8) * 0.5 + 0.5
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a0) * prismR * 0.3, cy + Math.sin(a0) * prismR * 0.3)
    ctx.lineTo(cx + Math.cos(a0) * facetR, cy + Math.sin(a0) * facetR)
    ctx.lineTo(cx + Math.cos(a1) * facetR, cy + Math.sin(a1) * facetR)
    ctx.lineTo(cx + Math.cos(a1) * prismR * 0.3, cy + Math.sin(a1) * prismR * 0.3)
    ctx.closePath()
    const grad = ctx.createRadialGradient(cx, cy, prismR * 0.2, cx, cy, facetR)
    grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.08 + e * 0.2})`)
    grad.addColorStop(0.6, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.04 + e * 0.12 + shimmer * 0.05})`)
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad; ctx.fill()
    ctx.strokeStyle = stemColor(id, 0.15 + e * 0.45 + pulse * 0.1); ctx.lineWidth = 1 + e * 2.5; ctx.stroke()
    if (high > 0.15) {
      const midA = (a0 + a1) / 2, refR = 5 + high * 18 + shimmer * 8
      ctx.beginPath(); ctx.fillStyle = `rgba(255,255,255,${0.15 + high * 0.35 + shimmer * 0.1})`; ctx.arc(cx + Math.cos(midA) * facetR * 0.65, cy + Math.sin(midA) * facetR * 0.65, refR, 0, Math.PI * 2); ctx.fill()
    }
    if (onset > 0.2) {
      const midA = (a0 + a1) / 2, rayLen = facetR * (0.8 + onset * 0.6)
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(midA) * prismR * 0.2, cy + Math.sin(midA) * prismR * 0.2)
      ctx.lineTo(cx + Math.cos(midA) * rayLen, cy + Math.sin(midA) * rayLen)
      ctx.strokeStyle = stemColor(id, onset * 0.6); ctx.lineWidth = 0.8 + onset * 3; ctx.stroke()
    }
  }
  const ringR = maxR * (0.7 + pulse * 0.05 + st.kickLevel * 0.05)
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2, a1 = ((i + 1) / 48) * Math.PI * 2, id = STEM_IDS[i % 7]!, e = sample.byStem[id]?.energy ?? 0
    ctx.beginPath(); ctx.arc(cx, cy, ringR, a, a1); ctx.strokeStyle = stemColor(id, 0.06 + e * 0.2 + pulse * 0.06); ctx.lineWidth = 0.8 + e * 1.5; ctx.stroke()
  }
  if (st.kickLevel > 0.1) { ctx.fillStyle = `rgba(255,240,255,${st.kickLevel * 0.28})`; ctx.fillRect(0, 0, w, h) }
  const vig = ctx.createRadialGradient(cx, cy, maxR * 0.35, cx, cy, maxR * 1.3)
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, `rgba(0,0,0,${0.35 - st.kickLevel * 0.08})`)
  ctx.fillStyle = vig; ctx.fillRect(0, 0, w, h)
}
