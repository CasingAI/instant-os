import {
  createDesktopFolderId,
  DEFAULT_FOLDER_NAME,
  isDesktopFolderId,
  type DesktopFolder,
  type DesktopFolderId,
  type DesktopItemId,
} from './desktop-folder-types.ts'
import type { AppId } from './types.ts'
import type { LauncherLayoutState } from './launcher-layout-storage.ts'

export function getAppsInFolders(folders: DesktopFolder[]): Set<AppId> {
  const set = new Set<AppId>()
  for (const folder of folders) {
    for (const appId of folder.appIds) {
      set.add(appId)
    }
  }
  return set
}

export function findFolderContainingApp(
  folders: DesktopFolder[],
  appId: AppId,
): DesktopFolder | undefined {
  return folders.find((folder) => folder.appIds.includes(appId))
}

export function findFolderById(
  folders: DesktopFolder[],
  folderId: DesktopFolderId,
): DesktopFolder | undefined {
  return folders.find((folder) => folder.id === folderId)
}

export function reconcileDesktopFolders(
  folders: DesktopFolder[],
  visibleAppIds: AppId[],
): DesktopFolder[] {
  const visibleSet = new Set(visibleAppIds)
  return folders
    .map((folder) => ({
      ...folder,
      appIds: folder.appIds.filter((appId) => visibleSet.has(appId)),
    }))
    .filter((folder) => folder.appIds.length > 0)
}

/** 页数组的 reconcile：过滤不可见/被收纳的图标与失效文件夹，并回收末尾空页。 */
export function reconcileDesktopPages(
  pages: DesktopItemId[][],
  visibleAppIds: AppId[],
  folders: DesktopFolder[] = [],
): DesktopItemId[][] {
  const visibleSet = new Set(visibleAppIds)
  const reconciledFolders = reconcileDesktopFolders(folders, visibleAppIds)
  const folderIdSet = new Set(reconciledFolders.map((folder) => folder.id))
  const appsInFolders = getAppsInFolders(reconciledFolders)

  const next = pages.map((page) =>
    page.filter((id) => {
      if (isDesktopFolderId(id)) {
        return folderIdSet.has(id)
      }
      return visibleSet.has(id) && !appsInFolders.has(id)
    }),
  )

  while (next.length > 1 && next[next.length - 1].length === 0) {
    next.pop()
  }
  return next.length > 0 ? next : [[]]
}

type MergeResult = {
  pages: DesktopItemId[][]
  folders: DesktopFolder[]
}

function findItemLocation(
  pages: DesktopItemId[][],
  id: DesktopItemId,
): { page: number; slot: number } | undefined {
  for (let page = 0; page < pages.length; page += 1) {
    const slot = pages[page].indexOf(id)
    if (slot >= 0) {
      return { page, slot }
    }
  }
  return undefined
}

export function mergeDesktopItems(
  state: LauncherLayoutState,
  draggedId: DesktopItemId,
  targetId: DesktopItemId,
  orderHint?: DesktopItemId[][],
): MergeResult | undefined {
  if (draggedId === targetId) {
    return undefined
  }

  const folders = [...state.desktopFolders]
  const pages = (orderHint ?? state.desktopPages).map((page) => [...page])

  const draggedIsFolder = isDesktopFolderId(draggedId)
  const targetIsFolder = isDesktopFolderId(targetId)

  const removeId = (id: DesktopItemId) => {
    const location = findItemLocation(pages, id)
    if (location) {
      pages[location.page].splice(location.slot, 1)
    }
  }

  if (!draggedIsFolder && !targetIsFolder) {
    const draggedApp = draggedId as AppId
    const targetApp = targetId as AppId
    const newFolder: DesktopFolder = {
      id: createDesktopFolderId(),
      name: DEFAULT_FOLDER_NAME,
      appIds: [targetApp, draggedApp],
    }
    removeId(draggedApp)
    const targetLocation = findItemLocation(pages, targetApp)
    if (!targetLocation) {
      return undefined
    }
    pages[targetLocation.page].splice(targetLocation.slot, 1, newFolder.id)
    return {
      pages,
      folders: [...folders, newFolder],
    }
  }

  if (!draggedIsFolder && targetIsFolder) {
    const draggedApp = draggedId as AppId
    const targetFolder = findFolderById(folders, targetId)
    if (!targetFolder || targetFolder.appIds.includes(draggedApp)) {
      return undefined
    }
    const nextFolders = folders.map((folder) =>
      folder.id === targetId
        ? { ...folder, appIds: [...folder.appIds, draggedApp] }
        : folder,
    )
    removeId(draggedApp)
    return { pages, folders: nextFolders }
  }

  if (draggedIsFolder && !targetIsFolder) {
    const draggedFolder = findFolderById(folders, draggedId as DesktopFolderId)
    const targetApp = targetId as AppId
    if (!draggedFolder || draggedFolder.appIds.includes(targetApp)) {
      return undefined
    }
    const nextFolders = folders.map((folder) =>
      folder.id === draggedId
        ? { ...folder, appIds: [...folder.appIds, targetApp] }
        : folder,
    )
    removeId(targetApp)
    return { pages, folders: nextFolders }
  }

  if (draggedIsFolder && targetIsFolder) {
    const sourceFolder = findFolderById(folders, draggedId as DesktopFolderId)
    const targetFolder = findFolderById(folders, targetId as DesktopFolderId)
    if (!sourceFolder || !targetFolder) {
      return undefined
    }

    const mergedAppIds = [...targetFolder.appIds]
    for (const appId of sourceFolder.appIds) {
      if (!mergedAppIds.includes(appId)) {
        mergedAppIds.push(appId)
      }
    }

    const nextFolders = folders
      .filter((folder) => folder.id !== draggedId)
      .map((folder) =>
        folder.id === targetId ? { ...folder, appIds: mergedAppIds } : folder,
      )

    removeId(draggedId)
    return { pages, folders: nextFolders }
  }

  return undefined
}

