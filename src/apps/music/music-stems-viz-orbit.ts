/**
 * 分轨可视化 · 真3D Orbit
 * 简易透视 3D 太阳系
 */
import type { StemId } from '../stems/stems-types.ts'
import { STEM_COLORS, STEM_IDS } from '../stems/stems-types.ts'
import type { StemVizSample } from './music-stems-features.ts'
import { beatPulse, decay, meanEnergy, onsetPulse, rgbArr, stemColor, MUSIC_ACCENT } from './music-stems-viz-math.ts'

type Planet = { stemId: StemId; orbitR: number; speed: number; size: number; tilt: number; angle: number }
export type OrbitDrawState = { planets: Planet[]; kickLevel: number; time: number; shakeX: number; shakeY: number }
export function createOrbitDrawState(): OrbitDrawState {
  const defs: { stemId: StemId; orbitR: number; speed: number; size: number; tilt: number }[] = [
    { stemId: 'drums', orbitR: 0.08, speed: 1.8, size: 6, tilt: 0.1 },
    { stemId: 'bass', orbitR: 0.15, speed: 1.2, size: 8, tilt: 0.05 },
    { stemId: 'other', orbitR: 0.23, speed: 0.9, size: 5, tilt: 0.15 },
    { stemId: 'other2', orbitR: 0.3, speed: 0.75, size: 4, tilt: 0.2 },
    { stemId: 'guitar', orbitR: 0.38, speed: 0.6, size: 5.5, tilt: 0.12 },
    { stemId: 'piano', orbitR: 0.46, speed: 0.45, size: 5, tilt: 0.08 },
    { stemId: 'vocals', orbitR: 0.55, speed: 0.35, size: 7, tilt: 0.18 },
  ]
  return { planets: defs.map(d => ({ ...d, angle: Math.random() * Math.PI * 2 })), kickLevel: 0, time: 0, shakeX: 0, shakeY: 0 }
}

export function drawStemOrbit(ctx: CanvasRenderingContext2D, w: number, h: number, sample: StemVizSample, dt: number, st: OrbitDrawState): void {
  st.time += dt
  const mean = meanEnergy(sample), pulse = beatPulse(sample.beatPhase, 0.08, 2.2)
  const kick = onsetPulse(sample.drumsOnset, 0.08)
  const bass = sample.byStem.bass?.energy ?? 0, vocal = sample.byStem.vocals?.energy ?? 0
  st.kickLevel = decay(st.kickLevel, kick, dt, 7)
  if (kick > 0.3) { st.shakeX = (Math.random() - 0.5) * 8 * kick; st.shakeY = (Math.random() - 0.5) * 6 * kick }
  st.shakeX *= Math.exp(-dt * 12); st.shakeY *= Math.exp(-dt * 12)
  const cx = w / 2 + st.shakeX, cy = h / 2 + st.shakeY, maxR = Math.min(w, h) * 0.5
  const perspective = 600 + bass * 100, tiltX = 0.35 + bass * 0.1
  ctx.fillStyle = '#040310'; ctx.fillRect(0, 0, w, h)
  // stars
  for (let i = 0; i < 50; i++) { const hash = (127 * (i + 1) * 1307) % 10007; ctx.beginPath(); ctx.fillStyle = `rgba(255,255,255,${0.1 + Math.sin(st.time * 1.5 + i) * 0.08})`; ctx.arc(hash % w, (hash * 31) % h, 0.4 + (hash % 25) / 25, 0, Math.PI * 2); ctx.fill() }
  // star
  const starR = 18 + mean * 12 + pulse * 8 + st.kickLevel * 12
  const sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, starR * 3)
  sg.addColorStop(0, `rgba(255,245,230,${0.7 + pulse * 0.3})`)
  sg.addColorStop(0.2, rgbArr(MUSIC_ACCENT, 0.4 + mean * 0.3 + st.kickLevel * 0.2))
  sg.addColorStop(0.6, `rgba(180,60,100,${0.08 + mean * 0.1})`); sg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(cx, cy, starR * 3, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.fillStyle = 'rgba(255,250,245,0.9)'; ctx.arc(cx, cy, starR * 0.4, 0, Math.PI * 2); ctx.fill()
  // planets
  for (const planet of st.planets) {
    const e = sample.byStem[planet.stemId]?.energy ?? 0
    const hex = STEM_COLORS[planet.stemId], rgbM = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
    const rgb: [number, number, number] = rgbM ? [parseInt(rgbM[1]!, 16), parseInt(rgbM[2]!, 16), parseInt(rgbM[3]!, 16)] : [200, 200, 200]
    const orbitRadius = maxR * planet.orbitR * (0.85 + e * 0.3 + pulse * 0.03)
    planet.angle += dt * planet.speed * (0.5 + e * 1.5 + st.kickLevel * 0.8) * (0.3 + sample.bpm / 300)
    const px3d = Math.cos(planet.angle) * orbitRadius, py3d = Math.sin(planet.angle) * orbitRadius * tiltX
    const depth = perspective / (perspective + Math.sin(planet.angle) * orbitRadius * 0.15)
    const sx = cx + px3d * depth, sy = cy + py3d * depth
    const sz = (planet.size * (0.7 + e * 0.8) + pulse * 2 + st.kickLevel * 1.5) * depth
    const lit = 0.5 + e * 0.5 + st.kickLevel * 0.3
    ctx.beginPath(); ctx.ellipse(cx, cy, orbitRadius, orbitRadius * tiltX, 0, 0, Math.PI * 2)
    ctx.strokeStyle = stemColor(planet.stemId, 0.08 + e * 0.15); ctx.lineWidth = 0.6 + e * 1.2; ctx.stroke()
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, sz * 3)
    glow.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.15 + e * 0.2})`); glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sx, sy, sz * 3, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(sx, sy, sz, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${rgb[0] * lit | 0},${rgb[1] * lit | 0},${rgb[2] * lit | 0},${0.7 + e * 0.3})`; ctx.fill()
    ctx.beginPath(); ctx.arc(sx - sz * 0.25, sy - sz * 0.25, sz * 0.5, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255,255,255,${0.2 + e * 0.4 + pulse * 0.15})`; ctx.fill()
  }
  if (vocal > 0.06) {
    const ringR = maxR * 0.65 * (0.9 + vocal * 0.12 + pulse * 0.03)
    ctx.beginPath(); ctx.ellipse(cx, cy, ringR, ringR * tiltX, 0, 0, Math.PI * 2)
    ctx.strokeStyle = stemColor('vocals', 0.1 + vocal * 0.3 + pulse * 0.08); ctx.lineWidth = 1.2 + vocal * 2.5; ctx.stroke()
  }
  if (st.kickLevel > 0.1) { ctx.fillStyle = `rgba(255,240,245,${st.kickLevel * 0.2})`; ctx.fillRect(0, 0, w, h) }
}
