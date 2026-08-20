/**
 * 分轨可视化 · 冲击2
 * 冲击的改进版：鼓=重锤（白闪+冲击波+镜头震动）、贝斯呼吸、星火粒子、暗角等骨架沿用「冲击」，
 * 人声改用四套可切换表达：金色声柱 / 平滑飘带 / 环形涟漪 / 粒子喷泉。
 */
import type { StemId } from '../stems/stems-types.ts'
import { STEM_COLORS } from '../stems/stems-types.ts'
import type { StemVizSample } from './music-stems-features.ts'
import { beatPulse, clamp, decay, meanEnergy, onsetPulse, rgb, rgbArr, withAlpha, MUSIC_ACCENT, paintBackground } from './music-stems-viz-math.ts'

export type Impact2VocalStyle = 'beam' | 'ribbon' | 'ripple' | 'fountain'

type Ripple = { life: number; maxLife: number; strength: number; kind: 'kick' | 'beat' | 'bass' | 'vocal' }
type P = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; color: string; fountain: boolean }
type Ribbon = { baseX: number; y: number; phase: number; life: number; maxLife: number; w: number; speed: number }

export type Impact2DrawState = {
  kickLevel: number
  zoomPunch: number
  shakeX: number
  shakeY: number
  ripples: Ripple[]
  particles: P[]
  ribbons: Ribbon[]
  prevBeat: number
  prevKick: number
  prevVocal: number
  time: number
  breathe: number
}

export function createImpact2DrawState(): Impact2DrawState {
  return {
    kickLevel: 0, zoomPunch: 0, shakeX: 0, shakeY: 0,
    ripples: [], particles: [], ribbons: [],
    prevBeat: 0, prevKick: 0, prevVocal: 0, time: 0, breathe: 0,
  }
}