export function removeAppFromFolders(
  folders: DesktopFolder[],
  appId: AppId,
): DesktopFolder[] {
  return folders
    .map((folder) => ({
      ...folder,
      appIds: folder.appIds.filter((id) => id !== appId),
    }))
    .filter((folder) => folder.appIds.length > 0)
}

export function reorderFolderApps(
  state: LauncherLayoutState,
  folderId: DesktopFolderId,
  fromIndex: number,
  toIndex: number,
): LauncherLayoutState {
  const folder = findFolderById(state.desktopFolders, folderId)
  if (!folder) {
    return state
  }

  const appIds = [...folder.appIds]
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= appIds.length ||
    toIndex >= appIds.length ||
    fromIndex === toIndex
  ) {
    return state
  }

  const [moved] = appIds.splice(fromIndex, 1)
  appIds.splice(toIndex, 0, moved)

  return {
    ...state,
    desktopFolders: state.desktopFolders.map((entry) =>
      entry.id === folderId ? { ...entry, appIds } : entry,
    ),
  }
}

export function moveAppOutOfFolder(
  state: LauncherLayoutState,
  folderId: DesktopFolderId,
  appId: AppId,
): LauncherLayoutState {
  const folder = findFolderById(state.desktopFolders, folderId)
  if (!folder) {
    return state
  }

  const pages = state.desktopPages.map((page) => [...page])
  const folderLocation = findItemLocation(pages, folderId)
  const remainingAppIds = folder.appIds.filter((id) => id !== appId)
  let folders = state.desktopFolders

  if (remainingAppIds.length === 0) {
    folders = folders.filter((f) => f.id !== folderId)
    if (folderLocation) {
      pages[folderLocation.page].splice(folderLocation.slot, 1)
      pages[folderLocation.page].push(appId)
    } else {
      pages.push([appId])
    }
  } else if (remainingAppIds.length === 1) {
    const lastApp = remainingAppIds[0]
    folders = folders.filter((f) => f.id !== folderId)
    if (folderLocation) {
      pages[folderLocation.page].splice(folderLocation.slot, 1, lastApp)
      pages[folderLocation.page].push(appId)
    } else {
      pages.push([appId])
    }
  } else {
    folders = folders.map((f) =>
      f.id === folderId ? { ...f, appIds: remainingAppIds } : f,
    )
    if (folderLocation) {
      pages[folderLocation.page].splice(folderLocation.slot + 1, 0, appId)
    } else {
      pages.push([appId])
    }
  }

  return { ...state, desktopPages: pages, desktopFolders: folders }
}

export function dissolveFolder(
  state: LauncherLayoutState,
  folderId: DesktopFolderId,
): LauncherLayoutState {
  const folder = findFolderById(state.desktopFolders, folderId)
  if (!folder) {
    return state
  }

  const pages = state.desktopPages.map((page) => [...page])
  const folderLocation = findItemLocation(pages, folderId)
  if (folderLocation) {
    pages[folderLocation.page].splice(folderLocation.slot, 1, ...folder.appIds)
  }

  return {
    ...state,
    pinnedDockItemIds: state.pinnedDockItemIds.filter((id) => id !== folderId),
    desktopPages: pages,
    desktopFolders: state.desktopFolders.filter((f) => f.id !== folderId),
  }
}

export function renameFolder(
  state: LauncherLayoutState,
  folderId: DesktopFolderId,
  name: string,
): LauncherLayoutState {
  const trimmed = name.trim()
  if (!trimmed) {
    return state
  }

  return {
    ...state,
    desktopFolders: state.desktopFolders.map((folder) =>
      folder.id === folderId ? { ...folder, name: trimmed } : folder,
    ),
  }
}
