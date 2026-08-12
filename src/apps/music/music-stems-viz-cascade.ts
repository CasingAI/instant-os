/**
 * 分轨可视化 · 轨瀑（重写）
 * 每轨水平色带卷动 + 三频带染色 + bloom + 节拍闪光 + 同峰连线。
 */

import type { StemId } from '../stems/stems-types.ts'
import { STEM_COLORS } from '../stems/stems-types.ts'
import type { StemVizSample } from './music-stems-features.ts'
import {
  clamp,
  meanEnergy,
  onsetPulse,
  STEM_IDS,
  stemColor,
  withAlpha,
} from './music-stems-viz-math.ts'
import { hexToRgb } from './music-visualizer-math.ts'

const HISTORY = 140

export type CascadeDrawState = {
  energyHist: Record<StemId, Float32Array>
  lowHist: Record<StemId, Float32Array>
  midHist: Record<StemId, Float32Array>
  highHist: Record<StemId, Float32Array>
  cursor: number
  filled: number
  scrollAcc: number
  prevBeat: number
  kickFlash: number
}

function emptyHist(): Record<StemId, Float32Array> {
  const out = {} as Record<StemId, Float32Array>
  for (const id of STEM_IDS) {
    out[id] = new Float32Array(HISTORY)
  }
  return out
}

export function createCascadeDrawState(): CascadeDrawState {
  return {
    energyHist: emptyHist(),
    lowHist: emptyHist(),
    midHist: emptyHist(),
    highHist: emptyHist(),
    cursor: 0,
    filled: 0,
    scrollAcc: 0,
    prevBeat: 0,
    kickFlash: 0,
  }
}

function pushSample(st: CascadeDrawState, sample: StemVizSample): void {
  const i = st.cursor % HISTORY
  for (const id of STEM_IDS) {
    const frame = sample.byStem[id]
    st.energyHist[id]![i] = frame?.energy ?? 0
    st.lowHist[id]![i] = frame?.bands.low ?? 0
    st.midHist[id]![i] = frame?.bands.mid ?? 0
    st.highHist[id]![i] = frame?.bands.high ?? 0
  }
  st.cursor = (st.cursor + 1) % HISTORY
  st.filled = Math.min(HISTORY, st.filled + 1)
}

function histAt(
  series: Float32Array,
  cursor: number,
  filled: number,
  ageFromNew: number,
): number {
  if (filled === 0 || ageFromNew >= filled) return 0
  const idx = (cursor - 1 - ageFromNew + HISTORY * 4) % HISTORY
  return series[idx] ?? 0
}

