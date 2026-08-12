/**
 * 分轨可视化 · 冲击
 * 鼓=重锤：全屏白闪+冲击波+镜头震动。贝斯呼吸。人声丝带。
 */
import type { StemId } from '../stems/stems-types.ts'
import { STEM_COLORS } from '../stems/stems-types.ts'
import type { StemVizSample } from './music-stems-features.ts'
import { beatPulse, beatWave, clamp, decay, meanEnergy, onsetPulse, rgb, rgbArr, stemColor, withAlpha, MUSIC_ACCENT, paintBackground } from './music-stems-viz-math.ts'

type Ripple = { life: number; maxLife: number; strength: number; kind: 'kick' | 'beat' | 'bass' }
type P = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; color: string }
type Trail = { x: number; y: number; angle: number; life: number; maxLife: number; w: number }
export type ImpactDrawState = {
  kickLevel: number; zoomPunch: number; shakeX: number; shakeY: number
  ripples: Ripple[]; particles: P[]; trails: Trail[]
  prevBeat: number; prevKick: number; time: number; breathe: number
}
export function createImpactDrawState(): ImpactDrawState {
  return { kickLevel: 0, zoomPunch: 0, shakeX: 0, shakeY: 0, ripples: [], particles: [], trails: [], prevBeat: 0, prevKick: 0, time: 0, breathe: 0 }
}

