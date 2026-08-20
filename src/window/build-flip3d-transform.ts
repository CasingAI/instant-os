import type { WindowBounds } from './window-metrics.ts'

export type Flip3dViewport = {
  width: number
  height: number
}

export type Flip3dLayout = {
  left: number
  top: number
  slotX: number
  slotY: number
  slotZ: number
  scale: number
  rotateX: number
  rotateY: number
  rotateZ: number
}

/**
 * 对照 public/vista-flip3d.svg 量得的投影：
 * 各窗平行（同一姿态）、左缘近、后窗往左上退。
 * 窗口先放到锚点槽位（不用桌面 left/top），再平移；旋转每层相同。
 * 灭点在标题栏高度偏右：近缘多出来的高度主要落在底边，标题栏接近水平。
 */
export const FLIP3D_PERSPECTIVE_PX = 1100
export const FLIP3D_CAMERA_PITCH_DEG = 0.5
export const FLIP3D_CAMERA_YAW_DEG = 18
export const FLIP3D_CAMERA_ROLL_DEG = 0
export const FLIP3D_PERSPECTIVE_ORIGIN_X_RATIO = 0.85
export const FLIP3D_PERSPECTIVE_ORIGIN_Y_RATIO = 0.38

export const FLIP3D_TARGET_WIDTH_RATIO = 0.4
export const FLIP3D_TARGET_WIDTH_MAX = 640
export const FLIP3D_TARGET_HEIGHT_RATIO = 0.42
export const FLIP3D_SCALE_WIDTH_MAX_RATIO = 1.15
export const FLIP3D_RANK_SHIFT_X_RATIO = -0.41
export const FLIP3D_RANK_SHIFT_Y_RATIO = -0.21
export const FLIP3D_RANK_SHIFT_Z_RATIO = -0.32
export const FLIP3D_FRONT_Z = 40
export const FLIP3D_ANCHOR_X_RATIO = 0.7
export const FLIP3D_ANCHOR_Y_RATIO = 0.62
export const FLIP3D_FLYOUT_X_RATIO = 0.7
export const FLIP3D_FLYOUT_Z = 80
/** Vista 原图 6 窗共 5 步；再多的窗线性铺进同一深度，避免 z 穿过 perspective。 */
export const FLIP3D_REF_STEPS = 5

/** Flip 3D 叠层内覆盖 zIndex：rank 0 最前。 */
export const FLIP3D_Z_BASE = 400

export function flip3dCardSize(viewport: Flip3dViewport): { width: number; height: number } {
  return {
    width: Math.min(viewport.width * FLIP3D_TARGET_WIDTH_RATIO, FLIP3D_TARGET_WIDTH_MAX),
    height: viewport.height * FLIP3D_TARGET_HEIGHT_RATIO,
  }
}

export function flip3dPerspectiveOrigin(): string {
  return `${FLIP3D_PERSPECTIVE_ORIGIN_X_RATIO * 100}% ${FLIP3D_PERSPECTIVE_ORIGIN_Y_RATIO * 100}%`
}

/**
 * 把 rank 映射到「Vista 五步」深度。少于 6 窗时等于线性 rank；
 * 更多窗时按比例铺满同一段（不再额外把后段挤成一块）。
 */
export function flip3dStackDepth(rank: number, count: number): number {
  if (rank <= 0) {
    return 0
  }
  const steps = Math.max(count - 1, 1)
  if (steps <= FLIP3D_REF_STEPS) {
    return Math.min(rank, steps)
  }
  return (rank / steps) * FLIP3D_REF_STEPS
}

/**
 * 大窗收到叠层卡片内；小窗保持原尺寸，不拉大去填满卡片。
 */
export function flip3dWindowScale(
  bounds: WindowBounds,
  card: { width: number; height: number },
): number {
  if (bounds.width <= 0 || bounds.height <= 0) {
    return 1
  }
  const byHeight = card.height / bounds.height
  const byWidth = (card.width * FLIP3D_SCALE_WIDTH_MAX_RATIO) / bounds.width
  return Math.min(1, byHeight, byWidth)
}

