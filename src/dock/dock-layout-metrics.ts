import type { DesktopItemId } from '../os/desktop-folder-types.ts'
import { isDesktopFolderId } from '../os/desktop-folder-types.ts'
import { getAppDefinition } from '../os/app-registry.tsx'
import { loadExperimentalSettings } from '../os/experimental-settings-storage.ts'
import {
  isBuiltinAppVisibleOnDock,
  isBuiltinAppVisibleOnDockWhenRunning,
} from '../os/launcher-app-visibility.ts'
import { isExtAppId, isGeneratedAppId, type AppId, type ExtAppId, type GeneratedAppId } from '../os/types.ts'
import {
  DOCK_BASE_ICON_PX,
  DOCK_BASE_RESERVE_PX,
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

function isVisibleDockApp(
  appId: AppId,
  installedGeneratedAppIds: ReadonlySet<GeneratedAppId>,
  sessionExtAppIds: ReadonlySet<ExtAppId>,
  whenRunning = false,
): boolean {
  if (isGeneratedAppId(appId)) {
    return installedGeneratedAppIds.has(appId)
  }

  if (isExtAppId(appId)) {
    return sessionExtAppIds.has(appId)
  }

  const app = getAppDefinition(appId)
  if (app === undefined) {
    return false
  }

  const experimental = loadExperimentalSettings()
  return whenRunning
    ? isBuiltinAppVisibleOnDockWhenRunning(app, experimental)
    : isBuiltinAppVisibleOnDock(app, experimental)
}

function countOpenWindowsByAppId(
  windows: readonly { appId: AppId; closing?: boolean }[] | undefined,
): Map<AppId, number> {
  const counts = new Map<AppId, number>()
  if (!windows) {
    return counts
  }

  for (const entry of windows) {
    if (entry.closing) {
      continue
    }
    counts.set(entry.appId, (counts.get(entry.appId) ?? 0) + 1)
  }

  return counts
}

/** 多窗口应用在 Dock 上按窗口数占位；无窗口的固定应用占 1 格。 */
function dockIconCountForApp(windowCount: number | undefined, { pinned }: { pinned: boolean }): number {
  if (windowCount !== undefined && windowCount > 0) {
    return windowCount
  }
  return pinned ? 1 : 0
}

export function buildDockLayoutSnapshot(params: {
  pinnedDockItemIds: readonly DesktopItemId[]
  runningAppIds: readonly AppId[]
  installedGeneratedAppIds: ReadonlySet<GeneratedAppId>
  sessionExtAppIds?: ReadonlySet<ExtAppId>
  windows?: readonly { appId: AppId; closing?: boolean }[]
}): DockLayoutSnapshot {
  const sessionExtAppIds = params.sessionExtAppIds ?? new Set<ExtAppId>()
  const windowCountByAppId = countOpenWindowsByAppId(params.windows)
  const pinnedSet = new Set<AppId>()
  let pinnedCount = 0

  for (const itemId of params.pinnedDockItemIds) {
    if (isDesktopFolderId(itemId)) {
      pinnedCount += 1
      continue
    }

    pinnedSet.add(itemId)
    // 含 dockWhenRunning：用户固定后应计入固定区宽度（与 Dock 渲染一致）
    if (isVisibleDockApp(itemId, params.installedGeneratedAppIds, sessionExtAppIds, true)) {
      pinnedCount += dockIconCountForApp(windowCountByAppId.get(itemId), { pinned: true })
    }
  }

  let runningUnpinnedCount = 0
  for (const appId of params.runningAppIds) {
    if (pinnedSet.has(appId)) {
      continue
    }
    if (isVisibleDockApp(appId, params.installedGeneratedAppIds, sessionExtAppIds, true)) {
      runningUnpinnedCount += dockIconCountForApp(windowCountByAppId.get(appId), { pinned: false }) || 1
    }
  }

  return {
    pinnedCount,
    runningUnpinnedCount,
  }
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

export function resolveEffectiveDockReservePx(settings?: DockSettings): number {
  return Math.round(DOCK_BASE_RESERVE_PX * resolveEffectiveDockScale(settings))
}

export function resolveEffectiveDockIconSizePx(settings?: DockSettings): number {
  return Math.round(DOCK_BASE_ICON_PX * resolveEffectiveDockScale(settings))
}

export function resolveEffectiveDockIconCenterYOffsetFromBottom(settings?: DockSettings): number {
  const scale = resolveEffectiveDockScale(settings)
  const bottomPad = Math.round(14 * scale)
  const platePadBottom = Math.round(10 * scale)
  const iconHalf = resolveEffectiveDockIconSizePx(settings) / 2
  return bottomPad + platePadBottom + iconHalf
}
