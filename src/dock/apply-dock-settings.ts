import {
  createInitialDockSettings,
  hasStoredDockSettings,
  loadDockSettings,
  resolveDockIconSizePx,
  resolveDockReservePx,
  resolveDockSizeScale,
  saveDockSettings,
  type DockSettings,
} from './dock-settings-storage.ts'

export const DOCK_SCALE_CSS_VAR = '--dock-scale'
export const DOCK_RESERVE_CSS_VAR = '--dock-reserve'
export const DOCK_ICON_SIZE_CSS_VAR = '--dock-icon-size'

export function applyDockSettingsVariables(settings?: DockSettings): void {
  const scale = resolveDockSizeScale(settings)
  const root = document.documentElement

  root.style.setProperty(DOCK_SCALE_CSS_VAR, String(scale))
  root.style.setProperty(DOCK_RESERVE_CSS_VAR, `${resolveDockReservePx(scale)}px`)
  root.style.setProperty(DOCK_ICON_SIZE_CSS_VAR, `${resolveDockIconSizePx(scale)}px`)
}

export function ensureDockSettingsApplied(): void {
  if (!hasStoredDockSettings()) {
    const defaults = createInitialDockSettings()
    saveDockSettings(defaults)
    applyDockSettingsVariables(defaults)
    return
  }

  applyDockSettingsVariables(loadDockSettings())
}
