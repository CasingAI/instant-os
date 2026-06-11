import { loadInstalledApps } from '../os/generated-apps-storage.ts'
import { loadLauncherLayout } from '../os/launcher-layout-storage.ts'
import { isGeneratedAppId, type AppId } from '../os/types.ts'
import {
  buildDockLayoutSnapshot,
  resolveEffectiveDockIconSizePx,
  resolveEffectiveDockReservePx,
  resolveEffectiveDockScale,
  setDockLayoutSnapshot,
} from './dock-layout-metrics.ts'
import {
  createInitialDockSettings,
  hasStoredDockSettings,
  loadDockSettings,
  saveDockSettings,
  type DockSettings,
} from './dock-settings-storage.ts'

export const DOCK_SCALE_CSS_VAR = '--dock-scale'
export const DOCK_RESERVE_CSS_VAR = '--dock-reserve'
export const DOCK_ICON_SIZE_CSS_VAR = '--dock-icon-size'

export function applyDockSettingsVariables(settings?: DockSettings): void {
  const resolvedSettings = settings ?? loadDockSettings()
  const scale = resolveEffectiveDockScale(resolvedSettings)
  const root = document.documentElement

  root.style.setProperty(DOCK_SCALE_CSS_VAR, String(scale))
  root.style.setProperty(DOCK_RESERVE_CSS_VAR, `${resolveEffectiveDockReservePx(resolvedSettings)}px`)
  root.style.setProperty(DOCK_ICON_SIZE_CSS_VAR, `${resolveEffectiveDockIconSizePx(resolvedSettings)}px`)
}

function syncDockLayoutSnapshotFromStorage(runningAppIds: readonly AppId[] = []): void {
  const layout = loadLauncherLayout()
  const installedGeneratedAppIds = new Set(
    loadInstalledApps()
      .map((app) => app.id)
      .filter((appId) => isGeneratedAppId(appId)),
  )

  setDockLayoutSnapshot(
    buildDockLayoutSnapshot({
      pinnedDockAppIds: layout.pinnedDockAppIds,
      runningAppIds,
      installedGeneratedAppIds,
    }),
  )
}

/** 在首屏渲染前调用，确保程序坞尺寸已按当前视窗宽度收敛。 */
export function initializeDockAppearance(): void {
  if (!hasStoredDockSettings()) {
    const defaults = createInitialDockSettings()
    saveDockSettings(defaults)
  }

  syncDockLayoutSnapshotFromStorage()
  applyDockSettingsVariables()
}

export function ensureDockSettingsApplied(): void {
  initializeDockAppearance()
}
