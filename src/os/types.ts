import type { ComponentType } from 'preact'
import type { BuiltinAppAbout } from './builtin-app-about.ts'
import type { TerminalPrivilegeRequest } from '../terminal/terminal-privilege-types.ts'

export type BuiltinAppId = 'browser' | 'settings' | 'photos' | 'files' | 'textedit' | 'preview' | 'vscode' | 'mail' | 'appstore' | 'scene3d-lab' | 'model-vision' | 'icode' | 'news' | 'weather' | 'stocks' | 'translate' | 'catgpt' | 'gomoku' | 'books' | 'calendar' | 'speech' | 'system-info' | 'task-manager' | 'event-log' | 'keychain' | 'github-desktop' | 'help' | 'terminal' | 'virtual-js'

export type OpenAppOptions = {
  /** 全局绝对路径（如 `/user/笔记.txt`），用于文档类应用打开指定文件 */
  documentId?: string
  /** 打开/聚焦终端时注入的待确认特权操作 */
  terminalAction?: TerminalPrivilegeRequest
}
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
  /** 允许同一应用同时打开多扇窗口（文档类应用） */
  multiWindow?: boolean
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
  /** 文档类应用当前 / 待打开的全局绝对路径（如 `/user/笔记.txt`） */
  documentId?: string
  /** 文档有未保存更改时，标题栏右侧显示「已编辑」 */
  documentEdited?: boolean
  /** 文档只读时，标题前显示淡色「只读 - 」前缀 */
  documentReadOnly?: boolean
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
