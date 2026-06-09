import type { AppDefinition } from './types.ts'
import { isIcodeLauncherEnabled } from './experimental-settings-storage.ts'

export function isBuiltinAppVisibleOnDesktop(app: AppDefinition): boolean {
  if (!app.desktop) {
    return false
  }

  if (app.id === 'icode') {
    return isIcodeLauncherEnabled()
  }

  return true
}

export function isBuiltinAppVisibleOnDock(app: AppDefinition): boolean {
  if (!app.dock) {
    return false
  }

  if (app.id === 'icode') {
    return isIcodeLauncherEnabled()
  }

  return true
}
