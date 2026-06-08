import { APP_REGISTRY } from './app-registry.tsx'
import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'
import type { AppId, BuiltinAppId } from './types.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.launcherLayout

type LauncherLayoutListener = () => void
const listeners = new Set<LauncherLayoutListener>()

export function subscribeLauncherLayout(listener: LauncherLayoutListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifyLauncherLayoutChange() {
  for (const listener of listeners) {
    listener()
  }
}

export const DESKTOP_ICON_WIDTH = 96
export const DESKTOP_ICON_HEIGHT = 108
export const DESKTOP_ICON_GAP_X = 24
export const DESKTOP_ICON_GAP_Y = 28

export type LauncherLayoutState = {
  pinnedDockAppIds: AppId[]
  desktopIconOrder: AppId[]
}

const DEFAULT_DOCK_PINNED_BUILTIN_COUNT = 4

/** 始终保留在程序坞固定区，不可移除。 */
export const PERMANENTLY_PINNED_DOCK_APP_IDS: readonly BuiltinAppId[] = ['settings']

export function isPermanentlyPinnedToDock(appId: AppId): boolean {
  return PERMANENTLY_PINNED_DOCK_APP_IDS.includes(appId as BuiltinAppId)
}

export function reconcilePinnedDockAppIds(pinnedDockAppIds: AppId[]): AppId[] {
  const ordered = [...pinnedDockAppIds]
  for (const appId of PERMANENTLY_PINNED_DOCK_APP_IDS) {
    if (!ordered.includes(appId)) {
      ordered.push(appId)
    }
  }
  return ordered
}

export function getDefaultPinnedDockAppIds(): AppId[] {
  const leading = APP_REGISTRY.slice(0, DEFAULT_DOCK_PINNED_BUILTIN_COUNT).map((app) => app.id)
  return reconcilePinnedDockAppIds(leading)
}

export function getDefaultDesktopIconOrder(): AppId[] {
  return APP_REGISTRY.filter((app) => app.desktop).map((app) => app.id)
}

export function getDefaultLauncherLayout(): LauncherLayoutState {
  return {
    pinnedDockAppIds: getDefaultPinnedDockAppIds(),
    desktopIconOrder: [],
  }
}

export function reconcileDesktopIconOrder(storedOrder: AppId[], visibleAppIds: AppId[]): AppId[] {
  const visibleSet = new Set(visibleAppIds)
  const ordered = storedOrder.filter((appId) => visibleSet.has(appId))

  for (const appId of visibleAppIds) {
    if (!ordered.includes(appId)) {
      ordered.push(appId)
    }
  }

  return ordered
}

type LegacyDesktopIconPosition = {
  x: number
  y: number
}

type LegacyLauncherLayoutState = {
  desktopPositions?: Partial<Record<AppId, LegacyDesktopIconPosition>>
}

function migratePositionsToOrder(
  positions: Partial<Record<AppId, LegacyDesktopIconPosition>>,
  fallbackOrder: AppId[],
): AppId[] {
  const positionedIds = fallbackOrder.filter((appId) => positions[appId] !== undefined)
  const sorted = [...positionedIds].sort((leftId, rightId) => {
    const left = positions[leftId]
    const right = positions[rightId]
    if (!left || !right) {
      return 0
    }
    if (left.y !== right.y) {
      return left.y - right.y
    }
    return left.x - right.x
  })
  const remaining = fallbackOrder.filter((appId) => positions[appId] === undefined)

  return [...sorted, ...remaining]
}

function readLauncherLayout(): LauncherLayoutState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return getDefaultLauncherLayout()
    }

    const parsed = JSON.parse(raw) as Partial<LauncherLayoutState> & LegacyLauncherLayoutState
    const storedPinnedDockAppIds = Array.isArray(parsed.pinnedDockAppIds)
      ? parsed.pinnedDockAppIds.filter((id): id is AppId => typeof id === 'string')
      : getDefaultPinnedDockAppIds()
    const pinnedDockAppIds = reconcilePinnedDockAppIds(storedPinnedDockAppIds)

    let desktopIconOrder: AppId[] = []
    if (Array.isArray(parsed.desktopIconOrder)) {
      desktopIconOrder = parsed.desktopIconOrder.filter((id): id is AppId => typeof id === 'string')
    } else if (parsed.desktopPositions && typeof parsed.desktopPositions === 'object') {
      desktopIconOrder = migratePositionsToOrder(
        parsed.desktopPositions,
        getDefaultDesktopIconOrder(),
      )
    }

    const state: LauncherLayoutState = { pinnedDockAppIds, desktopIconOrder }
    const pinsMigrated = pinnedDockAppIds.some(
      (appId, index) => storedPinnedDockAppIds[index] !== appId,
    ) || pinnedDockAppIds.length !== storedPinnedDockAppIds.length

    if (pinsMigrated) {
      writeLauncherLayout(state)
    }

    return state
  } catch {
    return getDefaultLauncherLayout()
  }
}

function writeLauncherLayout(state: LauncherLayoutState): boolean {
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(state))
}

export function loadLauncherLayout(): LauncherLayoutState {
  return readLauncherLayout()
}

export function saveLauncherLayout(state: LauncherLayoutState): boolean {
  const saved = writeLauncherLayout(state)
  if (saved) {
    notifyLauncherLayoutChange()
  }
  return saved
}

export function pinAppToDock(state: LauncherLayoutState, appId: AppId): LauncherLayoutState {
  if (state.pinnedDockAppIds.includes(appId)) {
    return state
  }

  return {
    ...state,
    pinnedDockAppIds: [...state.pinnedDockAppIds, appId],
  }
}

export function unpinAppFromDock(state: LauncherLayoutState, appId: AppId): LauncherLayoutState {
  if (isPermanentlyPinnedToDock(appId)) {
    return state
  }

  return {
    ...state,
    pinnedDockAppIds: state.pinnedDockAppIds.filter((id) => id !== appId),
  }
}

export function setDesktopIconOrder(state: LauncherLayoutState, order: AppId[]): LauncherLayoutState {
  return {
    ...state,
    desktopIconOrder: order,
  }
}

export function moveDesktopIconInOrder(order: AppId[], fromIndex: number, toIndex: number): AppId[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= order.length ||
    toIndex >= order.length ||
    fromIndex === toIndex
  ) {
    return order
  }

  const next = [...order]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

export function removeAppFromLauncherLayout(state: LauncherLayoutState, appId: AppId): LauncherLayoutState {
  return {
    pinnedDockAppIds: state.pinnedDockAppIds.filter((id) => id !== appId),
    desktopIconOrder: state.desktopIconOrder.filter((id) => id !== appId),
  }
}