export function drawStemCascade(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sample: StemVizSample,
  dt: number,
  st: CascadeDrawState,
): void {
  const mean = meanEnergy(sample)
  const kick = onsetPulse(sample.drumsOnset, 0.12)

  st.kickFlash *= Math.exp(-dt * 9)
  if (kick > 0.35) st.kickFlash = Math.max(st.kickFlash, kick)

  st.scrollAcc += dt
  const step = 1 / 30
  while (st.scrollAcc >= step) {
    st.scrollAcc -= step
    pushSample(st, sample)
  }

  ctx.fillStyle = '#04040a'
  ctx.fillRect(0, 0, w, h)

  const laneH = h / (STEM_IDS.length + 0.3)
  const padX = w * 0.04
  const padY = laneH * 0.16
  const usableW = w - padX * 2
  const cols = Math.min(HISTORY, Math.max(24, Math.floor(usableW / 2.8)))

  if (st.kickFlash > 0.04) {
    const flashW = Math.max(50, usableW * 0.14)
    const g = ctx.createLinearGradient(padX + usableW - flashW, 0, padX + usableW, 0)
    g.addColorStop(0, withAlpha(STEM_COLORS.drums, 0))
    g.addColorStop(1, withAlpha(STEM_COLORS.drums, st.kickFlash * 0.45))
    ctx.fillStyle = g
    ctx.fillRect(padX + usableW - flashW, 0, flashW, h)
  }

  for (let li = 0; li < STEM_IDS.length; li++) {
    const id = STEM_IDS[li]!
    const laneTop = laneH * li + padY
    const laneBody = laneH - padY * 2
    const eNow = sample.byStem[id]?.energy ?? 0
    const rgb = hexToRgb(STEM_COLORS[id]) ?? [200, 200, 200]

    ctx.fillStyle = withAlpha(STEM_COLORS[id], 0.03 + eNow * 0.05)
    ctx.fillRect(padX, laneTop + laneBody * 0.5, usableW, 1)

    for (let c = 0; c < cols; c++) {
      const ageFromNew = Math.floor(
        ((cols - 1 - c) / Math.max(1, cols - 1)) * Math.max(0, st.filled - 1),
      )
      const energy = histAt(st.energyHist[id]!, st.cursor, st.filled, ageFromNew)
      const low = histAt(st.lowHist[id]!, st.cursor, st.filled, ageFromNew)
      const mid = histAt(st.midHist[id]!, st.cursor, st.filled, ageFromNew)
      const high = histAt(st.highHist[id]!, st.cursor, st.filled, ageFromNew)
      if (energy < 0.02) continue

      const x = padX + (c / cols) * usableW
      const barW = Math.max(2, usableW / cols + 0.5)
      const barH = laneBody * (0.1 + energy * 0.9)
      const y = laneTop + laneBody - barH

      const tint = 0.55 + mid * 0.3 + high * 0.4 - low * 0.08
      const r = clamp(Math.round(rgb[0] * tint + high * 35), 0, 255)
      const g = clamp(Math.round(rgb[1] * tint + mid * 18), 0, 255)
      const b = clamp(Math.round(rgb[2] * tint + low * 25), 0, 255)

      const ageBright = 0.3 + (c / cols) * 0.7
      const alpha = (0.35 + energy * 0.65) * ageBright

      if (energy > 0.12) {
        ctx.save()
        ctx.shadowColor = STEM_COLORS[id]
        ctx.shadowBlur = 6 + energy * 14
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha * 0.4})`
        ctx.fillRect(x - 1, y - 2, barW + 2, barH + 4)
        ctx.restore()
      }

      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`
      ctx.fillRect(x, y, barW, barH)
    }

    ctx.fillStyle = stemColor(id, 0.45 + eNow * 0.45)
    ctx.fillRect(6, laneTop + laneBody * 0.5 - 3, 3, 6)
  }

  const peaks: { y: number; e: number }[] = []
  for (let li = 0; li < STEM_IDS.length; li++) {
    const id = STEM_IDS[li]!
    const e = sample.byStem[id]?.energy ?? 0
    if (e > 0.45) {
      const laneTop = laneH * li + padY
      const laneBody = laneH - padY * 2
      peaks.push({ y: laneTop + laneBody * (1 - e * 0.5), e })
    }
  }
  if (peaks.length >= 2) {
    ctx.save()
    ctx.shadowColor = 'rgba(255,210,255,0.3)'
    ctx.shadowBlur = 6
    ctx.lineWidth = 1.2
    for (let i = 0; i < peaks.length - 1; i++) {
      const a = peaks[i]!
      const b = peaks[i + 1]!
      ctx.beginPath()
      ctx.moveTo(padX + usableW - 5, a.y)
      ctx.lineTo(padX + usableW - 5, b.y)
      ctx.strokeStyle = `rgba(255,210,255,${0.15 + Math.min(a.e, b.e) * 0.3})`
      ctx.stroke()
    }
    ctx.restore()
  }

  if (mean > 0.05) {
    const aura = ctx.createRadialGradient(
      w * 0.5, h * 0.5, 0,
      w * 0.5, h * 0.5, Math.max(w, h) * 0.5,
    )
    aura.addColorStop(0, `rgba(120,80,180,${mean * 0.025})`)
    aura.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = aura
    ctx.fillRect(0, 0, w, h)
  }
}
