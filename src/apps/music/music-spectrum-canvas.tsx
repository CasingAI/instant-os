import { useEffect, useRef } from 'preact/hooks'
import { getMusicAnalyser, getMusicCurrentTimeMs, getMusicPlayerState } from './music-player.ts'
import {
  bandEnergy,
  computeBarHeights,
  computeIdleLevels,
  computeIdleWave,
  computePeaks,
  computeWavePoints,
  smoothLevels,
  withAlpha,
} from './music-visualizer-math.ts'

export type MusicSpectrumMode = 'bars' | 'wave' | 'ring'

type MusicSpectrumCanvasProps = {
  mode: MusicSpectrumMode
  className?: string
  /** bars/ring 模式柱子数量；缺省按画布宽度自适应 */
  barCount?: number
}

const DEFAULT_ACCENT = '#fa2d55'
/** 与分析器 fftSize=512 对应的数组长度 */
const FREQ_BIN_COUNT = 256
const TIME_SAMPLE_COUNT = 512

function resolveAccentColor(el: HTMLElement): string {
  try {
    const value = getComputedStyle(el).getPropertyValue('--music-accent').trim()
    return value || DEFAULT_ACCENT
  } catch {
    return DEFAULT_ACCENT
  }
}

/** 跨帧绘制状态（平滑电平 / 峰值 / 波形 / 低频能量 / 时间轴） */
type DrawState = {
  levels: number[]
  peaks: number[]
  wave: number[]
  bass: number
  time: number
}

function smoothBass(prev: number, next: number): number {
  return next > prev ? prev + (next - prev) * 0.5 : prev * 0.92 + next * 0.08
}

/** 顶部圆角柱形路径 */
function traceTopRoundedBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height)
  ctx.beginPath()
  ctx.moveTo(x, y + height)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.lineTo(x + width - r, y)
  ctx.arcTo(x + width, y, x + width, y + r, r)
  ctx.lineTo(x + width, y + height)
  ctx.closePath()
}

/** 柱状：自适应柱数 + 渐变柱身 + 峰值帽 + 倒影 + 低频呼吸光晕 */
function drawBars(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  freq: Uint8Array | undefined,
  accent: string,
  barCountProp: number | undefined,
  st: DrawState,
): void {
  const count =
    barCountProp ?? Math.max(16, Math.min(120, Math.round(w / 14)))
  const targets = freq ? computeBarHeights(freq, count) : computeIdleLevels(count, st.time)
  st.levels = smoothLevels(st.levels, targets, 0.62, 0.86)
  st.peaks = computePeaks(st.peaks, st.levels, 0.007)
  st.bass = smoothBass(st.bass, freq ? bandEnergy(freq, 0.01, 0.1) : 0.12)

  const compact = h < 60 // 迷你尺寸（播放器栏）只画柱身
  const baseline = compact ? h : h * 0.88
  const maxH = compact ? h : h * 0.74
  const gap = Math.max(1.5, Math.min(6, (w / count) * 0.32))
  const barWidth = Math.max(1, (w - gap * (count - 1)) / count)
  const radius = Math.min(barWidth / 2, 3)

  if (!compact) {
    // 低频呼吸光晕
    const glowRadius = Math.max(w, h) * 0.55
    const glow = ctx.createRadialGradient(w / 2, baseline, 0, w / 2, baseline, glowRadius)
    glow.addColorStop(0, withAlpha(accent, 0.22 * st.bass))
    glow.addColorStop(1, withAlpha(accent, 0))
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, w, h)
  }

  const body = ctx.createLinearGradient(0, baseline, 0, baseline - maxH)
  body.addColorStop(0, withAlpha(accent, 0.55))
  body.addColorStop(0.7, accent)
  body.addColorStop(1, '#ffffff')

  for (let i = 0; i < count; i += 1) {
    const v = st.levels[i] ?? 0
    const barHeight = Math.max(2, v * maxH)
    const x = i * (barWidth + gap)
    ctx.fillStyle = body
    traceTopRoundedBar(ctx, x, baseline - barHeight, barWidth, barHeight, radius)
    ctx.fill()

    if (compact) {
      continue
    }
    // 峰值帽（高于柱身时显示，缓慢下落）
    const peakHeight = (st.peaks[i] ?? 0) * maxH
    if (peakHeight > barHeight + 5) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
      traceTopRoundedBar(ctx, x, baseline - peakHeight - 3, barWidth, 2.5, 1.2)
      ctx.fill()
    }
    // 倒影（向下渐隐）
    const refl = Math.min(barHeight * 0.55, h - baseline - 4)
    if (refl > 2) {
      const fade = ctx.createLinearGradient(0, baseline + 2, 0, baseline + 2 + refl)
      fade.addColorStop(0, withAlpha(accent, 0.16))
      fade.addColorStop(1, withAlpha(accent, 0))
      ctx.fillStyle = fade
      ctx.fillRect(x, baseline + 2, barWidth, refl)
    }
  }
}