export function drawStemImpact2(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sample: StemVizSample,
  dt: number,
  st: Impact2DrawState,
  vocalStyle: Impact2VocalStyle = 'beam',
): void {
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
      st.particles.push({ x: cx, y: cy, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, life: 0, maxLife: 0.3 + Math.random() * 0.5, size: 2 + kick * 4 + Math.random() * 2, color: Math.random() > 0.35 ? STEM_COLORS.drums : '#ffffff', fountain: false })
    }
  }
  st.prevKick = kick
  st.kickLevel = decay(st.kickLevel, kick * 0.5, dt, 9)
  st.zoomPunch *= Math.exp(-dt * 6)
  st.shakeX *= Math.exp(-dt * 10); st.shakeY *= Math.exp(-dt * 10)
  if (sample.beatPhase < st.prevBeat - 0.5) st.ripples.push({ life: 0, maxLife: 0.55, strength: 0.35 + mean * 0.5, kind: 'beat' })
  st.prevBeat = sample.beatPhase
  st.breathe += (bass - st.breathe) * Math.min(1, dt * 5)

  if (vocalStyle === 'ripple') {
    const rise = vocal - st.prevVocal
    if ((vocal > 0.32 && rise > 0.05) || (vocal > 0.6 && Math.random() < 0.2)) {
      st.ripples.push({ life: 0, maxLife: 0.85, strength: 0.32 + vocal * 0.5, kind: 'vocal' })
    }
  }
  st.prevVocal = vocal

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
    if (rp.kind === 'kick') { ctx.strokeStyle = rgb(255, 235, 240, a * 0.85); ctx.lineWidth = 3 + (1 - t) * 7 }
    else if (rp.kind === 'bass') { ctx.strokeStyle = withAlpha(STEM_COLORS.bass, a * 0.5); ctx.lineWidth = 1.5 + (1 - t) * 3 }
    else if (rp.kind === 'vocal') { ctx.strokeStyle = withAlpha(STEM_COLORS.vocals, a * 0.6); ctx.lineWidth = 1.2 + (1 - t) * 1.8 }
    else { ctx.strokeStyle = rgbArr(MUSIC_ACCENT, a * 0.6); ctx.lineWidth = 1.5 + (1 - t) * 3 }
    ctx.stroke()
  }

  if (vocalStyle === 'beam' && vocal > 0.03) drawVocalBeam(ctx, w, h, cx, vocal, pulse, st)
  if (vocalStyle === 'ribbon' && vocal > 0.05) spawnVocalRibbons(st, cx, w, h, vocal, pulse)
  if (vocalStyle === 'fountain' && vocal > 0.02) spawnVocalFountain(st, cx, w, h, vocal)

  for (let i = st.ribbons.length - 1; i >= 0; i--) {
    const rb = st.ribbons[i]!; rb.life += dt; rb.y -= rb.speed * dt
    if (rb.life >= rb.maxLife || rb.y < -40) { st.ribbons.splice(i, 1); continue }
    const a = clamp(1 - rb.life / rb.maxLife, 0, 1)
    const x = rb.baseX + Math.sin(st.time * 0.7 + rb.phase) * 26
    const baseY = h * 0.98
    const ctrlX = cx + Math.sin(st.time * 0.55 + rb.phase * 1.3) * 46
    const ctrlY = (rb.y + baseY) * 0.5 + Math.sin(st.time * 0.8 + rb.phase) * 16
    ctx.beginPath(); ctx.moveTo(rb.baseX, baseY)
    ctx.quadraticCurveTo(ctrlX, ctrlY, x, rb.y)
    ctx.strokeStyle = withAlpha(STEM_COLORS.vocals, a * (0.35 + vocal * 0.45))
    ctx.lineWidth = rb.w * (0.4 + a * 0.6); ctx.lineCap = 'round'; ctx.stroke()
    const headG = ctx.createRadialGradient(x, rb.y, 0, x, rb.y, rb.w * 3.4)
    headG.addColorStop(0, withAlpha(STEM_COLORS.vocals, a * 0.3)); headG.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = headG; ctx.fillRect(x - rb.w * 3.4, rb.y - rb.w * 3.4, rb.w * 6.8, rb.w * 6.8)
  }

  const sparkE = (guitar + piano) * 0.5
  if (sparkE > 0.06 && Math.random() < sparkE * 0.5 + pulse * 0.3) {
    const s: StemId = Math.random() > guitar / (guitar + piano + 1e-6) ? 'piano' : 'guitar'
    const ang = Math.random() * Math.PI * 2
    st.particles.push({ x: cx + Math.cos(ang) * Math.random() * Math.min(w, h) * 0.35, y: cy + Math.sin(ang) * Math.random() * Math.min(w, h) * 0.35, vx: (Math.random() - 0.5) * 70, vy: (Math.random() - 0.5) * 70, life: 0, maxLife: 0.25 + Math.random() * 0.4, size: 1.8 + sparkE * 3 + pulse * 2, color: STEM_COLORS[s], fountain: false })
  }
  if (drums > 0.1 && Math.random() < drums * 0.3) {
    const ang = Math.random() * Math.PI * 2
    st.particles.push({ x: cx + Math.cos(ang) * 25, y: cy + Math.sin(ang) * 25, vx: Math.cos(ang) * (70 + drums * 130), vy: Math.sin(ang) * (70 + drums * 130), life: 0, maxLife: 0.35, size: 1.5 + drums * 3, color: STEM_COLORS.drums, fountain: false })
  }

  while (st.particles.length > 220) st.particles.shift()
  for (let i = st.particles.length - 1; i >= 0; i--) {
    const p = st.particles[i]!; p.life += dt
    if (p.life >= p.maxLife) { st.particles.splice(i, 1); continue }
    if (p.fountain) {
      p.vy += 560 * dt; p.vx *= 0.992
    } else {
      if (bass > 0.05) { const dx = cx - p.x, dy = cy - p.y, dist = Math.max(50, Math.hypot(dx, dy)); const pull = (35 + bass * 130) / dist; p.vx += dx * pull * dt * 0.5; p.vy += dy * pull * dt * 0.5 }
      p.vx *= 0.97; p.vy *= 0.97
    }
    p.x += p.vx * dt; p.y += p.vy * dt
    const a = clamp(1 - p.life / p.maxLife, 0, 1), sz = p.size * (0.4 + a * 0.6)
    ctx.beginPath(); ctx.fillStyle = withAlpha(p.color, a * 0.9); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.fillStyle = `rgba(255,255,255,${a * 0.55})`; ctx.arc(p.x, p.y, sz * 0.3, 0, Math.PI * 2); ctx.fill()
  }

  ctx.restore()

  if (st.kickLevel > 0.1) { ctx.fillStyle = rgb(255, 240, 245, st.kickLevel * 0.35); ctx.fillRect(0, 0, w, h) }
  if (pulse > 0.35) { ctx.fillStyle = rgbArr(MUSIC_ACCENT, (pulse - 0.35) * 0.08); ctx.fillRect(0, 0, w, h) }
  const vig = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, Math.max(w, h) * 0.7)
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, `rgba(0,0,0,${0.3 - st.kickLevel * 0.1})`)
  ctx.fillStyle = vig; ctx.fillRect(0, 0, w, h)
}

