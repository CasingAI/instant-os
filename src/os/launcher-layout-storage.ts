import { APP_REGISTRY } from './app-registry.tsx'
import { removeAppFromFolders } from './desktop-folder-operations.ts'
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

/** 旧版一维顺序迁移到页数组时使用的每页容量（渲染时会按真实网格校正）。 */
const MIGRATION_ICONS_PER_PAGE = 24

export type LauncherLayoutState = {
  pinnedDockItemIds: DesktopItemId[]
  /** 桌面图标布局：每页一个数组，页内为槽位顺序（可含空页，页数不限）。 */
  desktopPages: DesktopItemId[][]
  desktopFolders: DesktopFolder[]
}

const DEFAULT_DOCK_PINNED_BUILTIN_COUNT = 4

/** 始终保留在程序坞固定区，不可移除。 */
export const PERMANENTLY_PINNED_DOCK_APP_IDS: readonly BuiltinAppId[] = ['settings']

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

  for (const appId of PERMANENTLY_PINNED_DOCK_APP_IDS) {
    if (!ordered.includes(appId)) {
      ordered.push(appId)
    }
  }

  return ordered
}

export function getDefaultPinnedDockItemIds(): DesktopItemId[] {
  const leading = APP_REGISTRY.slice(0, DEFAULT_DOCK_PINNED_BUILTIN_COUNT).map((app) => app.id)
  return reconcilePinnedDockItemIds(leading)
}

export function getDefaultDesktopIconOrder(): AppId[] {
  return APP_REGISTRY.filter((app) => isBuiltinAppVisibleOnDesktop(app)).map((app) => app.id)
}

export function getDefaultLauncherLayout(): LauncherLayoutState {
  return {
    pinnedDockItemIds: getDefaultPinnedDockItemIds(),
    desktopPages: [getDefaultDesktopIconOrder()],
    desktopFolders: [],
  }
}

type LegacyDesktopIconPosition = {
  x: number
  y: number
}

type LegacyLauncherLayoutState = {
  desktopPositions?: Partial<Record<AppId, LegacyDesktopIconPosition>>
  pinnedDockAppIds?: AppId[]
  desktopIconOrder?: DesktopItemId[]
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

function chunkOrderForMigration(order: DesktopItemId[]): DesktopItemId[][] {
  if (order.length === 0) {
    return [[]]
  }
  const pages: DesktopItemId[][] = []
  for (let index = 0; index < order.length; index += MIGRATION_ICONS_PER_PAGE) {
    pages.push(order.slice(index, index + MIGRATION_ICONS_PER_PAGE))
  }
  return pages
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

    let desktopPages: DesktopItemId[][]
    if (
      Array.isArray(parsed.desktopPages) &&
      parsed.desktopPages.every((page) => Array.isArray(page))
    ) {
      desktopPages = parsed.desktopPages.map((page) =>
        page.filter((id): id is DesktopItemId => typeof id === 'string'),
      )
    } else {
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
      desktopPages = chunkOrderForMigration(desktopIconOrder)
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
    const state: LauncherLayoutState = {
      pinnedDockItemIds,
      desktopPages,
      desktopFolders,
    }
    const pinsMigrated =
      pinnedDockItemIds.some((itemId, index) => storedPinnedDockItemIds[index] !== itemId) ||
      pinnedDockItemIds.length !== storedPinnedDockItemIds.length ||
      legacyPinnedDockAppIds !== undefined

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

export function setDesktopPages(state: LauncherLayoutState, pages: DesktopItemId[][]): LauncherLayoutState {
  return {
    ...state,
    desktopPages: pages,
  }
}

export function setDesktopLayout(
  state: LauncherLayoutState,
  pages: DesktopItemId[][],
  folders: DesktopFolder[],
): LauncherLayoutState {
  return {
    ...state,
    desktopPages: pages,
    desktopFolders: folders,
  }
}

export function removeAppFromLauncherLayout(state: LauncherLayoutState, appId: AppId): LauncherLayoutState {
  const desktopFolders = removeAppFromFolders(state.desktopFolders, appId)
  const folderIds = new Set(desktopFolders.map((folder) => folder.id))

  return {
    pinnedDockItemIds: state.pinnedDockItemIds.filter((id) => id !== appId),
    desktopPages: state.desktopPages.map((page) =>
      page.filter(
        (id) => id !== appId && (!isDesktopFolderId(id) || folderIds.has(id)),
      ),
    ),
    desktopFolders,
  }
}
