/**
 * 分轨可视化 · 星云（重写）
 * additive glow 粒子系统：贝斯引力核 / 鼓爆发 / 人声光丝 / 闪点 / 雾底。
 */

import type { StemId } from '../stems/stems-types.ts'
import { STEM_COLORS } from '../stems/stems-types.ts'
import type { StemVizSample } from './music-stems-features.ts'
import { beatPulse, clamp, meanEnergy, onsetPulse, stemColor, withAlpha } from './music-stems-viz-math.ts'

type NebulaParticle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  stem: StemId
  role: 'fog' | 'spark' | 'burst' | 'filament' | 'core'
}

export type NebulaDrawState = {
  particles: NebulaParticle[]
  prevKick: number
  time: number
}

export function createNebulaDrawState(): NebulaDrawState {
  return { particles: [], prevKick: 0, time: 0 }
}

const MAX = 320

function spawn(st: NebulaDrawState, p: Omit<NebulaParticle, 'life'> & { life?: number }): void {
  if (st.particles.length >= MAX) st.particles.splice(0, 25)
  st.particles.push({ ...p, life: p.life ?? 0 })
}

export function drawStemNebula(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sample: StemVizSample,
  dt: number,
  st: NebulaDrawState,
): void {
  st.time += dt
  const cx = w * 0.5
  const cy = h * 0.52
  const mean = meanEnergy(sample)
  const kick = onsetPulse(sample.drumsOnset, 0.12)
  const pulse = beatPulse(sample.beatPhase, 0.12)
  const bass = sample.byStem.bass?.energy ?? 0
  const vocal = sample.byStem.vocals?.energy ?? 0
  const guitar = sample.byStem.guitar?.energy ?? 0
  const piano = sample.byStem.piano?.energy ?? 0
  const other = ((sample.byStem.other?.energy ?? 0) + (sample.byStem.other2?.energy ?? 0)) * 0.5

  // 拖影
  ctx.fillStyle = `rgba(4, 4, 10, ${0.22 + (1 - mean) * 0.18})`
  ctx.fillRect(0, 0, w, h)

  // 贝斯引力光球
  if (bass > 0.04) {
    const coreR = 25 + bass * 70 + pulse * 12
    const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR)
    coreGlow.addColorStop(0, withAlpha(STEM_COLORS.bass, 0.12 + bass * 0.3))
    coreGlow.addColorStop(0.4, withAlpha(STEM_COLORS.bass, 0.04 + bass * 0.08))
    coreGlow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = coreGlow
    ctx.fillRect(cx - coreR, cy - coreR, coreR * 2, coreR * 2)
  }

  // 雾底
  if (Math.random() < 0.12 + other * 0.25) {
    spawn(st, {
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 5,
      vy: (Math.random() - 0.5) * 3,
      maxLife: 3 + Math.random() * 2,
      size: 18 + other * 28 + Math.random() * 15,
      stem: Math.random() > 0.5 ? 'other' : 'other2',
      role: 'fog',
    })
  }

  // 贝斯核心粒子
  if (bass > 0.08 && Math.random() < bass * 0.35) {
    const ang = Math.random() * Math.PI * 2
    const r = 10 + Math.random() * 45
    spawn(st, {
      x: cx + Math.cos(ang) * r,
      y: cy + Math.sin(ang) * r * 0.7,
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4,
      maxLife: 1.4 + bass * 1.2,
      size: 5 + bass * 18,
      stem: 'bass',
      role: 'core',
    })
  }

  // 鼓爆发
  if (kick > 0.3 && kick > st.prevKick) {
    const n = Math.round(10 + kick * 22)
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2
      const speed = 70 + kick * 260
      spawn(st, {
        x: cx + Math.cos(ang) * 10,
        y: cy + Math.sin(ang) * 10,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        maxLife: 0.28 + Math.random() * 0.45,
        size: 1.5 + kick * 3 + Math.random() * 1.5,
        stem: 'drums',
        role: 'burst',
      })
    }
  }
  st.prevKick = kick

  // 人声光丝
  if (vocal > 0.06 && Math.random() < vocal * 0.55) {
    const n = 1 + Math.floor(vocal * 3)
    for (let i = 0; i < n; i++) {
      spawn(st, {
        x: cx + (Math.random() - 0.5) * w * 0.38,
        y: h * 0.68 + Math.random() * h * 0.15,
        vx: (Math.random() - 0.5) * 15,
        vy: -(55 + vocal * 140),
        maxLife: 0.7 + vocal * 0.65,
        size: 1.8 + vocal * 3,
        stem: 'vocals',
        role: 'filament',
      })
    }
  }

  // 吉他/钢琴闪点
  const sparkE = (guitar + piano) * 0.5
  if (sparkE > 0.08 && Math.random() < sparkE * 0.5) {
    const stem: StemId = Math.random() > guitar / (guitar + piano + 1e-6) ? 'piano' : 'guitar'
    spawn(st, {
      x: Math.random() * w,
      y: h * 0.12 + Math.random() * h * 0.55,
      vx: (Math.random() - 0.5) * 22,
      vy: (Math.random() - 0.5) * 16,
      maxLife: 0.35 + Math.random() * 0.6,
      size: 1 + sparkE * 2.5,
      stem,
      role: 'spark',
    })
  }

  // 粒子更新 + 绘制
  for (let i = st.particles.length - 1; i >= 0; i--) {
    const p = st.particles[i]!
    p.life += dt
    if (p.life >= p.maxLife) {
      st.particles.splice(i, 1)
      continue
    }

    if (p.role !== 'burst' && bass > 0.04) {
      const dx = cx - p.x
      const dy = cy - p.y
      const dist = Math.max(35, Math.hypot(dx, dy))
      const pull = (35 + bass * 130) / dist
      p.vx += dx * pull * dt * 0.35
      p.vy += dy * pull * dt * 0.35
    }

    if (p.role === 'filament') {
      p.vx += Math.sin(st.time * 3.8 + p.x * 0.012) * 20 * dt
    }

    p.x += p.vx * dt
    p.y += p.vy * dt
    p.vx *= p.role === 'fog' ? 0.994 : 0.988
    p.vy *= p.role === 'fog' ? 0.994 : 0.988

    const a = clamp(1 - p.life / p.maxLife, 0, 1)
    const sz = p.size * (0.4 + a * 0.6)

    if (p.role === 'fog') {
      ctx.beginPath()
      ctx.fillStyle = stemColor(p.stem, a * 0.04)
      ctx.arc(p.x, p.y, sz * 2.2, 0, Math.PI * 2)
      ctx.fill()
    } else if (p.role === 'filament') {
      const tailH = sz * 7 * a
      ctx.fillStyle = stemColor(p.stem, a * 0.4)
      ctx.fillRect(p.x - sz * 0.3, p.y - tailH, sz * 0.6, tailH)
      ctx.save()
      ctx.shadowColor = STEM_COLORS[p.stem]
      ctx.shadowBlur = 8 + sz * 2
      ctx.beginPath()
      ctx.fillStyle = stemColor(p.stem, a * 0.75)
      ctx.arc(p.x, p.y, sz * 0.55, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    } else if (p.role === 'burst') {
      ctx.save()
      ctx.shadowColor = STEM_COLORS.drums
      ctx.shadowBlur = 10 + sz * 3
      ctx.beginPath()
      ctx.fillStyle = stemColor(p.stem, a * 0.9)
      ctx.arc(p.x, p.y, sz, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      ctx.beginPath()
      ctx.fillStyle = `rgba(255,255,255,${a * 0.55})`
      ctx.arc(p.x, p.y, sz * 0.25, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.save()
      ctx.shadowColor = STEM_COLORS[p.stem]
      ctx.shadowBlur = 8 + sz * 2
      ctx.beginPath()
      ctx.fillStyle = stemColor(p.stem, a * 0.75)
      ctx.arc(p.x, p.y, sz, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      ctx.beginPath()
      ctx.fillStyle = `rgba(255,255,255,${a * 0.35})`
      ctx.arc(p.x, p.y, sz * 0.3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
