import type { ExperimentalSettings } from './experimental-settings-storage.ts'
import type { AppDefinition } from './types.ts'

export function isBuiltinAppVisibleOnDesktop(
  app: AppDefinition,
  experimental?: ExperimentalSettings,
): boolean {
  if (app.desktop === true) return true
  if (app.id === 'speech' && experimental?.speechApp === true) return true
  return false
}

export function isBuiltinAppVisibleOnDock(
  app: AppDefinition,
  experimental?: ExperimentalSettings,
): boolean {
  if (app.dock === true) return true
  if (app.id === 'speech' && experimental?.speechApp === true) return true
  return false
}
