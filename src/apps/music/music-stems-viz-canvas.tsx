/**
 * 分轨可视化 Canvas 宿主：按 mode 调度四套绘制；特征就绪后按播放进度采样。
 */

import { useEffect, useRef } from 'preact/hooks'
import { getMusicCurrentTimeMs } from './music-player.ts'
import {
  idleStemSample,
  sampleStemFeaturesAt,
  type StemVizFeatures,
} from './music-stems-features.ts'
import {
  createCascadeDrawState,
  drawStemCascade,
  type CascadeDrawState,
} from './music-stems-viz-cascade.ts'
import {
  createLatticeDrawState,
  drawStemLattice,
  type LatticeDrawState,
} from './music-stems-viz-lattice.ts'
import {
  createNebulaDrawState,
  drawStemNebula,
  type NebulaDrawState,
} from './music-stems-viz-nebula.ts'
import {
  createRingsDrawState,
  drawStemRings,
  type RingsDrawState,
} from './music-stems-viz-rings.ts'

export type MusicStemsVizMode = 'rings' | 'nebula' | 'lattice' | 'cascade'

type MusicStemsVizCanvasProps = {
  mode: MusicStemsVizMode
  features: StemVizFeatures | undefined
}

type ModeState = {
  rings: RingsDrawState
  nebula: NebulaDrawState
  lattice: LatticeDrawState
  cascade: CascadeDrawState
}

/**
 * 分轨效果画布。尺寸契约与 MusicSpectrumCanvas 一致：宿主定尺寸，canvas 绝对铺满。
 */
export function MusicStemsVizCanvas({ mode, features }: MusicStemsVizCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let cssWidth = 0
    let cssHeight = 0
    const syncSize = () => {
      const rect = host.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      cssWidth = Math.max(0, rect.width)
      cssHeight = Math.max(0, rect.height)
      const pixelWidth = Math.max(1, Math.min(8192, Math.round(cssWidth * dpr)))
      const pixelHeight = Math.max(1, Math.min(8192, Math.round(cssHeight * dpr)))
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const observer = new ResizeObserver(syncSize)
    observer.observe(host)
    syncSize()

    const modeState: ModeState = {
      rings: createRingsDrawState(),
      nebula: createNebulaDrawState(),
      lattice: createLatticeDrawState(),
      cascade: createCascadeDrawState(),
    }

    let lastTs = 0
    let rafId = 0
    let animTime = 0

    const tick = (ts: number) => {
      rafId = requestAnimationFrame(tick)
      const dt = lastTs > 0 ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016
      lastTs = ts
      animTime += dt
      if (cssWidth < 2 || cssHeight < 2) return

      const timeSec = getMusicCurrentTimeMs() / 1000
      const sample = features
        ? sampleStemFeaturesAt(features, timeSec)
        : idleStemSample(animTime)

      // 星云自带拖影清屏；其它模式先清空
      if (mode !== 'nebula') {
        ctx.clearRect(0, 0, cssWidth, cssHeight)
      }

      if (mode === 'rings') {
        drawStemRings(ctx, cssWidth, cssHeight, sample, dt, modeState.rings)
      } else if (mode === 'nebula') {
        drawStemNebula(ctx, cssWidth, cssHeight, sample, dt, modeState.nebula)
      } else if (mode === 'lattice') {
        drawStemLattice(ctx, cssWidth, cssHeight, sample, dt, modeState.lattice)
      } else {
        drawStemCascade(ctx, cssWidth, cssHeight, sample, dt, modeState.cascade)
      }
    }

    rafId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [mode, features])

  return (
    <div ref={hostRef} class="music__spectrum music__stems-viz">
      <canvas ref={canvasRef} class="music__spectrum-canvas" />
    </div>
  )
}
