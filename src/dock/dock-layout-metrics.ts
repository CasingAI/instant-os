import type { DesktopItemId } from '../os/desktop-folder-types.ts'
import { isDesktopFolderId } from '../os/desktop-folder-types.ts'
import { getAppDefinition } from '../os/app-registry.tsx'
import { loadExperimentalSettings } from '../os/experimental-settings-storage.ts'
import {
  isBuiltinAppVisibleOnDock,
  isBuiltinAppVisibleOnDockWhenRunning,
} from '../os/launcher-app-visibility.ts'
import { isExtAppId, isGeneratedAppId, type AppId, type ExtAppId, type GeneratedAppId } from '../os/types.ts'
import type { DockLayoutSnapshot } from './dock-fit-scale.ts'

export {
  DEFAULT_DOCK_LAYOUT_SNAPSHOT,
  DOCK_AUTO_COMPACT_MIN_SCALE,
  DOCK_PLATE_VIEWPORT_INSET_PX,
  estimateDockPlateWidthPx,
  getDockLayoutSnapshot,
  resolveEffectiveDockIconCenterYOffsetFromBottom,
  resolveEffectiveDockIconSizePx,
  resolveEffectiveDockScale,
  resolveViewportMaxDockScale,
  setDockLayoutSnapshot,
  type DockLayoutSnapshot,
} from './dock-fit-scale.ts'

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
