import { useEffect, useLayoutEffect } from 'preact/hooks'
import { useGeneratedApps } from '../os/generated-apps-context.tsx'
import { useLauncherLayout } from '../os/launcher-layout-context.tsx'
import { useOs } from '../os/os-context.tsx'
import { isGeneratedAppId } from '../os/types.ts'
import { applyDockSettingsVariables } from './apply-dock-settings.ts'
import { buildDockLayoutSnapshot, setDockLayoutSnapshot } from './dock-layout-metrics.ts'
import { DOCK_SETTINGS_CHANGED_EVENT } from './dock-settings-storage.ts'

export const DOCK_VIEWPORT_FIT_CHANGED_EVENT = 'instant-os:dock-viewport-fit-changed'

export function useDockViewportFit(): void {
  const { windows } = useOs()
  const { pinnedDockAppIds } = useLauncherLayout()
  const { installedApps } = useGeneratedApps()

  const runningAppIds = [...new Set(windows.map((window) => window.appId))]
  const installedGeneratedAppIds = new Set(
    installedApps.map((app) => app.id).filter((appId) => isGeneratedAppId(appId)),
  )

  useLayoutEffect(() => {
    const snapshot = buildDockLayoutSnapshot({
      pinnedDockAppIds,
      runningAppIds,
      installedGeneratedAppIds,
    })
    setDockLayoutSnapshot(snapshot)
    applyDockSettingsVariables()
    window.dispatchEvent(new CustomEvent(DOCK_VIEWPORT_FIT_CHANGED_EVENT))
  }, [pinnedDockAppIds, runningAppIds.join('|'), installedApps.map((app) => app.id).join('|')])

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
