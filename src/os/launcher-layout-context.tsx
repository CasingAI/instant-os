import type { ComponentChildren } from 'preact'
import { createContext } from 'preact'
import { useCallback, useContext, useEffect, useMemo, useState } from 'preact/hooks'
import { dissolveFolder, mergeDesktopItems, moveAppOutOfFolder, renameFolder } from './desktop-folder-operations.ts'
import type { DesktopFolder, DesktopFolderId, DesktopItemId } from './desktop-folder-types.ts'
import type { AppId } from './types.ts'
import {
  loadLauncherLayout,
  pinAppToDock,
  pinItemToDockAtIndex,
  saveLauncherLayout,
  setDesktopIconOrder,
  setDesktopLayout,
  subscribeLauncherLayout,
  unpinAppFromDock,
  unpinItemFromDock,
} from './launcher-layout-storage.ts'

type LauncherLayoutContextValue = {
  pinnedDockItemIds: DesktopItemId[]
  desktopIconOrder: DesktopItemId[]
  desktopFolders: DesktopFolder[]
  isPinnedToDock: (appId: AppId) => boolean
  isItemPinnedToDock: (itemId: DesktopItemId) => boolean
  pinToDock: (appId: AppId) => void
  pinToDockAtIndex: (itemId: DesktopItemId, index: number) => void
  unpinFromDock: (appId: AppId) => void
  unpinItemFromDock: (itemId: DesktopItemId) => void
  updateDesktopIconOrder: (order: DesktopItemId[]) => void
  syncDesktopLayout: (order: DesktopItemId[], folders: DesktopFolder[]) => void
  mergeDesktopItems: (draggedId: DesktopItemId, targetId: DesktopItemId, orderHint?: DesktopItemId[]) => void
  renameDesktopFolder: (folderId: DesktopFolderId, name: string) => void
  updateFolderAppOrder: (folderId: DesktopFolderId, appIds: AppId[]) => void
  moveAppOutOfFolder: (folderId: DesktopFolderId, appId: AppId) => void
  dissolveDesktopFolder: (folderId: DesktopFolderId) => void
}

const LauncherLayoutContext = createContext<LauncherLayoutContextValue | undefined>(undefined)

