import type { ComponentType } from 'preact'
import type { BuiltinAppAbout } from './builtin-app-about.ts'

export type BuiltinAppId = 'browser' | 'settings' | 'photos' | 'mail' | 'appstore' | 'scene3d-lab' | 'icode' | 'news' | 'weather' | 'stocks' | 'translate' | 'catgpt' | 'gomoku' | 'books' | 'calendar' | 'speech' | 'system-info' | 'task-manager' | 'event-log' | 'keychain'
export type GeneratedAppId = `gen:${string}`
export type ExtAppId = `ext:${string}`
export type AppId = BuiltinAppId | GeneratedAppId | ExtAppId

export function isGeneratedAppId(appId: AppId): appId is GeneratedAppId {
  return appId.startsWith('gen:')
}

export function isExtAppId(appId: AppId): appId is ExtAppId {
  return appId.startsWith('ext:')
}

export type AppDefinition = {
  id: BuiltinAppId
  name: string
  icon: ComponentType<{ size?: number }>
  about?: BuiltinAppAbout
  dock?: boolean
  /** 未固定到程序坞，但窗口打开时仍显示图标；关闭后自动消失。 */
  dockWhenRunning?: boolean
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