export function computeFlip3dLayout(
  bounds: WindowBounds,
  rank: number,
  viewport: Flip3dViewport,
  count = Math.max(rank + 1, 1),
): Flip3dLayout {
  const card = flip3dCardSize(viewport)
  const scale = flip3dWindowScale(bounds, card)
  const visualWidth = bounds.width * scale
  const visualHeight = bounds.height * scale
  const anchorX = viewport.width * FLIP3D_ANCHOR_X_RATIO
  const anchorY = viewport.height * FLIP3D_ANCHOR_Y_RATIO
  const depth = flip3dStackDepth(rank, count)
  return {
    left: anchorX - bounds.width / 2,
    top: anchorY - bounds.height / 2,
    slotX: depth * card.width * FLIP3D_RANK_SHIFT_X_RATIO - (card.width - visualWidth) / 2,
    slotY: depth * card.height * FLIP3D_RANK_SHIFT_Y_RATIO - (card.height - visualHeight) / 2,
    slotZ: FLIP3D_FRONT_Z + depth * card.width * FLIP3D_RANK_SHIFT_Z_RATIO,
    scale,
    rotateX: FLIP3D_CAMERA_PITCH_DEG,
    rotateY: FLIP3D_CAMERA_YAW_DEG,
    rotateZ: FLIP3D_CAMERA_ROLL_DEG,
  }
}

function formatFlip3dTransform(layout: Flip3dLayout): string {
  return [
    `translate3d(${layout.slotX}px, ${layout.slotY}px, ${layout.slotZ}px)`,
    `rotateZ(${layout.rotateZ}deg)`,
    `rotateX(${layout.rotateX}deg)`,
    `rotateY(${layout.rotateY}deg)`,
    `scale(${layout.scale})`,
  ].join(' ')
}

export function buildFlip3dTransform(
  bounds: WindowBounds,
  rank: number,
  viewport: Flip3dViewport,
  count = Math.max(rank + 1, 1),
): string {
  return formatFlip3dTransform(computeFlip3dLayout(bounds, rank, viewport, count))
}

export function computeFlip3dFlyOutLayout(
  bounds: WindowBounds,
  viewport: Flip3dViewport,
  count = 1,
): Flip3dLayout {
  const rest = computeFlip3dLayout(bounds, 0, viewport, count)
  const card = flip3dCardSize(viewport)
  return {
    ...rest,
    slotX: rest.slotX + card.width * FLIP3D_FLYOUT_X_RATIO,
    slotY: rest.slotY + 10,
    slotZ: rest.slotZ + FLIP3D_FLYOUT_Z,
  }
}

export function buildFlip3dFlyOutTransform(
  bounds: WindowBounds,
  viewport: Flip3dViewport,
  count = 1,
): string {
  return formatFlip3dTransform(computeFlip3dFlyOutLayout(bounds, viewport, count))
}

/** 比当前最后一层再退后一步，给绕到队尾的窗做入场起点。 */
export function computeFlip3dBackEnterLayout(
  bounds: WindowBounds,
  viewport: Flip3dViewport,
  count: number,
): Flip3dLayout {
  const lastRank = Math.max(count - 1, 0)
  const last = computeFlip3dLayout(bounds, lastRank, viewport, count)
  const front = computeFlip3dLayout(bounds, 0, viewport, count)
  const second = computeFlip3dLayout(bounds, Math.min(1, lastRank), viewport, count)
  return {
    ...last,
    slotX: last.slotX + (second.slotX - front.slotX),
    slotY: last.slotY + (second.slotY - front.slotY),
    slotZ: last.slotZ + (second.slotZ - front.slotZ),
  }
}

export function buildFlip3dBackEnterTransform(
  bounds: WindowBounds,
  viewport: Flip3dViewport,
  count: number,
): string {
  return formatFlip3dTransform(computeFlip3dBackEnterLayout(bounds, viewport, count))
}