export function LauncherLayoutProvider({ children }: { children: ComponentChildren }) {
  const [layout, setLayout] = useState(loadLauncherLayout)

  useEffect(() => subscribeLauncherLayout(() => setLayout(loadLauncherLayout())), [])

  const persist = useCallback((next: ReturnType<typeof loadLauncherLayout>) => {
    setLayout(next)
    saveLauncherLayout(next)
  }, [])

  const isPinnedToDock = useCallback(
    (appId: AppId) => layout.pinnedDockItemIds.includes(appId),
    [layout.pinnedDockItemIds],
  )

  const isItemPinnedToDock = useCallback(
    (itemId: DesktopItemId) => layout.pinnedDockItemIds.includes(itemId),
    [layout.pinnedDockItemIds],
  )

  const pinToDock = useCallback(
    (appId: AppId) => {
      persist(pinAppToDock(layout, appId))
    },
    [layout, persist],
  )

  const pinToDockAtIndex = useCallback(
    (itemId: DesktopItemId, index: number) => {
      persist(pinItemToDockAtIndex(layout, itemId, index))
    },
    [layout, persist],
  )

  const unpinFromDock = useCallback(
    (appId: AppId) => {
      persist(unpinAppFromDock(layout, appId))
    },
    [layout, persist],
  )

  const unpinItemFromDockAction = useCallback(
    (itemId: DesktopItemId) => {
      persist(unpinItemFromDock(layout, itemId))
    },
    [layout, persist],
  )

  const updateDesktopIconOrder = useCallback((order: DesktopItemId[]) => {
    setLayout((current) => {
      const next = setDesktopIconOrder(current, order)
      saveLauncherLayout(next)
      return next
    })
  }, [])

  const syncDesktopLayout = useCallback((order: DesktopItemId[], folders: DesktopFolder[]) => {
    setLayout((current) => {
      const next = setDesktopLayout(current, order, folders)
      saveLauncherLayout(next)
      return next
    })
  }, [])

  const mergeDesktopItemsAction = useCallback(
    (draggedId: DesktopItemId, targetId: DesktopItemId, orderHint?: DesktopItemId[]) => {
      setLayout((current) => {
        const result = mergeDesktopItems(current, draggedId, targetId, orderHint)
        if (!result) {
          return current
        }
        const next = setDesktopLayout(current, result.order, result.folders)
        saveLauncherLayout(next)
        return next
      })
    },
    [],
  )

  const renameDesktopFolder = useCallback((folderId: DesktopFolderId, name: string) => {
    setLayout((current) => {
      const next = renameFolder(current, folderId, name)
      saveLauncherLayout(next)
      return next
    })
  }, [])

  const updateFolderAppOrder = useCallback((folderId: DesktopFolderId, appIds: AppId[]) => {
    setLayout((current) => {
      const folder = current.desktopFolders.find((entry) => entry.id === folderId)
      if (!folder) {
        return current
      }

      const visibleSet = new Set(folder.appIds)
      const nextAppIds = appIds.filter((appId) => visibleSet.has(appId))
      if (
        nextAppIds.length !== folder.appIds.length ||
        nextAppIds.join('|') === folder.appIds.join('|')
      ) {
        return current
      }

      const next = {
        ...current,
        desktopFolders: current.desktopFolders.map((entry) =>
          entry.id === folderId ? { ...entry, appIds: nextAppIds } : entry,
        ),
      }
      saveLauncherLayout(next)
      return next
    })
  }, [])

  const moveAppOutOfFolderAction = useCallback((folderId: DesktopFolderId, appId: AppId) => {
    setLayout((current) => {
      const next = moveAppOutOfFolder(current, folderId, appId)
      saveLauncherLayout(next)
      return next
    })
  }, [])

  const dissolveDesktopFolder = useCallback((folderId: DesktopFolderId) => {
    setLayout((current) => {
      const next = dissolveFolder(current, folderId)
      saveLauncherLayout(next)
      return next
    })
  }, [])

  const value = useMemo(
    (): LauncherLayoutContextValue => ({
      pinnedDockItemIds: layout.pinnedDockItemIds,
      desktopIconOrder: layout.desktopIconOrder,
      desktopFolders: layout.desktopFolders,
      isPinnedToDock,
      isItemPinnedToDock,
      pinToDock,
      pinToDockAtIndex,
      unpinFromDock,
      unpinItemFromDock: unpinItemFromDockAction,
      updateDesktopIconOrder,
      syncDesktopLayout,
      mergeDesktopItems: mergeDesktopItemsAction,
      renameDesktopFolder,
      updateFolderAppOrder,
      moveAppOutOfFolder: moveAppOutOfFolderAction,
      dissolveDesktopFolder,
    }),
    [
      layout.pinnedDockItemIds,
      layout.desktopIconOrder,
      layout.desktopFolders,
      isPinnedToDock,
      isItemPinnedToDock,
      pinToDock,
      pinToDockAtIndex,
      unpinFromDock,
      unpinItemFromDockAction,
      updateDesktopIconOrder,
      syncDesktopLayout,
      mergeDesktopItemsAction,
      renameDesktopFolder,
      moveAppOutOfFolderAction,
      updateFolderAppOrder,
      dissolveDesktopFolder,
    ],
  )

  return <LauncherLayoutContext.Provider value={value}>{children}</LauncherLayoutContext.Provider>
}

export function useLauncherLayout() {
  const context = useContext(LauncherLayoutContext)
  if (!context) {
    throw new Error('useLauncherLayout 必须在 LauncherLayoutProvider 内使用')
  }
  return context
}
