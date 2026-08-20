import {
  DOCK_BASE_ICON_PX,
  DOCK_PLATE_ANCHOR_BOTTOM_PAD_BASE,
  DOCK_PLATE_PADDING_BOTTOM_BASE,
  DOCK_SIZE_TIER_SCALES,
  resolveDockSizeScale,
  type DockSettings,
} from './dock-settings-storage.ts'

/** 比「迷你」再小一档，仅视窗过窄时自动使用，不可在设置中调节。 */
export const DOCK_AUTO_COMPACT_MIN_SCALE = 0.4

/** 程序坞条与视窗左右边缘保留的空隙。 */
export const DOCK_PLATE_VIEWPORT_INSET_PX = 24

const DOCK_PLATE_HORIZONTAL_PADDING_BASE = 32
const DOCK_PLATE_GAP_BASE = 10
const DOCK_DIVIDER_WIDTH_PX = 1
const DOCK_DIVIDER_MARGIN_HORIZONTAL_BASE = 4

export type DockLayoutSnapshot = {
  pinnedCount: number
  runningUnpinnedCount: number
}

export const DEFAULT_DOCK_LAYOUT_SNAPSHOT: DockLayoutSnapshot = {
  pinnedCount: 4,
  runningUnpinnedCount: 0,
}

let dockLayoutSnapshot: DockLayoutSnapshot = DEFAULT_DOCK_LAYOUT_SNAPSHOT

export function getDockLayoutSnapshot(): DockLayoutSnapshot {
  return dockLayoutSnapshot
}

export function setDockLayoutSnapshot(snapshot: DockLayoutSnapshot): void {
  dockLayoutSnapshot = snapshot
}

export function estimateDockPlateWidthPx(
  scale: number,
  snapshot: DockLayoutSnapshot = dockLayoutSnapshot,
): number {
  const totalItems = snapshot.pinnedCount + snapshot.runningUnpinnedCount
  if (totalItems <= 0) {
    return 0
  }

  const hasDivider = snapshot.pinnedCount > 0 && snapshot.runningUnpinnedCount > 0
  const iconBlock =
    totalItems * DOCK_BASE_ICON_PX + Math.max(0, totalItems - 1) * DOCK_PLATE_GAP_BASE
  const padded = DOCK_PLATE_HORIZONTAL_PADDING_BASE + iconBlock
  const dividerExtra = hasDivider
    ? DOCK_DIVIDER_WIDTH_PX + DOCK_DIVIDER_MARGIN_HORIZONTAL_BASE * scale
    : 0

  return padded * scale + dividerExtra
}

export function resolveViewportMaxDockScale(
  viewportWidth: number,
  snapshot: DockLayoutSnapshot = dockLayoutSnapshot,
  insetPx = DOCK_PLATE_VIEWPORT_INSET_PX,
): number {
  const totalItems = snapshot.pinnedCount + snapshot.runningUnpinnedCount
  if (totalItems <= 0) {
    return DOCK_SIZE_TIER_SCALES.extraLarge
  }

  const availableWidth = viewportWidth - insetPx
  const hasDivider = snapshot.pinnedCount > 0 && snapshot.runningUnpinnedCount > 0
  const iconBlock =
    totalItems * DOCK_BASE_ICON_PX + Math.max(0, totalItems - 1) * DOCK_PLATE_GAP_BASE
  const padded = DOCK_PLATE_HORIZONTAL_PADDING_BASE + iconBlock
  const dividerConstant = hasDivider ? DOCK_DIVIDER_WIDTH_PX : 0
  const dividerScaleCoeff = hasDivider ? DOCK_DIVIDER_MARGIN_HORIZONTAL_BASE : 0
  const denominator = padded + dividerScaleCoeff
  const numerator = availableWidth - dividerConstant

  if (denominator <= 0) {
    return DOCK_SIZE_TIER_SCALES.extraLarge
  }
  if (numerator <= 0) {
    return DOCK_AUTO_COMPACT_MIN_SCALE
  }

  return numerator / denominator
}

export function resolveEffectiveDockScale(
  settings?: DockSettings,
  viewportWidth = window.innerWidth,
  snapshot: DockLayoutSnapshot = dockLayoutSnapshot,
): number {
  const preferredScale = resolveDockSizeScale(settings)
  const viewportMaxScale = resolveViewportMaxDockScale(viewportWidth, snapshot)
  const capped = Math.min(preferredScale, viewportMaxScale)
  return Math.max(DOCK_AUTO_COMPACT_MIN_SCALE, capped)
}

export function resolveEffectiveDockIconSizePx(settings?: DockSettings): number {
  return Math.round(DOCK_BASE_ICON_PX * resolveEffectiveDockScale(settings))
}

export function resolveEffectiveDockIconCenterYOffsetFromBottom(settings?: DockSettings): number {
  const scale = resolveEffectiveDockScale(settings)
  const bottomPad = Math.round(DOCK_PLATE_ANCHOR_BOTTOM_PAD_BASE * scale)
  const platePadBottom = Math.round(DOCK_PLATE_PADDING_BOTTOM_BASE * scale)
  const iconHalf = resolveEffectiveDockIconSizePx(settings) / 2
  return bottomPad + platePadBottom + iconHalf
}
