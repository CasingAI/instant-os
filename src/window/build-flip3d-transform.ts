import type { WindowBounds } from './window-metrics.ts'

export type Flip3dViewport = {
  width: number
  height: number
}

export type Flip3dTransformParts = {
  translateX: number
  translateY: number
  translateZ: number
  rotateY: number
  scale: number
}

/**
 * 正角：右缘朝镜头、左缘后退。后窗往左上排时，能从左侧露出整面内容，
 * 而不是只剩一条侧边（Vista Flip 3D）。
 */
export const FLIP3D_ROTATE_Y_DEG = 52
export const FLIP3D_TARGET_WIDTH_RATIO = 0.46
export const FLIP3D_TARGET_WIDTH_MAX = 680
export const FLIP3D_TARGET_HEIGHT_RATIO = 0.58
export const FLIP3D_RANK_SHIFT_X_RATIO = -0.36
export const FLIP3D_RANK_SHIFT_Y_RATIO = -0.2
export const FLIP3D_RANK_SHIFT_Z_RATIO = -0.42
export const FLIP3D_FRONT_Z = 140
export const FLIP3D_ANCHOR_X_RATIO = 0.62
export const FLIP3D_ANCHOR_Y_RATIO = 0.52
export const FLIP3D_FLYOUT_X_RATIO = 0.92
export const FLIP3D_FLYOUT_Z = 90
export const FLIP3D_FLYOUT_ROTATE_EXTRA_DEG = 10

/** Flip 3D 叠层内覆盖 zIndex：rank 0 最前。 */
export const FLIP3D_Z_BASE = 400

export function flip3dCardSize(viewport: Flip3dViewport): { width: number; height: number } {
  return {
    width: Math.min(viewport.width * FLIP3D_TARGET_WIDTH_RATIO, FLIP3D_TARGET_WIDTH_MAX),
    height: viewport.height * FLIP3D_TARGET_HEIGHT_RATIO,
  }
}

export function computeFlip3dTransformParts(
  bounds: WindowBounds,
  rank: number,
  viewport: Flip3dViewport,
): Flip3dTransformParts {
  const card = flip3dCardSize(viewport)
  const scale =
    bounds.width > 0 && bounds.height > 0
      ? Math.min(card.width / bounds.width, card.height / bounds.height)
      : 1
  const stepX = card.width * FLIP3D_RANK_SHIFT_X_RATIO
  const stepY = card.height * FLIP3D_RANK_SHIFT_Y_RATIO
  const stepZ = card.width * FLIP3D_RANK_SHIFT_Z_RATIO
  const anchorX = viewport.width * FLIP3D_ANCHOR_X_RATIO
  const anchorY = viewport.height * FLIP3D_ANCHOR_Y_RATIO
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  return {
    translateX: anchorX - centerX + rank * stepX,
    translateY: anchorY - centerY + rank * stepY,
    translateZ: FLIP3D_FRONT_Z + rank * stepZ,
    rotateY: FLIP3D_ROTATE_Y_DEG,
    scale,
  }
}

function formatFlip3dTransform(parts: Flip3dTransformParts): string {
  return `translate3d(${parts.translateX}px, ${parts.translateY}px, ${parts.translateZ}px) rotateY(${parts.rotateY}deg) scale(${parts.scale})`
}

export function buildFlip3dTransform(
  bounds: WindowBounds,
  rank: number,
  viewport: Flip3dViewport,
): string {
  return formatFlip3dTransform(computeFlip3dTransformParts(bounds, rank, viewport))
}

/** 前窗掠过：向右飞出（仍保持叠层倾角）。 */
export function computeFlip3dFlyOutParts(
  bounds: WindowBounds,
  viewport: Flip3dViewport,
): Flip3dTransformParts {
  const rest = computeFlip3dTransformParts(bounds, 0, viewport)
  const card = flip3dCardSize(viewport)
  return {
    ...rest,
    translateX: rest.translateX + card.width * FLIP3D_FLYOUT_X_RATIO,
    translateY: rest.translateY + 16,
    translateZ: rest.translateZ + FLIP3D_FLYOUT_Z,
    rotateY: rest.rotateY + FLIP3D_FLYOUT_ROTATE_EXTRA_DEG,
  }
}

export function buildFlip3dFlyOutTransform(bounds: WindowBounds, viewport: Flip3dViewport): string {
  return formatFlip3dTransform(computeFlip3dFlyOutParts(bounds, viewport))
}
