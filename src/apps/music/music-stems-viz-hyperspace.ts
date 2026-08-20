/**
 * 分轨可视化 · 穿梭
 * 星场光速跳跃：粒子星从中心喷射，kick 加速+闪白。
 */
import { STEM_COLORS, STEM_IDS } from '../stems/stems-types.ts'
import type { StemVizSample } from './music-stems-features.ts'
import { beatPulse, clamp, decay, meanEnergy, onsetPulse, rgbArr, stemColor, withAlpha, MUSIC_ACCENT } from './music-stems-viz-math.ts'

type Star = { x: number; y: number; z: number; color: string; bright: number; trailColor: string }
export type HyperspaceDrawState = { stars: Star[]; kickLevel: number; time: number; speed: number }
export function createHyperspaceDrawState(): HyperspaceDrawState { return { stars: [], kickLevel: 0, time: 0, speed: 0.4 } }

function initStar(s: Star): void {
  s.x = (Math.random() - 0.5) * 2; s.y = (Math.random() - 0.5) * 2; s.z = 0.02 + Math.random() * 0.98
  const id = STEM_IDS[Math.floor(Math.random() * STEM_IDS.length)]!
  s.color = STEM_COLORS[id]; s.trailColor = STEM_COLORS[id]; s.bright = 0.4 + Math.random() * 0.6
}

export function drawStemHyperspace(ctx: CanvasRenderingContext2D, w: number, h: number, sample: StemVizSample, dt: number, st: HyperspaceDrawState): void {
  st.time += dt; const cx = w / 2, cy = h / 2
  const mean = meanEnergy(sample), pulse = beatPulse(sample.beatPhase, 0.08, 2.2)
  const kick = onsetPulse(sample.drumsOnset, 0.08)
  const bass = sample.byStem.bass?.energy ?? 0, vocal = sample.byStem.vocals?.energy ?? 0, drums = sample.byStem.drums?.energy ?? 0
  st.kickLevel = decay(st.kickLevel, kick, dt, 7)
  const targetSpeed = 0.35 + mean * 0.6 + drums * 0.5 + st.kickLevel * 3
  st.speed += (targetSpeed - st.speed) * Math.min(1, dt * 4)
  ctx.fillStyle = `rgba(3,3,8,${0.2 + (1 - mean) * 0.15})`; ctx.fillRect(0, 0, w, h)
  while (st.stars.length < 260) { const s = {} as Star; initStar(s); st.stars.push(s) }
  const fov = 200 + bass * 60
  for (let i = st.stars.length - 1; i >= 0; i--) {
    const s = st.stars[i]!
    s.z -= dt * st.speed * (2 + st.kickLevel * 4)
    if (s.z <= 0.005) { initStar(s); s.z = 1; continue }
    const sx = cx + (s.x / s.z) * fov, sy = cy + (s.y / s.z) * fov
    if (sx < -50 || sx > w + 50 || sy < -50 || sy > h + 50) continue
    const size = clamp((1 - s.z) * 4 * (1 + pulse * 0.5 + st.kickLevel * 0.8), 0.3, 10)
    const alpha = clamp((1 - s.z) * s.bright * (0.6 + st.kickLevel * 0.4), 0.1, 1)
    // trail using star's own color
    if (s.z < 0.5) {
      const prevZ = s.z + dt * st.speed * 3
      if (prevZ > 0.005) {
        const px = cx + (s.x / prevZ) * fov, py = cy + (s.y / prevZ) * fov
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(sx, sy)
        ctx.strokeStyle = withAlpha(s.trailColor, alpha * 0.5); ctx.lineWidth = size * 0.4; ctx.stroke()
      }
    }
    ctx.beginPath(); ctx.fillStyle = withAlpha(s.color, alpha); ctx.arc(sx, sy, size, 0, Math.PI * 2); ctx.fill()
    if (alpha > 0.5 && size > 1.5) { ctx.beginPath(); ctx.fillStyle = `rgba(255,255,255,${alpha * 0.6})`; ctx.arc(sx, sy, size * 0.3, 0, Math.PI * 2); ctx.fill() }
  }
  const glowR = 40 + st.kickLevel * 80 + pulse * 30 + bass * 20
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR)
  glow.addColorStop(0, rgbArr(MUSIC_ACCENT, 0.2 + st.kickLevel * 0.35))
  glow.addColorStop(0.4, `rgba(120,60,200,${0.1 + mean * 0.15})`); glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, glowR, 0, Math.PI * 2); ctx.fill()
  if (vocal > 0.06) {
    const spokes = 4 + Math.round(vocal * 8)
    for (let s = 0; s < spokes; s++) { const a = (s / spokes) * Math.PI * 2 + st.time * 0.5, len = 80 + vocal * 200; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); ctx.strokeStyle = stemColor('vocals', 0.06 + vocal * 0.2); ctx.lineWidth = 0.5 + vocal * 1.5; ctx.stroke() }
  }
  if (st.kickLevel > 0.1) { ctx.fillStyle = `rgba(255,240,245,${st.kickLevel * 0.25})`; ctx.fillRect(0, 0, w, h) }
}
