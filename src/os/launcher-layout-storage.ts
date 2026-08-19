import { APP_REGISTRY } from './app-registry.tsx'
import {
  applyDefaultLauncherFolders,
  buildDefaultLauncherFolders,
  DEVELOPER_TOOLS_FOLDER_ID,
  isDefaultFolderGroupedAppId,
  LAUNCHER_LAYOUT_VERSION,
} from './builtin-app-launcher-groups.ts'
import { reconcileDesktopItemOrder, removeAppFromFolders } from './desktop-folder-operations.ts'
import type { DesktopFolder, DesktopItemId } from './desktop-folder-types.ts'
import { isDesktopFolderId } from './desktop-folder-types.ts'
import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'
import { isBuiltinAppVisibleOnDesktop } from './launcher-app-visibility.ts'
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
  /** 缺省视为 1（无默认开发工具文件夹）。 */
  layoutVersion?: number
  pinnedDockItemIds: DesktopItemId[]
  desktopIconOrder: DesktopItemId[]
  desktopFolders: DesktopFolder[]
}

/** 出厂程序坞固定区。文件由 reconcile 保证始终存在。 */
const DEFAULT_DOCK_PINNED_APP_IDS: readonly BuiltinAppId[] = ['files', 'appstore', 'browser', 'settings']

/** 始终保留在程序坞固定区，不可移除。 */
export const PERMANENTLY_PINNED_DOCK_APP_IDS: readonly BuiltinAppId[] = ['files']

export function isPermanentlyPinnedToDock(appId: AppId): boolean {
  return PERMANENTLY_PINNED_DOCK_APP_IDS.includes(appId as BuiltinAppId)
}

export function reconcilePinnedDockItemIds(
  pinnedDockItemIds: DesktopItemId[],
  desktopFolders: DesktopFolder[] = [],
): DesktopItemId[] {
  const folderIdSet = new Set(desktopFolders.map((folder) => folder.id))
  const ordered: DesktopItemId[] = []

  for (const itemId of pinnedDockItemIds) {
    if (ordered.includes(itemId)) {
      continue
    }

    if (isDesktopFolderId(itemId)) {
      if (folderIdSet.has(itemId)) {
        ordered.push(itemId)
      }
      continue
    }

    ordered.push(itemId)
  }

  const missingPermanent = PERMANENTLY_PINNED_DOCK_APP_IDS.filter((appId) => !ordered.includes(appId))
  if (missingPermanent.length > 0) {
    ordered.unshift(...missingPermanent)
  }

  return ordered
}

export function getDefaultPinnedDockItemIds(): DesktopItemId[] {
  return reconcilePinnedDockItemIds([...DEFAULT_DOCK_PINNED_APP_IDS])
}

export function getDefaultDesktopIconOrder(): AppId[] {
  return APP_REGISTRY.filter(
    (app) => isBuiltinAppVisibleOnDesktop(app) && !isDefaultFolderGroupedAppId(app.id),
  ).map((app) => app.id)
}

export function getDefaultLauncherLayout(): LauncherLayoutState {
  return {
    layoutVersion: LAUNCHER_LAYOUT_VERSION,
    pinnedDockItemIds: getDefaultPinnedDockItemIds(),
    desktopIconOrder: [...getDefaultDesktopIconOrder(), DEVELOPER_TOOLS_FOLDER_ID],
    desktopFolders: buildDefaultLauncherFolders(),
  }
}

export function reconcileDesktopIconOrder(
  storedOrder: DesktopItemId[],
  visibleAppIds: AppId[],
  folders: DesktopFolder[] = [],
): DesktopItemId[] {
  return reconcileDesktopItemOrder(storedOrder, visibleAppIds, folders)
}

type LegacyDesktopIconPosition = {
  x: number
  y: number
}

