import type { ComponentChildren } from 'preact'
import { createContext } from 'preact'
import { useCallback, useContext, useEffect, useMemo, useState } from 'preact/hooks'
import {
  loadLauncherLayout,
  pinAppToDock,
  saveLauncherLayout,
  setDesktopIconOrder,
  subscribeLauncherLayout,
  unpinAppFromDock,
} from './launcher-layout-storage.ts'
import type { AppId } from './types.ts'

type LauncherLayoutContextValue = {
  pinnedDockAppIds: AppId[]
  desktopIconOrder: AppId[]
  isPinnedToDock: (appId: AppId) => boolean
  pinToDock: (appId: AppId) => void
  unpinFromDock: (appId: AppId) => void
  updateDesktopIconOrder: (order: AppId[]) => void
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
    (appId: AppId) => layout.pinnedDockAppIds.includes(appId),
    [layout.pinnedDockAppIds],
  )

  const pinToDock = useCallback(
    (appId: AppId) => {
      persist(pinAppToDock(layout, appId))
    },
    [layout, persist],
  )

  const unpinFromDock = useCallback(
    (appId: AppId) => {
      persist(unpinAppFromDock(layout, appId))
    },
    [layout, persist],
  )

  const updateDesktopIconOrder = useCallback((order: AppId[]) => {
    setLayout((current) => {
      const next = setDesktopIconOrder(current, order)
      saveLauncherLayout(next)
      return next
    })
  }, [])

  const value = useMemo(
    (): LauncherLayoutContextValue => ({
      pinnedDockAppIds: layout.pinnedDockAppIds,
      desktopIconOrder: layout.desktopIconOrder,
      isPinnedToDock,
      pinToDock,
      unpinFromDock,
      updateDesktopIconOrder,
    }),
    [
      layout.pinnedDockAppIds,
      layout.desktopIconOrder,
      isPinnedToDock,
      pinToDock,
      unpinFromDock,
      updateDesktopIconOrder,
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
