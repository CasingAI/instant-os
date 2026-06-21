import type { ComponentChildren } from 'preact'
import { createContext } from 'preact'
import { useCallback, useContext, useMemo, useState } from 'preact/hooks'
import type { ExtAppRecord } from './ext-app-types.ts'
import { ExtAppManifestFetchError, fetchExtAppManifest } from './fetch-ext-app-manifest.ts'
import { loadLauncherLayout, saveLauncherLayout, unpinAppFromDock } from './launcher-layout-storage.ts'
import { useOs } from './os-context.tsx'
import type { ExtAppId } from './types.ts'

type DevExtAppsContextValue = {
  sessionExtApps: ExtAppRecord[]
  addSessionExtApp: (devUrl: string) => Promise<ExtAppRecord>
  removeSessionExtApp: (appId: ExtAppId) => void
  getSessionExtApp: (appId: ExtAppId) => ExtAppRecord | undefined
  openSessionExtApp: (appId: ExtAppId) => void
}

const DevExtAppsContext = createContext<DevExtAppsContextValue | undefined>(undefined)

function toExtAppRecord(resolved: Awaited<ReturnType<typeof fetchExtAppManifest>>): ExtAppRecord {
  return {
    id: resolved.manifest.id,
    manifest: resolved.manifest,
    devUrl: resolved.devUrl,
    entryUrl: resolved.entryUrl,
    iconUrl: resolved.iconUrl,
    addedAt: Date.now(),
  }
}

export function DevExtAppsProvider({ children }: { children: ComponentChildren }) {
  const { openExtApp, closeWindowsForApp } = useOs()
  const [sessionExtApps, setSessionExtApps] = useState<ExtAppRecord[]>([])

  const getSessionExtApp = useCallback(
    (appId: ExtAppId) => sessionExtApps.find((app) => app.id === appId),
    [sessionExtApps],
  )

  const addSessionExtApp = useCallback(
    async (devUrl: string) => {
      const resolved = await fetchExtAppManifest(devUrl)
      const existing = sessionExtApps.find((app) => app.id === resolved.manifest.id)
      if (existing) {
        const next = toExtAppRecord(resolved)
        setSessionExtApps((current) =>
          current.map((app) => (app.id === next.id ? next : app)),
        )
        return next
      }

      const record = toExtAppRecord(resolved)
      setSessionExtApps((current) => [...current, record])
      return record
    },
    [sessionExtApps],
  )

  const removeSessionExtApp = useCallback(
    (appId: ExtAppId) => {
      setSessionExtApps((current) => current.filter((app) => app.id !== appId))
      closeWindowsForApp(appId)

      const layout = loadLauncherLayout()
      if (layout.pinnedDockItemIds.includes(appId)) {
        saveLauncherLayout(unpinAppFromDock(layout, appId))
      }
    },
    [closeWindowsForApp],
  )

  const openSessionExtApp = useCallback(
    (appId: ExtAppId) => {
      const app = sessionExtApps.find((entry) => entry.id === appId)
      if (!app) {
        return
      }
      openExtApp(appId, app.manifest.name)
    },
    [openExtApp, sessionExtApps],
  )

  const value = useMemo(
    (): DevExtAppsContextValue => ({
      sessionExtApps,
      addSessionExtApp,
      removeSessionExtApp,
      getSessionExtApp,
      openSessionExtApp,
    }),
    [addSessionExtApp, getSessionExtApp, openSessionExtApp, removeSessionExtApp, sessionExtApps],
  )

  return <DevExtAppsContext.Provider value={value}>{children}</DevExtAppsContext.Provider>
}

export function useDevExtApps(): DevExtAppsContextValue {
  const context = useContext(DevExtAppsContext)
  if (!context) {
    throw new Error('useDevExtApps must be used within DevExtAppsProvider')
  }
  return context
}

export { ExtAppManifestFetchError }