/** 人声 · 金色声柱：底部中央向上的锥形光束，纯垂直，内部慢速流线，顶部光晕。 */
function drawVocalBeam(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, vocal: number, pulse: number, st: Impact2DrawState): void {
  const baseY = h * 0.98
  const bh = h * (0.18 + vocal * 0.52 + pulse * 0.08)
  const bw = w * (0.035 + vocal * 0.1 + pulse * 0.03)
  const topY = baseY - bh
  const grad = ctx.createLinearGradient(0, topY, 0, baseY)
  grad.addColorStop(0, 'rgba(255,216,77,0)')
  grad.addColorStop(0.55, withAlpha(STEM_COLORS.vocals, 0.28 + vocal * 0.5))
  grad.addColorStop(1, withAlpha(STEM_COLORS.vocals, 0.5 + vocal * 0.5))
  ctx.beginPath()
  ctx.moveTo(cx - bw * 2.2, baseY)
  ctx.quadraticCurveTo(cx - bw * 1.6, topY + bh * 0.45, cx - bw * 0.55, topY)
  ctx.lineTo(cx + bw * 0.55, topY)
  ctx.quadraticCurveTo(cx + bw * 1.6, topY + bh * 0.45, cx + bw * 2.2, baseY)
  ctx.closePath()
  ctx.fillStyle = grad; ctx.fill()
  ctx.lineCap = 'round'
  for (let k = 0; k < 3; k++) {
    const lx = cx + (k - 1) * bw * 0.9
    const sway = Math.sin(st.time * 0.9 + k * 1.7) * bw * 0.22
    ctx.beginPath()
    ctx.moveTo(lx + sway * 0.2, baseY)
    ctx.quadraticCurveTo(lx + sway * 1.4, baseY - bh * 0.5, lx + sway, baseY - bh * 0.96)
    ctx.strokeStyle = withAlpha(STEM_COLORS.vocals, 0.16 + vocal * 0.3)
    ctx.lineWidth = 1 + vocal * 2.4
    ctx.stroke()
  }
  const glowR = Math.max(30, bw * 3.4 + vocal * 60)
  const g = ctx.createRadialGradient(cx, topY, 0, cx, topY, glowR)
  g.addColorStop(0, withAlpha(STEM_COLORS.vocals, 0.2 + vocal * 0.34 + pulse * 0.12)); g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g; ctx.fillRect(cx - glowR, topY - glowR, glowR * 2, glowR * 2)
}

/** 人声 · 平滑飘带：从底部缓慢上升的大弧线，柔和扰动，头部柔光。 */
function spawnVocalRibbons(st: Impact2DrawState, cx: number, w: number, h: number, vocal: number, pulse: number): void {
  if (st.ribbons.length >= 3) return
  if (Math.random() > vocal * 0.4 + pulse * 0.15) return
  st.ribbons.push({
    baseX: cx + (Math.random() - 0.5) * w * 0.24,
    y: h * 0.95,
    phase: Math.random() * Math.PI * 2,
    life: 0,
    maxLife: 0.9 + vocal * 0.7,
    w: 2 + vocal * 3.5,
    speed: 90 + vocal * 190,
  })
}

/** 人声 · 粒子喷泉：从底部中央向上喷发的金色粒子流。 */
function spawnVocalFountain(st: Impact2DrawState, cx: number, w: number, h: number, vocal: number): void {
  if (Math.random() > vocal * 0.85 + 0.05) return
  st.particles.push({
    x: cx + (Math.random() - 0.5) * w * 0.05,
    y: h * 0.94,
    vx: (Math.random() - 0.5) * 46,
    vy: -(240 + vocal * 380) * (0.8 + Math.random() * 0.4),
    life: 0,
    maxLife: 0.5 + Math.random() * 0.6,
    size: 1.4 + vocal * 3 + Math.random() * 1.6,
    color: Math.random() > 0.4 ? STEM_COLORS.vocals : '#ffffff',
    fountain: true,
  })
}
