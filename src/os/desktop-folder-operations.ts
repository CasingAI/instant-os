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

export function reconcileDesktopItemOrder(
  storedOrder: DesktopItemId[],
  visibleAppIds: AppId[],
  folders: DesktopFolder[],
): DesktopItemId[] {
  const reconciledFolders = reconcileDesktopFolders(folders, visibleAppIds)
  const appsInFolders = getAppsInFolders(reconciledFolders)
  const folderIdSet = new Set(reconciledFolders.map((folder) => folder.id))
  const visibleAppSet = new Set(visibleAppIds)

  const ordered: DesktopItemId[] = []

  for (const itemId of storedOrder) {
    if (isDesktopFolderId(itemId)) {
      if (folderIdSet.has(itemId) && !ordered.includes(itemId)) {
        ordered.push(itemId)
      }
      continue
    }

    if (visibleAppSet.has(itemId) && !appsInFolders.has(itemId) && !ordered.includes(itemId)) {
      ordered.push(itemId)
    }
  }

  for (const folder of reconciledFolders) {
    if (!ordered.includes(folder.id)) {
      ordered.push(folder.id)
    }
  }

  for (const appId of visibleAppIds) {
    if (!appsInFolders.has(appId) && !ordered.includes(appId)) {
      ordered.push(appId)
    }
  }

  return ordered
}

export function moveDesktopItemInOrder(
  order: DesktopItemId[],
  fromIndex: number,
  toIndex: number,
): DesktopItemId[] {
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

type MergeResult = {
  order: DesktopItemId[]
  folders: DesktopFolder[]
}

function insertItemAtTargetPosition(
  order: DesktopItemId[],
  insertId: DesktopItemId,
  targetItemId: DesktopItemId,
  removeIds: DesktopItemId[],
): DesktopItemId[] {
  const removeSet = new Set(removeIds)
  const targetIndex = order.indexOf(targetItemId)
  const insertAt =
    targetIndex >= 0
      ? order.slice(0, targetIndex).filter((id) => !removeSet.has(id) && id !== insertId).length
      : order.filter((id) => !removeSet.has(id) && id !== insertId).length

  const next = order.filter((id) => !removeSet.has(id) && id !== insertId)
  next.splice(insertAt, 0, insertId)
  return next
}

export function mergeDesktopItems(
  state: LauncherLayoutState,
  draggedId: DesktopItemId,
  targetId: DesktopItemId,
  orderHint?: DesktopItemId[],
): MergeResult | undefined {
  if (draggedId === targetId) {
    return undefined
  }

  const folders = [...state.desktopFolders]
  let order = [...(orderHint ?? state.desktopIconOrder)]

  const draggedIsFolder = isDesktopFolderId(draggedId)
  const targetIsFolder = isDesktopFolderId(targetId)

  if (!draggedIsFolder && !targetIsFolder) {
    const draggedApp = draggedId as AppId
    const targetApp = targetId as AppId
    const newFolder: DesktopFolder = {
      id: createDesktopFolderId(),
      name: DEFAULT_FOLDER_NAME,
      appIds: [targetApp, draggedApp],
    }
    order = insertItemAtTargetPosition(order, newFolder.id, targetApp, [draggedApp, targetApp])
    return {
      order,
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
    order = order.filter((id) => id !== draggedApp)
    return { order, folders: nextFolders }
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
    order = order.filter((id) => id !== targetApp)
    return { order, folders: nextFolders }
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

    order = order.filter((id) => id !== draggedId)
    return { order, folders: nextFolders }
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

  const remainingAppIds = folder.appIds.filter((id) => id !== appId)
  let folders = state.desktopFolders
  let order = [...state.desktopIconOrder]

  if (remainingAppIds.length === 0) {
    folders = folders.filter((f) => f.id !== folderId)
    order = order.filter((id) => id !== folderId)
    order = [...order, appId]
  } else if (remainingAppIds.length === 1) {
    const lastApp = remainingAppIds[0]
    folders = folders.filter((f) => f.id !== folderId)
    const folderIndex = order.indexOf(folderId)
    order = order.filter((id) => id !== folderId)
    if (folderIndex >= 0) {
      order.splice(folderIndex, 0, lastApp, appId)
    } else {
      order.push(lastApp, appId)
    }
  } else {
    folders = folders.map((f) =>
      f.id === folderId ? { ...f, appIds: remainingAppIds } : f,
    )
    const folderIndex = order.indexOf(folderId)
    if (folderIndex >= 0) {
      order.splice(folderIndex + 1, 0, appId)
    } else {
      order.push(appId)
    }
  }

  return { ...state, desktopIconOrder: order, desktopFolders: folders }
}

export function dissolveFolder(
  state: LauncherLayoutState,
  folderId: DesktopFolderId,
): LauncherLayoutState {
  const folder = findFolderById(state.desktopFolders, folderId)
  if (!folder) {
    return state
  }

  const folderIndex = state.desktopIconOrder.indexOf(folderId)
  const order = state.desktopIconOrder.filter((id) => id !== folderId)
  const insertAt = folderIndex >= 0 ? folderIndex : order.length
  order.splice(insertAt, 0, ...folder.appIds)

  return {
    ...state,
    pinnedDockItemIds: state.pinnedDockItemIds.filter((id) => id !== folderId),
    desktopIconOrder: order,
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
