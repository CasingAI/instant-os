import type { ComponentType } from 'preact'
import type { BuiltinAppAbout } from './builtin-app-about.ts'

export type BuiltinAppId = 'browser' | 'settings' | 'photos' | 'mail' | 'appstore' | 'scene3d-lab' | 'icode' | 'news' | 'weather' | 'stocks' | 'translate' | 'catgpt' | 'gomoku' | 'books' | 'speech' | 'system-info' | 'task-manager'
export type GeneratedAppId = `gen:${string}`
export type AppId = BuiltinAppId | GeneratedAppId

export function isGeneratedAppId(appId: AppId): appId is GeneratedAppId {
  return appId.startsWith('gen:')
}

export type AppDefinition = {
  id: BuiltinAppId
  name: string
  icon: ComponentType<{ size?: number }>
  about?: BuiltinAppAbout
  dock?: boolean
  desktop?: boolean
}

export type WindowRestoredBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type WindowSnap = 'left' | 'right'

export type WindowEnterAnimation = 'scale-in'

export type WindowState = {
  id: string
  appId: AppId
  title: string
  minimized: boolean
  maximized: boolean
  snap?: WindowSnap
  fullscreen: boolean
  restoredBounds?: WindowRestoredBounds
  enterAnimation?: WindowEnterAnimation
  closing?: boolean
  zIndex: number
  x: number
  y: number
  width: number
  height: number
}