/** 波形：三层丝带（辉光/次层/亮芯）+ 主线下方面积渐变，两端收窄 */
function drawWave(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  timeData: Uint8Array | undefined,
  accent: string,
  st: DrawState,
): void {
  const count = Math.max(64, Math.min(220, Math.round(w / 7)))
  const targets = timeData ? computeWavePoints(timeData, count) : computeIdleWave(count, st.time)
  if (st.wave.length !== count) {
    st.wave = targets.slice()
  } else {
    for (let i = 0; i < count; i += 1) {
      st.wave[i] += (targets[i] - st.wave[i]) * 0.55
    }
  }

  const cy = h / 2
  const amp = h * 0.34
  const yAt = (i: number): number => {
    // 端点收窄窗：波形两端向中线收拢，呈丝带形
    const x = i / (count - 1)
    const taper = Math.pow(Math.sin(Math.PI * x), 0.65)
    return cy - st.wave[i] * amp * taper
  }

  // 主线下的面积渐变
  const area = ctx.createLinearGradient(0, cy - amp, 0, cy + amp)
  area.addColorStop(0, withAlpha(accent, 0))
  area.addColorStop(0.5, withAlpha(accent, 0.16))
  area.addColorStop(1, withAlpha(accent, 0))
  ctx.beginPath()
  ctx.moveTo(0, yAt(0))
  for (let i = 1; i < count; i += 1) {
    ctx.lineTo((i / (count - 1)) * w, yAt(i))
  }
  ctx.lineTo(w, cy)
  ctx.lineTo(0, cy)
  ctx.closePath()
  ctx.fillStyle = area
  ctx.fill()

  const layers = [
    { width: Math.max(4, h * 0.11), alpha: 0.07, scale: 1.22, shift: w * 0.012 },
    { width: Math.max(2.5, h * 0.05), alpha: 0.18, scale: 1.08, shift: w * 0.006 },
    { width: Math.max(1.6, h * 0.012), alpha: 0.95, scale: 1, shift: 0 },
  ]
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (const layer of layers) {
    ctx.beginPath()
    for (let i = 0; i < count; i += 1) {
      const x = (i / (count - 1)) * w + layer.shift
      const y = cy - (cy - yAt(i)) * layer.scale
      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.strokeStyle = withAlpha(accent, layer.alpha)
    ctx.lineWidth = layer.width
    ctx.stroke()
  }
}

/** 环形：放射频谱柱 + 低频脉冲中心盘 + 播放进度环，整体缓慢旋转 */
function drawRing(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  freq: Uint8Array | undefined,
  accent: string,
  barCountProp: number | undefined,
  st: DrawState,
): void {
  const cx = w / 2
  const cy = h / 2
  const unit = Math.min(w, h)
  const baseRadius = unit * 0.21
  const maxLen = unit * 0.24
  const count =
    barCountProp ?? Math.max(48, Math.min(128, Math.round((Math.PI * 2 * baseRadius) / 9)))

  const targets = freq ? computeBarHeights(freq, count) : computeIdleLevels(count, st.time)
  st.levels = smoothLevels(st.levels, targets, 0.55, 0.87)
  st.bass = smoothBass(st.bass, freq ? bandEnergy(freq, 0.01, 0.1) : 0.12)

  const rotation = st.time * 0.15

  // 低频光晕
  const haloRadius = baseRadius * (1.9 + st.bass * 0.8)
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloRadius)
  halo.addColorStop(0, withAlpha(accent, 0.3 * (0.4 + st.bass)))
  halo.addColorStop(1, withAlpha(accent, 0))
  ctx.fillStyle = halo
  ctx.fillRect(cx - haloRadius, cy - haloRadius, haloRadius * 2, haloRadius * 2)

  // 放射柱（旋转；柱尖叠一段亮色）
  const barWidth = ((Math.PI * 2 * baseRadius) / count) * 0.52
  ctx.lineCap = 'round'
  for (let i = 0; i < count; i += 1) {
    const v = st.levels[i] ?? 0
    const angle = rotation + (i / count) * Math.PI * 2 - Math.PI / 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const inner = baseRadius + unit * 0.012
    const outer = inner + Math.max(unit * 0.008, v * maxLen)
    ctx.beginPath()
    ctx.moveTo(cx + cos * inner, cy + sin * inner)
    ctx.lineTo(cx + cos * outer, cy + sin * outer)
    ctx.strokeStyle = withAlpha(accent, 0.4 + 0.6 * v)
    ctx.lineWidth = barWidth
    ctx.stroke()
    if (v > 0.45) {
      const tipInner = outer - Math.min(v * maxLen * 0.35, unit * 0.03)
      ctx.beginPath()
      ctx.moveTo(cx + cos * tipInner, cy + sin * tipInner)
      ctx.lineTo(cx + cos * outer, cy + sin * outer)
      ctx.strokeStyle = `rgba(255, 255, 255, ${Math.min(0.9, (v - 0.45) * 1.6)})`
      ctx.lineWidth = barWidth * 0.6
      ctx.stroke()
    }
  }

  // 基圆刻度环
  ctx.beginPath()
  ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2)
  ctx.strokeStyle = withAlpha(accent, 0.14)
  ctx.lineWidth = 1
  ctx.stroke()

  // 中心盘（随低频脉冲）
  const discRadius = baseRadius * (0.62 + st.bass * 0.22)
  const disc = ctx.createRadialGradient(
    cx,
    cy - discRadius * 0.4,
    discRadius * 0.1,
    cx,
    cy,
    discRadius,
  )
  disc.addColorStop(0, withAlpha(accent, 1))
  disc.addColorStop(1, withAlpha(accent, 0.72))
  ctx.beginPath()
  ctx.arc(cx, cy, discRadius, 0, Math.PI * 2)
  ctx.fillStyle = disc
  ctx.fill()

  // 进度环（有播放时长时）
  const { duration } = getMusicPlayerState()
  if (duration > 0) {
    const progress = Math.min(1, getMusicCurrentTimeMs() / 1000 / duration)
    const ringRadius = discRadius + Math.max(4, unit * 0.014)
    ctx.beginPath()
    ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)'
    ctx.lineWidth = Math.max(1.5, unit * 0.006)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy, ringRadius, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.stroke()
  }

  // 中心音符
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
  ctx.font = `${Math.round(discRadius * 0.9)}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('♪', cx, cy + discRadius * 0.06)
}

/**
 * 通用 Canvas 频谱组件：从播放器 AnalyserNode 实时取数据，rAF 绘制。
 * mode=bars 柱状 / wave 波形 / ring 环形；无播放或分析器不可用时画待机呼吸动画。
 * 尺寸契约：宿主元素由 CSS 给定确定尺寸，canvas 绝对定位铺满（不参与布局，
 * 避免尺寸反馈）；绘制按 devicePixelRatio 放大并 setTransform，随画面等比缩放。
 */
export function MusicSpectrumCanvas({
  mode,
  className,
  barCount,
}: MusicSpectrumCanvasProps) {
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
    const accent = resolveAccentColor(host)

    // 尺寸同步：canvas 位图 = CSS 尺寸 × dpr，并设定变换，之后一律按 CSS 像素绘制
    let cssWidth = 0
    let cssHeight = 0
    const syncSize = () => {
      const rect = host.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      cssWidth = Math.max(0, rect.width)
      cssHeight = Math.max(0, rect.height)
      const pixelWidth = Math.max(1, Math.min(8192, Math.round(cssWidth * dpr)))
      const pixelHeight = Math.max(1, Math.min(8192, Math.round(cssHeight * dpr)))
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
    const timeData = new Uint8Array(TIME_SAMPLE_COUNT)
    const st: DrawState = { levels: [], peaks: [], wave: [], bass: 0, time: 0 }
    let lastTs = 0
    let rafId = 0
    const tick = (ts: number) => {
      rafId = requestAnimationFrame(tick)
      const dt = lastTs > 0 ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016
      lastTs = ts
      st.time += dt
      if (cssWidth < 2 || cssHeight < 2) {
        return
      }
      const analyser = getMusicAnalyser()
      const live = Boolean(analyser && getMusicPlayerState().isPlaying)
      ctx.clearRect(0, 0, cssWidth, cssHeight)
      if (mode === 'wave') {
        if (live && analyser) {
          analyser.getByteTimeDomainData(timeData)
        }
        drawWave(ctx, cssWidth, cssHeight, live ? timeData : undefined, accent, st)
      } else {
        if (live && analyser) {
          analyser.getByteFrequencyData(freq)
        }
        if (mode === 'bars') {
          drawBars(ctx, cssWidth, cssHeight, live ? freq : undefined, accent, barCount, st)
        } else {
          drawRing(ctx, cssWidth, cssHeight, live ? freq : undefined, accent, barCount, st)
        }
      }
    }
    rafId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [mode, barCount])

  return (
    <div ref={hostRef} class={`music__spectrum${className ? ` ${className}` : ''}`}>
      <canvas ref={canvasRef} class="music__spectrum-canvas" />
    </div>
  )
}
