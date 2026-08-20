import { useEffect, useRef } from 'preact/hooks'
import { getMusicAnalyser, getMusicPlayerState } from './music-player.ts'
import { accentTriadRgb, bandEnergy } from './music-visualizer-math.ts'

type MusicAmbientBackdropProps = {
  className?: string
}

const FREQ_BIN_COUNT = 256
const PARTICLE_COUNT = 26

/** 确定性伪随机（按粒子下标） */
function hash01(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function rgba(rgb: [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}

type Blob = {
  /** 水平/垂直漂移速度与相位 */
  speedX: number
  speedY: number
  phase: number
  /** 基础半径（相对 min(w,h)） */
  radius: number
  alpha: number
}

const BLOBS: Blob[] = [
  { speedX: 0.11, speedY: 0.07, phase: 0, radius: 0.42, alpha: 0.5 },
  { speedX: 0.07, speedY: 0.1, phase: 2.2, radius: 0.36, alpha: 0.42 },
  { speedX: 0.09, speedY: 0.06, phase: 4.4, radius: 0.3, alpha: 0.38 },
]

/**
 * 氛围背景：三团随频段能量呼吸的彩色光斑（加色混合）+ 缓慢上浮的微光粒子。
 * 无播放时以待机能量缓慢起伏；canvas 绝对定位铺满宿主，不参与布局。
 */
export function MusicAmbientBackdrop({ className }: MusicAmbientBackdropProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }
    let colors: [number, number, number][] = [
      [250, 45, 85],
      [80, 120, 255],
      [255, 150, 90],
    ]
    try {
      const accent = getComputedStyle(host).getPropertyValue('--music-accent').trim()
      if (accent) {
        colors = accentTriadRgb(accent)
      }
    } catch {
      // 保留默认配色
    }

    let cssWidth = 0
    let cssHeight = 0
    const syncSize = () => {
      const rect = host.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      cssWidth = Math.max(0, rect.width)
      cssHeight = Math.max(0, rect.height)
      const pixelWidth = Math.max(1, Math.min(4096, Math.round(cssWidth * dpr)))
      const pixelHeight = Math.max(1, Math.min(4096, Math.round(cssHeight * dpr)))
      if (canvas.width !== pixelWidth) {
        canvas.width = pixelWidth
      }
      if (canvas.height !== pixelHeight) {
        canvas.height = pixelHeight
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const observer = new ResizeObserver(syncSize)
    observer.observe(host)
    syncSize()

    const freq = new Uint8Array(FREQ_BIN_COUNT)
    const energies = [0.15, 0.15, 0.15]
    let time = 0
    let lastTs = 0
    let rafId = 0

    const tick = (ts: number) => {
      rafId = requestAnimationFrame(tick)
      const dt = lastTs > 0 ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016
      lastTs = ts
      time += dt
      const w = cssWidth
      const h = cssHeight
      if (w < 2 || h < 2) {
        return
      }

      const analyser = getMusicAnalyser()
      const live = Boolean(analyser && getMusicPlayerState().isPlaying)
      const targets = live && analyser ? readBandTargets(analyser, freq) : idleTargets(time)
      for (let i = 0; i < 3; i += 1) {
        const t = targets[i]
        energies[i] = t > energies[i] ? energies[i] + (t - energies[i]) * 0.4 : energies[i] * 0.94 + t * 0.06
      }

      ctx.clearRect(0, 0, w, h)
      const unit = Math.min(w, h)

      // 光斑（加色混合，互相交叠出渐层）
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < BLOBS.length; i += 1) {
        const blob = BLOBS[i]
        const energy = energies[i]
        const bx = w * (0.5 + 0.32 * Math.cos(time * blob.speedX * 6 + blob.phase))
        const by = h * (0.46 + 0.3 * Math.sin(time * blob.speedY * 6 + blob.phase * 1.7))
        const radius = unit * blob.radius * (0.75 + energy * 0.7)
        if (radius < 2) {
          continue
        }
        const gradient = ctx.createRadialGradient(bx, by, 0, bx, by, radius)
        gradient.addColorStop(0, rgba(colors[i], blob.alpha * (0.35 + energy * 0.65)))
        gradient.addColorStop(1, rgba(colors[i], 0))
        ctx.fillStyle = gradient
        ctx.fillRect(bx - radius, by - radius, radius * 2, radius * 2)
      }

      // 微光粒子（缓慢上浮 + 闪烁）
      for (let i = 0; i < PARTICLE_COUNT; i += 1) {
        const px = hash01(i) * w
        const drift = 0.02 + hash01(i + 100) * 0.05
        const py = h * (1 - (hash01(i + 200) + time * drift) % 1)
        const twinkle = 0.5 + 0.5 * Math.sin(time * (1.2 + hash01(i + 300)) + i)
        const radius = 0.8 + hash01(i + 400) * 1.6
        ctx.beginPath()
        ctx.arc(px, py, radius, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255, 255, 255, ${(0.05 + 0.16 * twinkle).toFixed(3)})`
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'

      // 边缘压暗（vignette）
      const vignette = ctx.createRadialGradient(
        w / 2,
        h / 2,
        Math.min(w, h) * 0.42,
        w / 2,
        h / 2,
        Math.max(w, h) * 0.75,
      )
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.38)')
      ctx.fillStyle = vignette
      ctx.fillRect(0, 0, w, h)
    }
    rafId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [])

  return (
    <div
      ref={hostRef}
      class={`music__ambient-backdrop${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} class="music__ambient-backdrop-canvas" />
    </div>
  )
}

function readBandTargets(
  analyser: AnalyserNode,
  freq: Uint8Array<ArrayBuffer>,
): [number, number, number] {
  analyser.getByteFrequencyData(freq)
  return [
    bandEnergy(freq, 0.01, 0.1),
    bandEnergy(freq, 0.1, 0.4),
    bandEnergy(freq, 0.4, 0.85),
  ]
}

function idleTargets(time: number): [number, number, number] {
  return [
    0.16 + 0.08 * Math.sin(time * 0.6),
    0.14 + 0.08 * Math.sin(time * 0.45 + 2),
    0.12 + 0.07 * Math.sin(time * 0.5 + 4),
  ]
}
