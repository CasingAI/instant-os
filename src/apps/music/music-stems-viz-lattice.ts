/**
 * 分轨可视化 · 晶格（重写）
 * 透视网格 + 节拍脉冲形变 + 多轨着色 + 鼓冲击波 + bloom。
 */

import type { StemVizSample } from './music-stems-features.ts'
import {
  beatPulse,
  clamp,
  meanEnergy,
  mixStemColors,
  onsetPulse,
  rgbCss,
  STEM_IDS,
  stemColor,
} from './music-stems-viz-math.ts'
import { STEM_COLORS } from '../stems/stems-types.ts'

export type LatticeDrawState = {
  shock: number
  rot: number
  waveAcc: number
}

export function createLatticeDrawState(): LatticeDrawState {
  return { shock: 0, rot: 0, waveAcc: 0 }
}

export function drawStemLattice(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sample: StemVizSample,
  dt: number,
  st: LatticeDrawState,
): void {
  const kick = onsetPulse(sample.drumsOnset, 0.12)
  const pulse = beatPulse(sample.beatPhase, 0.14)
  const bass = sample.byStem.bass?.energy ?? 0
  const mean = meanEnergy(sample)
  const vocal = sample.byStem.vocals?.energy ?? 0

  st.shock = Math.max(st.shock * Math.exp(-dt * 7), kick)
  st.rot += dt * (0.05 + sample.bpm / 550) * (0.35 + mean * 0.65)
  st.waveAcc += dt

  ctx.fillStyle = '#04040a'
  ctx.fillRect(0, 0, w, h)

  const mix = mixStemColors(sample)
  const cg = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, Math.min(w, h) * 0.45)
  cg.addColorStop(0, rgbCss(mix, 0.05 + mean * 0.1))
  cg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = cg
  ctx.fillRect(0, 0, w, h)

  const cols = Math.max(8, Math.min(14, Math.round(w / 62)))
  const rows = Math.max(6, Math.min(10, Math.round(h / 62)))
  const perspective = 0.58 + bass * 0.42
  const scalePunch = 1 + pulse * 0.05 + st.shock * 0.08
  const cx = w * 0.5
  const cy = h * 0.5

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(st.rot * 0.08)
  ctx.scale(scalePunch, scalePunch * (0.95 + bass * 0.05))

  const cellW = (w * 0.86) / cols
  const cellH = (h * 0.72) / rows

  ctx.lineWidth = 0.7
  for (let y = 0; y <= rows; y++) {
    const py = (y - rows / 2) * cellH * perspective
    const warp = Math.sin(y * 0.48 + sample.beatPhase * Math.PI * 2) * bass * 8
    ctx.beginPath()
    ctx.moveTo((-cols / 2) * cellW + warp, py)
    ctx.lineTo((cols / 2) * cellW + warp, py)
    ctx.strokeStyle = `rgba(100,80,160,${0.06 + mean * 0.1 + pulse * 0.06})`
    ctx.stroke()
  }
  for (let x = 0; x <= cols; x++) {
    const px = (x - cols / 2) * cellW
    const wy = Math.sin(x * 0.38 + sample.beatPhase * Math.PI * 2 + 1) * bass * 5
    ctx.beginPath()
    ctx.moveTo(px, (-rows / 2) * cellH * perspective + wy)
    ctx.lineTo(px, (rows / 2) * cellH * perspective + wy)
    ctx.strokeStyle = `rgba(100,80,160,${0.05 + mean * 0.08 + pulse * 0.05})`
    ctx.stroke()
  }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const u = x / Math.max(1, cols - 1)
      const v = y / Math.max(1, rows - 1)
      const stemIndex = Math.floor((u * 0.6 + v * 0.4) * (STEM_IDS.length - 0.001))
      const id = STEM_IDS[clamp(stemIndex, 0, STEM_IDS.length - 1)]!
      const e = sample.byStem[id]?.energy ?? 0
      const wave =
        Math.sin(u * 7 + st.waveAcc * 2.2 + v * 4.5) *
        Math.sin(v * 5.5 - st.waveAcc * 1.5 + u * 2.8)
      const local = e * (0.35 + 0.65 * wave)

      const px = (x - (cols - 1) / 2) * cellW
      const py = (y - (rows - 1) / 2) * cellH * perspective
      const dist = Math.hypot(px, py) / (Math.min(w, h) * 0.5)
      const nodeR = Math.max(
        0.6,
        (1.2 + Math.max(0, local) * 5.5 + st.shock * Math.max(0, 1 - dist) * 3.5) * (0.65 + e),
      )

      if (e > 0.12) {
        ctx.save()
        ctx.shadowColor = STEM_COLORS[id]
        ctx.shadowBlur = 10 + e * 18
        ctx.beginPath()
        ctx.fillStyle = stemColor(id, 0.15 + e * 0.35)
        ctx.arc(px, py, nodeR * 0.6, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      ctx.beginPath()
      ctx.fillStyle = stemColor(id, 0.3 + e * 0.7)
      ctx.arc(px, py, nodeR, 0, Math.PI * 2)
      ctx.fill()

      if (e > 0.18 && dist < 0.35) {
        ctx.beginPath()
        ctx.fillStyle = `rgba(255,255,255,${0.15 + e * 0.4 + pulse * 0.12})`
        ctx.arc(px, py, Math.max(0.4, nodeR * 0.35), 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  if (st.shock > 0.04) {
    const shockR = Math.min(w, h) * 0.1 * (1 + st.shock * 2.8)
    ctx.save()
    ctx.shadowColor = 'rgba(200,170,255,0.5)'
    ctx.shadowBlur = 12 + st.shock * 20
    ctx.beginPath()
    ctx.arc(0, 0, shockR, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(200,170,255,${st.shock * 0.5})`
    ctx.lineWidth = 1.5 + st.shock * 3
    ctx.stroke()
    ctx.restore()
  }

  ctx.restore()

  if (vocal > 0.06) {
    const r = Math.min(w, h) * 0.36 * (0.92 + vocal * 0.1 + pulse * 0.02)
    ctx.save()
    ctx.shadowColor = STEM_COLORS.vocals
    ctx.shadowBlur = 8 + vocal * 14
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = stemColor('vocals', 0.06 + vocal * 0.18)
    ctx.lineWidth = 0.8 + vocal * 1.8
    ctx.stroke()
    ctx.restore()
  }
}
