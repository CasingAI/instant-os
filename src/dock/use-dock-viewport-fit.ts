import { useEffect, useLayoutEffect, useState } from 'preact/hooks'
import { useGeneratedApps } from '../os/generated-apps-context.tsx'
import { useDevExtApps } from '../os/dev-ext-apps-context.tsx'
import { useLauncherLayout } from '../os/launcher-layout-context.tsx'
import { useOs } from '../os/os-context.tsx'
import { isGeneratedAppId } from '../os/types.ts'
import { EXPERIMENTAL_SETTINGS_CHANGED_EVENT } from '../os/experimental-settings-storage.ts'
import { applyDockSettingsVariables } from './apply-dock-settings.ts'
import { buildDockLayoutSnapshot, setDockLayoutSnapshot } from './dock-layout-metrics.ts'
import { DOCK_SETTINGS_CHANGED_EVENT } from './dock-settings-storage.ts'

export const DOCK_VIEWPORT_FIT_CHANGED_EVENT = 'instant-os:dock-viewport-fit-changed'

export function useDockViewportFit(): void {
  const { windows } = useOs()
  const { pinnedDockItemIds } = useLauncherLayout()
  const { installedApps } = useGeneratedApps()
  const { sessionExtApps } = useDevExtApps()

  const runningAppIds = [...new Set(windows.map((window) => window.appId))]
  const installedGeneratedAppIds = new Set(
    installedApps.map((app) => app.id).filter((appId) => isGeneratedAppId(appId)),
  )
  const sessionExtAppIds = new Set(sessionExtApps.map((app) => app.id))

  const [experimentalVersion, setExperimentalVersion] = useState(0)

  useEffect(() => {
    const handleChange = () => setExperimentalVersion((v) => v + 1)
    window.addEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, handleChange)
    return () => window.removeEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, handleChange)
  }, [])

  useLayoutEffect(() => {
    setDockLayoutSnapshot(
      buildDockLayoutSnapshot({ pinnedDockItemIds, runningAppIds, installedGeneratedAppIds, sessionExtAppIds }),
    )
    applyDockSettingsVariables()
    window.dispatchEvent(new CustomEvent(DOCK_VIEWPORT_FIT_CHANGED_EVENT))
  }, [pinnedDockItemIds, runningAppIds.join('|'), installedApps.map((app) => app.id).join('|'), sessionExtApps.map((app) => app.id).join('|'), experimentalVersion])

  useEffect(() => {
    const sync = () => {
      applyDockSettingsVariables()
      window.dispatchEvent(new CustomEvent(DOCK_VIEWPORT_FIT_CHANGED_EVENT))
    }

    sync()
    window.addEventListener('resize', sync)
    window.addEventListener(DOCK_SETTINGS_CHANGED_EVENT, sync)
    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener(DOCK_SETTINGS_CHANGED_EVENT, sync)
    }
  }, [])
}