type LegacyLauncherLayoutState = {
  desktopPositions?: Partial<Record<AppId, LegacyDesktopIconPosition>>
  pinnedDockAppIds?: AppId[]
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
    const legacyPinnedDockAppIds = Array.isArray(parsed.pinnedDockAppIds)
      ? parsed.pinnedDockAppIds.filter((id): id is AppId => typeof id === 'string')
      : undefined
    const storedPinnedDockItemIds = Array.isArray(parsed.pinnedDockItemIds)
      ? parsed.pinnedDockItemIds.filter((id): id is DesktopItemId => typeof id === 'string')
      : legacyPinnedDockAppIds ?? getDefaultPinnedDockItemIds()

    let desktopIconOrder: DesktopItemId[] = []
    if (Array.isArray(parsed.desktopIconOrder)) {
      desktopIconOrder = parsed.desktopIconOrder.filter(
        (id): id is DesktopItemId => typeof id === 'string',
      )
    } else if (parsed.desktopPositions && typeof parsed.desktopPositions === 'object') {
      desktopIconOrder = migratePositionsToOrder(
        parsed.desktopPositions,
        getDefaultDesktopIconOrder(),
      )
    }

    const desktopFolders = Array.isArray(parsed.desktopFolders)
      ? parsed.desktopFolders.filter(
          (folder): folder is DesktopFolder =>
            typeof folder === 'object' &&
            folder !== undefined &&
            typeof folder.id === 'string' &&
            typeof folder.name === 'string' &&
            Array.isArray(folder.appIds),
        )
      : []

    const pinnedDockItemIds = reconcilePinnedDockItemIds(storedPinnedDockItemIds, desktopFolders)
    let state: LauncherLayoutState = {
      layoutVersion: typeof parsed.layoutVersion === 'number' ? parsed.layoutVersion : 1,
      pinnedDockItemIds,
      desktopIconOrder,
      desktopFolders,
    }

    const foldersMigrated = (state.layoutVersion ?? 1) < LAUNCHER_LAYOUT_VERSION
    if (foldersMigrated) {
      const grouped = applyDefaultLauncherFolders(state)
      state = {
        ...state,
        layoutVersion: LAUNCHER_LAYOUT_VERSION,
        desktopIconOrder: grouped.desktopIconOrder,
        desktopFolders: grouped.desktopFolders,
      }
    }

    const pinsMigrated =
      pinnedDockItemIds.some((itemId, index) => storedPinnedDockItemIds[index] !== itemId) ||
      pinnedDockItemIds.length !== storedPinnedDockItemIds.length ||
      legacyPinnedDockAppIds !== undefined

    if (pinsMigrated || foldersMigrated) {
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
  if (state.pinnedDockItemIds.includes(appId)) {
    return state
  }

  return {
    ...state,
    pinnedDockItemIds: reconcilePinnedDockItemIds(
      [...state.pinnedDockItemIds, appId],
      state.desktopFolders,
    ),
  }
}

export function pinItemToDockAtIndex(
  state: LauncherLayoutState,
  itemId: DesktopItemId,
  index: number,
): LauncherLayoutState {
  if (!isDesktopFolderId(itemId) && isPermanentlyPinnedToDock(itemId)) {
    const permanentIndex = state.pinnedDockItemIds.indexOf(itemId)
    if (permanentIndex >= 0 && permanentIndex !== index) {
      const next = [...state.pinnedDockItemIds]
      next.splice(permanentIndex, 1)
      const clampedIndex = Math.max(0, Math.min(index, next.length))
      next.splice(clampedIndex, 0, itemId)
      return {
        ...state,
        pinnedDockItemIds: reconcilePinnedDockItemIds(next, state.desktopFolders),
      }
    }
    return state
  }

  const current = state.pinnedDockItemIds
  const fromIndex = current.indexOf(itemId)
  let next = fromIndex >= 0 ? current.filter((id) => id !== itemId) : [...current]
  const clampedIndex = Math.max(0, Math.min(index, next.length))
  next = [...next.slice(0, clampedIndex), itemId, ...next.slice(clampedIndex)]

  return {
    ...state,
    pinnedDockItemIds: reconcilePinnedDockItemIds(next, state.desktopFolders),
  }
}

export function unpinItemFromDock(state: LauncherLayoutState, itemId: DesktopItemId): LauncherLayoutState {
  if (!isDesktopFolderId(itemId) && isPermanentlyPinnedToDock(itemId)) {
    return state
  }

  return {
    ...state,
    pinnedDockItemIds: state.pinnedDockItemIds.filter((id) => id !== itemId),
  }
}

export function unpinAppFromDock(state: LauncherLayoutState, appId: AppId): LauncherLayoutState {
  return unpinItemFromDock(state, appId)
}

export function setDesktopIconOrder(state: LauncherLayoutState, order: DesktopItemId[]): LauncherLayoutState {
  return {
    ...state,
    desktopIconOrder: order,
  }
}

export function setDesktopLayout(
  state: LauncherLayoutState,
  order: DesktopItemId[],
  folders: DesktopFolder[],
): LauncherLayoutState {
  return {
    ...state,
    desktopIconOrder: order,
    desktopFolders: folders,
  }
}

export function moveDesktopIconInOrder(order: DesktopItemId[], fromIndex: number, toIndex: number): DesktopItemId[] {
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
  const desktopFolders = removeAppFromFolders(state.desktopFolders, appId)
  const folderIds = new Set(desktopFolders.map((folder) => folder.id))

  return {
    pinnedDockItemIds: state.pinnedDockItemIds.filter((id) => id !== appId),
    desktopIconOrder: state.desktopIconOrder.filter(
      (id) => id !== appId && (!isDesktopFolderId(id) || folderIds.has(id)),
    ),
    desktopFolders,
  }
}
