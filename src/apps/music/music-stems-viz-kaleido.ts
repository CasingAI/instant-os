/**
 * 分轨可视化 · 万花筒
 */
import type { StemId } from '../stems/stems-types.ts'
import { STEM_IDS } from '../stems/stems-types.ts'
import type { StemVizSample } from './music-stems-features.ts'
import { beatPulse, beatWave, decay, meanEnergy, onsetPulse, rgbArr, stemColor, MUSIC_ACCENT } from './music-stems-viz-math.ts'

export type KaleidoDrawState = { kickLevel: number; time: number; rot: number; bloom: number }
export function createKaleidoDrawState(): KaleidoDrawState { return { kickLevel: 0, time: 0, rot: 0, bloom: 0 } }
const LAYERS: StemId[] = ['bass', 'drums', 'other', 'other2', 'piano', 'guitar', 'vocals']

export function drawStemKaleido(ctx: CanvasRenderingContext2D, w: number, h: number, sample: StemVizSample, dt: number, st: KaleidoDrawState): void {
  st.time += dt; const cx = w / 2, cy = h / 2
  const mean = meanEnergy(sample), pulse = beatPulse(sample.beatPhase, 0.08, 2.2), wave = beatWave(sample.beatPhase)
  const kick = onsetPulse(sample.drumsOnset, 0.08), bass = sample.byStem.bass?.energy ?? 0
  const vocal = sample.byStem.vocals?.energy ?? 0, drums = sample.byStem.drums?.energy ?? 0
  st.kickLevel = decay(st.kickLevel, kick, dt, 8)
  st.bloom += (mean - st.bloom) * Math.min(1, dt * 4)
  st.rot += dt * (0.1 + sample.bpm / 340) * (0.4 + mean * 0.7)
  ctx.fillStyle = '#030308'; ctx.fillRect(0, 0, w, h)
  const maxR = Math.min(w, h) * 0.5
  const coreR = maxR * (0.07 + st.kickLevel * 0.1 + pulse * 0.05 + st.bloom * 0.04)
  const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR)
  cg.addColorStop(0, `rgba(255,245,250,${0.6 + st.kickLevel * 0.45})`)
  cg.addColorStop(0.35, rgbArr(MUSIC_ACCENT, 0.4 + mean * 0.35 + pulse * 0.2))
  cg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, Math.PI * 2); ctx.fill()
  for (let li = 0; li < 7; li++) {
    const id = LAYERS[li]!, e = sample.byStem[id]?.energy ?? 0, onset = sample.byStem[id]?.onset ?? 0
    const sym = 6 + li * 2, baseR = maxR * (0.12 + li / 7 * 0.72)
    const layerR = baseR * (0.85 + e * 0.3 + pulse * 0.07 + st.kickLevel * 0.06)
    const rot = st.rot * (0.5 + li * 0.12) + li * 0.8
    const breathe = 1 + Math.sin(st.time * 2 + li) * bass * 0.08
    for (let s = 0; s < sym; s++) {
      const a = rot + (s / sym) * Math.PI * 2
      const pLen = layerR * breathe * (0.35 + e * 0.55 + onset * 0.3)
      const px = cx + Math.cos(a) * layerR, py = cy + Math.sin(a) * layerR
      const tipX = cx + Math.cos(a) * (layerR + pLen), tipY = cy + Math.sin(a) * (layerR + pLen)
      ctx.beginPath(); ctx.moveTo(px, py)
      ctx.quadraticCurveTo(cx + Math.cos(a + 0.25) * (layerR + pLen * 0.6), cy + Math.sin(a + 0.25) * (layerR + pLen * 0.6), tipX, tipY)
      ctx.quadraticCurveTo(cx + Math.cos(a - 0.25) * (layerR + pLen * 0.6), cy + Math.sin(a - 0.25) * (layerR + pLen * 0.6), px, py)
      ctx.closePath(); ctx.fillStyle = stemColor(id, 0.12 + e * 0.4 + pulse * 0.12 + onset * 0.2); ctx.fill()
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tipX, tipY)
      ctx.strokeStyle = stemColor(id, 0.3 + e * 0.6 + onset * 0.35); ctx.lineWidth = 1 + e * 2.5 + pulse * 1.2; ctx.stroke()
    }
    ctx.beginPath(); ctx.arc(cx, cy, layerR, 0, Math.PI * 2)
    ctx.strokeStyle = stemColor(id, 0.1 + e * 0.25 + pulse * 0.1); ctx.lineWidth = 1.2 + e * 2; ctx.stroke()
  }
  if (drums > 0.08 || st.kickLevel > 0.12) {
    const sLen = maxR * (0.22 + drums * 0.4 + st.kickLevel * 0.55)
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(st.rot * 0.3)
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * coreR * 0.8, Math.sin(a) * coreR * 0.8); ctx.lineTo(Math.cos(a) * sLen, Math.sin(a) * sLen); ctx.strokeStyle = `rgba(255,235,240,${(drums * 0.35 + st.kickLevel * 0.55) * (0.35 + pulse * 0.45)})`; ctx.lineWidth = 1.2 + st.kickLevel * 3.5; ctx.stroke() }
    ctx.restore()
  }
  if (vocal > 0.05) {
    const petals = 8 + Math.round(vocal * 14), r = maxR * 0.88 * (0.9 + vocal * 0.12 + wave * 0.04)
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(st.rot * 0.7)
    for (let i = 0; i < petals; i++) { const a = i / petals * Math.PI * 2, len = r * (0.15 + vocal * 0.3); ctx.beginPath(); ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); ctx.quadraticCurveTo(Math.cos(a + 0.15) * (r + len), Math.sin(a + 0.15) * (r + len), Math.cos(a + 0.3) * r, Math.sin(a + 0.3) * r); ctx.strokeStyle = stemColor('vocals', 0.18 + vocal * 0.45 + pulse * 0.12); ctx.lineWidth = 1.2 + vocal * 2.5; ctx.stroke() }
    ctx.restore()
  }
  if (st.kickLevel > 0.08) { ctx.fillStyle = `rgba(255,240,245,${st.kickLevel * 0.32})`; ctx.fillRect(0, 0, w, h) }
  const vig = ctx.createRadialGradient(cx, cy, maxR * 0.3, cx, cy, maxR * 1.2)
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, `rgba(0,0,0,${0.38 - st.kickLevel * 0.08})`)
  ctx.fillStyle = vig; ctx.fillRect(0, 0, w, h)
}
