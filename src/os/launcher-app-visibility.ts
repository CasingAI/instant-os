import type { AppDefinition } from './types.ts'

export function isBuiltinAppVisibleOnDesktop(app: AppDefinition): boolean {
  return app.desktop === true
}

export function isBuiltinAppVisibleOnDock(app: AppDefinition): boolean {
  return app.dock === true
}
