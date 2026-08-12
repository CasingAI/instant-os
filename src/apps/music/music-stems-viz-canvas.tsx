/**
 * 分轨可视化 Canvas 宿主：按 mode 调度九套绘制；特征就绪后按播放进度采样。
 */

import { useEffect, useRef } from 'preact/hooks'
import { getMusicCurrentTimeMs } from './music-player.ts'
import {
  idleStemSample,
  sampleStemFeaturesAt,
  type StemVizFeatures,
} from './music-stems-features.ts'
import {
  createAuroraDrawState,
  drawStemAurora,
  type AuroraDrawState,
} from './music-stems-viz-aurora.ts'
import {
  createFluidDrawState,
  drawStemFluid,
  type FluidDrawState,
} from './music-stems-viz-fluid.ts'
import {
  createGlassDrawState,
  drawStemGlass,
  type GlassDrawState,
} from './music-stems-viz-glass.ts'
import {
  createHyperspaceDrawState,
  drawStemHyperspace,
  type HyperspaceDrawState,
} from './music-stems-viz-hyperspace.ts'
import {
  createImpactDrawState,
  drawStemImpact,
  type ImpactDrawState,
} from './music-stems-viz-impact.ts'
import {
  createKaleidoDrawState,
  drawStemKaleido,
  type KaleidoDrawState,
} from './music-stems-viz-kaleido.ts'
import {
  createOrbitDrawState,
  drawStemOrbit,
  type OrbitDrawState,
} from './music-stems-viz-orbit.ts'
import {
  createPlasmaDrawState,
  drawStemPlasma,
  type PlasmaDrawState,
} from './music-stems-viz-plasma.ts'
import {
  createTunnelDrawState,
  drawStemTunnel,
  type TunnelDrawState,
} from './music-stems-viz-tunnel.ts'

export type MusicStemsVizMode =
  | 'impact'
  | 'tunnel'
  | 'kaleido'
  | 'fluid'
  | 'plasma'
  | 'hyperspace'
  | 'aurora'
  | 'glass'
  | 'orbit'

type MusicStemsVizCanvasProps = {
  mode: MusicStemsVizMode
  features: StemVizFeatures | undefined
}

type ModeState = {
  impact: ImpactDrawState
  tunnel: TunnelDrawState
  kaleido: KaleidoDrawState
  fluid: FluidDrawState
  plasma: PlasmaDrawState
  hyperspace: HyperspaceDrawState
  aurora: AuroraDrawState
  glass: GlassDrawState
  orbit: OrbitDrawState
}

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
      impact: createImpactDrawState(),
      tunnel: createTunnelDrawState(),
      kaleido: createKaleidoDrawState(),
      fluid: createFluidDrawState(),
      plasma: createPlasmaDrawState(),
      hyperspace: createHyperspaceDrawState(),
      aurora: createAuroraDrawState(),
      glass: createGlassDrawState(),
      orbit: createOrbitDrawState(),
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

      ctx.clearRect(0, 0, cssWidth, cssHeight)

      switch (mode) {
        case 'impact':
          drawStemImpact(ctx, cssWidth, cssHeight, sample, dt, modeState.impact)
          break
        case 'tunnel':
          drawStemTunnel(ctx, cssWidth, cssHeight, sample, dt, modeState.tunnel)
          break
        case 'kaleido':
          drawStemKaleido(ctx, cssWidth, cssHeight, sample, dt, modeState.kaleido)
          break
        case 'fluid':
          drawStemFluid(ctx, cssWidth, cssHeight, sample, dt, modeState.fluid)
          break
        case 'plasma':
          drawStemPlasma(ctx, cssWidth, cssHeight, sample, dt, modeState.plasma)
          break
        case 'hyperspace':
          drawStemHyperspace(ctx, cssWidth, cssHeight, sample, dt, modeState.hyperspace)
          break
        case 'aurora':
          drawStemAurora(ctx, cssWidth, cssHeight, sample, dt, modeState.aurora)
          break
        case 'glass':
          drawStemGlass(ctx, cssWidth, cssHeight, sample, dt, modeState.glass)
          break
        case 'orbit':
          drawStemOrbit(ctx, cssWidth, cssHeight, sample, dt, modeState.orbit)
          break
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