export function drawStemImpact(ctx: CanvasRenderingContext2D, w: number, h: number, sample: StemVizSample, dt: number, st: ImpactDrawState): void {
  st.time += dt
  const cx = w * 0.5, cy = h * 0.52
  const mean = meanEnergy(sample)
  const pulse = beatPulse(sample.beatPhase, 0.08, 2.2)
  const kick = onsetPulse(sample.drumsOnset, 0.08)
  const bass = sample.byStem.bass?.energy ?? 0
  const vocal = sample.byStem.vocals?.energy ?? 0
  const drums = sample.byStem.drums?.energy ?? 0
  const other = ((sample.byStem.other?.energy ?? 0) + (sample.byStem.other2?.energy ?? 0)) * 0.5
  const guitar = sample.byStem.guitar?.energy ?? 0
  const piano = sample.byStem.piano?.energy ?? 0

  if (kick > 0.3 && kick > st.prevKick + 0.03) {
    st.kickLevel = Math.max(st.kickLevel, kick)
    st.zoomPunch = Math.max(st.zoomPunch, kick * 0.9)
    st.shakeX = (Math.random() - 0.5) * 16 * kick
    st.shakeY = (Math.random() - 0.5) * 12 * kick
    st.ripples.push({ life: 0, maxLife: 0.7, strength: 0.7 + kick * 0.6, kind: 'kick' })
    const n = Math.min(80, Math.round(20 + kick * 35))
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2, speed = 140 + kick * 450
      st.particles.push({ x: cx, y: cy, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, life: 0, maxLife: 0.3 + Math.random() * 0.5, size: 2 + kick * 4 + Math.random() * 2, color: Math.random() > 0.35 ? STEM_COLORS.drums : '#ffffff' })
    }
  }
  st.prevKick = kick
  st.kickLevel = decay(st.kickLevel, kick * 0.5, dt, 9)
  st.zoomPunch *= Math.exp(-dt * 6)
  st.shakeX *= Math.exp(-dt * 10); st.shakeY *= Math.exp(-dt * 10)
  if (sample.beatPhase < st.prevBeat - 0.5) st.ripples.push({ life: 0, maxLife: 0.55, strength: 0.35 + mean * 0.5, kind: 'beat' })
  st.prevBeat = sample.beatPhase
  st.breathe += (bass - st.breathe) * Math.min(1, dt * 5)

  paintBackground(ctx, w, h, mean, pulse, kick)
  const zoom = 1 + st.zoomPunch * 0.1 + st.breathe * 0.03 + pulse * 0.025
  ctx.save()
  ctx.translate(cx + st.shakeX * (0.5 + st.kickLevel), cy + st.shakeY * (0.5 + st.kickLevel))
  ctx.scale(zoom, zoom); ctx.translate(-cx, -cy)

  if (other > 0.04) {
    const nebR = Math.max(w, h) * (0.3 + other * 0.4)
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, nebR)
    g.addColorStop(0, rgb(100, 60, 140, 0.08 + other * 0.15)); g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g; ctx.fillRect(cx - nebR, cy - nebR, nebR * 2, nebR * 2)
  }
  if (bass > 0.03) {
    const r = 45 + bass * 120 + pulse * 25 + st.breathe * 35
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, withAlpha(STEM_COLORS.bass, 0.25 + bass * 0.45 + pulse * 0.15))
    g.addColorStop(0.5, withAlpha(STEM_COLORS.bass, 0.08 + bass * 0.12)); g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  }

  for (let i = st.ripples.length - 1; i >= 0; i--) {
    const rp = st.ripples[i]!; rp.life += dt
    if (rp.life >= rp.maxLife) { st.ripples.splice(i, 1); continue }
    const t = rp.life / rp.maxLife, a = (1 - t) * rp.strength, rad = Math.min(w, h) * (0.05 + t * 0.75)
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2)
    ctx.strokeStyle = rp.kind === 'kick' ? rgb(255, 235, 240, a * 0.85) : rp.kind === 'bass' ? withAlpha(STEM_COLORS.bass, a * 0.5) : rgbArr(MUSIC_ACCENT, a * 0.6)
    ctx.lineWidth = rp.kind === 'kick' ? 3 + (1 - t) * 7 : 1.5 + (1 - t) * 3; ctx.stroke()
  }

  const sparkE = (guitar + piano) * 0.5
  if (sparkE > 0.06 && Math.random() < sparkE * 0.5 + pulse * 0.3) {
    const s: StemId = Math.random() > guitar / (guitar + piano + 1e-6) ? 'piano' : 'guitar'
    const ang = Math.random() * Math.PI * 2
    st.particles.push({ x: cx + Math.cos(ang) * Math.random() * Math.min(w, h) * 0.35, y: cy + Math.sin(ang) * Math.random() * Math.min(w, h) * 0.35, vx: (Math.random() - 0.5) * 70, vy: (Math.random() - 0.5) * 70, life: 0, maxLife: 0.25 + Math.random() * 0.4, size: 1.8 + sparkE * 3 + pulse * 2, color: STEM_COLORS[s] })
  }
  if (drums > 0.1 && Math.random() < drums * 0.3) {
    const ang = Math.random() * Math.PI * 2
    st.particles.push({ x: cx + Math.cos(ang) * 25, y: cy + Math.sin(ang) * 25, vx: Math.cos(ang) * (70 + drums * 130), vy: Math.sin(ang) * (70 + drums * 130), life: 0, maxLife: 0.35, size: 1.5 + drums * 3, color: STEM_COLORS.drums })
  }
  if (vocal > 0.05 && st.trails.length < 12 && Math.random() < vocal * 0.5 + pulse * 0.2) {
    st.trails.push({ x: cx + (Math.random() - 0.5) * w * 0.3, y: h * 0.75, angle: Math.random() * Math.PI * 2, life: 0, maxLife: 0.8 + vocal, w: 2.5 + vocal * 5 })
  }

  while (st.particles.length > 150) st.particles.shift()
  for (let i = st.particles.length - 1; i >= 0; i--) {
    const p = st.particles[i]!; p.life += dt
    if (p.life >= p.maxLife) { st.particles.splice(i, 1); continue }
    if (bass > 0.05) { const dx = cx - p.x, dy = cy - p.y, dist = Math.max(50, Math.hypot(dx, dy)); const pull = (35 + bass * 130) / dist; p.vx += dx * pull * dt * 0.5; p.vy += dy * pull * dt * 0.5 }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy *= 0.97
    const a = clamp(1 - p.life / p.maxLife, 0, 1), sz = p.size * (0.4 + a * 0.6)
    ctx.beginPath(); ctx.fillStyle = withAlpha(p.color, a * 0.9); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.fillStyle = `rgba(255,255,255,${a * 0.55})`; ctx.arc(p.x, p.y, sz * 0.3, 0, Math.PI * 2); ctx.fill()
  }

  for (let i = st.trails.length - 1; i >= 0; i--) {
    const tr = st.trails[i]!; tr.life += dt
    if (tr.life >= tr.maxLife) { st.trails.splice(i, 1); continue }
    tr.y -= (100 + vocal * 200) * dt; tr.angle += dt * 3; tr.x += Math.sin(tr.angle) * 45 * dt
    const a = clamp(1 - tr.life / tr.maxLife, 0, 1), seg = 35 + vocal * 65
    ctx.beginPath(); ctx.moveTo(tr.x, tr.y)
    ctx.quadraticCurveTo(tr.x + Math.sin(tr.angle) * seg * 0.5, tr.y - seg * 0.5, tr.x + Math.sin(tr.angle * 1.3) * seg, tr.y - seg)
    ctx.strokeStyle = stemColor('vocals', a * (0.4 + vocal * 0.55)); ctx.lineWidth = tr.w * (0.5 + a * 0.5); ctx.lineCap = 'round'; ctx.stroke()
    ctx.beginPath(); ctx.fillStyle = `rgba(255,255,255,${a * 0.6})`; ctx.arc(tr.x + Math.sin(tr.angle * 1.3) * seg, tr.y - seg, 1.8 + vocal * 2, 0, Math.PI * 2); ctx.fill()
  }

  ctx.restore()

  if (st.kickLevel > 0.1) { ctx.fillStyle = rgb(255, 240, 245, st.kickLevel * 0.35); ctx.fillRect(0, 0, w, h) }
  if (pulse > 0.35) { ctx.fillStyle = rgbArr(MUSIC_ACCENT, (pulse - 0.35) * 0.08); ctx.fillRect(0, 0, w, h) }
  const vig = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, Math.max(w, h) * 0.7)
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, `rgba(0,0,0,${0.3 - st.kickLevel * 0.1})`)
  ctx.fillStyle = vig; ctx.fillRect(0, 0, w, h)
}
