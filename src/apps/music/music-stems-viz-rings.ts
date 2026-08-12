/**
 * 分轨可视化 · 轨环（重写）
 * 七轨偏心轨道 + additive glow + 鼓 onset 粒子 + 人声辐条 + 中心核。
 */

import type { StemId } from '../stems/stems-types.ts'
import { STEM_COLORS } from '../stems/stems-types.ts'
import type { StemVizSample } from './music-stems-features.ts'
import { beatPulse, clamp, meanEnergy, onsetPulse, stemColor } from './music-stems-viz-math.ts'
import { withAlpha } from './music-visualizer-math.ts'

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: string
  size: number
}

export type RingsDrawState = {
  particles: Particle[]
  spin: number
  prevOnset: number
}

export function createRingsDrawState(): RingsDrawState {
  return { particles: [], spin: 0, prevOnset: 0 }
}

const RING_ORDER: StemId[] = ['bass', 'drums', 'other', 'other2', 'guitar', 'piano', 'vocals']

export function drawStemRings(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sample: StemVizSample,
  dt: number,
  st: RingsDrawState,
): void {
  const cx = w * 0.5
  const cy = h * 0.5
  const maxR = Math.min(w, h) * 0.42
  const mean = meanEnergy(sample)
  const pulse = beatPulse(sample.beatPhase, 0.12)
  const kick = onsetPulse(sample.drumsOnset, 0.12)

  st.spin += dt * (0.18 + sample.bpm / 220) * (0.5 + mean)

  // 深色背景
  ctx.fillStyle = '#04040a'
  ctx.fillRect(0, 0, w, h)

  // 中心辉光底（宽柔渐变）
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.7)
  bg.addColorStop(0, `rgba(80, 50, 140, ${0.08 + mean * 0.15 + pulse * 0.08})`)
  bg.addColorStop(0.5, `rgba(30, 15, 60, ${0.03 + mean * 0.06})`)
  bg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  // ── 轨道（辉光层 + 亮线层） ──
  for (let i = 0; i < RING_ORDER.length; i++) {
    const id = RING_ORDER[i]!
    const e = sample.byStem[id]?.energy ?? 0
    const baseRatio = 0.16 + (i / (RING_ORDER.length - 1)) * 0.74
    const radius = maxR * baseRatio * (0.88 + e * 0.28 + pulse * 0.03)
    const rot = st.spin * (0.55 + i * 0.1) + i * 0.9
    const ecc = 0.018 + i * 0.01
    const ox = Math.cos(rot * 0.28 + i) * maxR * ecc
    const oy = Math.sin(rot * 0.22 + i * 1.3) * maxR * ecc * 0.6
    const tilt = 0.84 + e * 0.1
    const lineBase = clamp(1.5 + e * 5, 1, 8)

    // glow layer
    ctx.save()
    ctx.shadowColor = STEM_COLORS[id]
    ctx.shadowBlur = 12 + e * 20 + pulse * 6
    ctx.beginPath()
    ctx.ellipse(cx + ox, cy + oy, radius, radius * tilt, rot * 0.12, 0, Math.PI * 2)
    ctx.strokeStyle = stemColor(id, 0.15 + e * 0.5)
    ctx.lineWidth = lineBase + 1
    ctx.stroke()
    ctx.restore()

    // bright core line
    ctx.beginPath()
    ctx.ellipse(cx + ox, cy + oy, radius, radius * tilt, rot * 0.12, 0, Math.PI * 2)
    ctx.strokeStyle = stemColor(id, 0.25 + e * 0.65 + pulse * 0.08)
    ctx.lineWidth = Math.max(0.6, lineBase * 0.5)
    ctx.stroke()

    // orbit dot
    if (e > 0.08) {
      const ang = rot * 1.05 + i * 2.1
      const px = cx + ox + Math.cos(ang) * radius
      const py = cy + oy + Math.sin(ang) * radius * tilt
      const dotR = 1.8 + e * 3.5 + pulse * 1.5

      ctx.save()
      ctx.shadowColor = STEM_COLORS[id]
      ctx.shadowBlur = 14 + e * 22
      ctx.beginPath()
      ctx.fillStyle = stemColor(id, 0.7 + e * 0.3)
      ctx.arc(px, py, dotR, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      // hot white center
      ctx.beginPath()
      ctx.fillStyle = `rgba(255,255,255,${0.4 + e * 0.55})`
      ctx.arc(px, py, dotR * 0.35, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // ── 鼓 onset 粒子 ──
  if (kick > 0.25 && kick > st.prevOnset) {
    const n = Math.round(6 + kick * 18)
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2
      const speed = 60 + kick * 220 + Math.random() * 100
      st.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life: 0,
        maxLife: 0.35 + Math.random() * 0.45,
        color: STEM_COLORS.drums,
        size: 1.2 + kick * 2.5 + Math.random() * 2,
      })
    }
  }
  st.prevOnset = kick

  for (let i = st.particles.length - 1; i >= 0; i--) {
    const p = st.particles[i]!
    p.life += dt
    if (p.life >= p.maxLife) {
      st.particles.splice(i, 1)
      continue
    }
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.vx *= 0.965
    p.vy *= 0.965
    const a = 1 - p.life / p.maxLife
    const sz = p.size * (0.3 + a * 0.7)

    ctx.save()
    ctx.shadowColor = p.color
    ctx.shadowBlur = 10 + sz * 3
    ctx.beginPath()
    ctx.fillStyle = withAlpha(p.color, a * 0.85)
    ctx.arc(p.x, p.y, sz, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    ctx.beginPath()
    ctx.fillStyle = `rgba(255,255,255,${a * 0.45})`
    ctx.arc(p.x, p.y, sz * 0.3, 0, Math.PI * 2)
    ctx.fill()
  }
  if (st.particles.length > 220) st.particles.splice(0, st.particles.length - 220)

  // ── 人声辐条 ──
  const vocal = sample.byStem.vocals?.energy ?? 0
  if (vocal > 0.06) {
    const spokes = 6 + Math.round(vocal * 12)
    const inner = maxR * 0.06
    const outer = maxR * (0.26 + vocal * 0.22)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(st.spin * 0.3)
    ctx.shadowColor = STEM_COLORS.vocals
    ctx.shadowBlur = 8 + vocal * 14
    ctx.lineWidth = 0.8 + vocal * 2
    for (let s = 0; s < spokes; s++) {
      const a = (s / spokes) * Math.PI * 2
      const boost = 0.5 + (sample.byStem.vocals?.bands.high ?? 0) * 0.6
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner)
      ctx.lineTo(Math.cos(a) * outer * boost, Math.sin(a) * outer * boost)
      ctx.strokeStyle = stemColor('vocals', 0.12 + vocal * 0.35)
      ctx.stroke()
    }
    ctx.restore()
  }

  // ── 中心核 ──
  const coreR = maxR * (0.06 + mean * 0.05 + kick * 0.035)
  const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR)
  coreGlow.addColorStop(0, `rgba(255, 230, 255, ${0.5 + mean * 0.35 + kick * 0.25})`)
  coreGlow.addColorStop(0.35, `rgba(200, 140, 255, ${0.2 + mean * 0.2 + kick * 0.15})`)
  coreGlow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = coreGlow
  ctx.beginPath()
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
  ctx.fill()
}
