import type { ComponentType } from 'preact'
import type { BuiltinAppAbout } from './builtin-app-about-data.ts'
import type { TerminalPrivilegeRequest } from '../terminal/terminal-privilege-types.ts'

export type BuiltinAppId = 'browser' | 'chromo' | 'page-devtools' | 'webview' | 'settings' | 'photos' | 'files' | 'file-info' | 'textedit' | 'pages' | 'preview' | 'vscode' | 'mail' | 'appstore' | 'scene3d-lab' | 'model-vision' | 'icode' | 'news' | 'weather' | 'stocks' | 'translate' | 'catgpt' | 'produde' | 'gomoku' | 'books' | 'music' | 'calendar' | 'speech' | 'system-info' | 'task-manager' | 'services' | 'event-log' | 'keychain' | 'github-desktop' | 'help' | 'terminal' | 'simulated-terminal' | 'virtual-js' | 'packages' | 'archive-utility' | 'space-sniffer' | 'ui-kit' | 'stems' | 'srml-demo' | 'llm-playground'

export type OpenAppOptions = {
  /** 全局绝对路径（如 `/user/笔记.txt`），用于文档类应用打开指定文件 */
  documentId?: string
  /**
   * 浏览器待导航 URL（http/https）。
   * 与 documentId 互斥；`browser`、`chromo` 等支持 URL 打开的应用消费。
   */
  url?: string
  /** 打开/聚焦终端时注入的待确认特权操作。
   * @deprecated 此字段仅服务于已弃用的模拟终端（simulated-terminal）。
   * 模拟终端移除后此字段应一并移除或迁移到真终端的特权路径。 */
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
  /**
   * 无窗口应用：仍有内部 WindowState 以挂载逻辑 / 菜单，
   * 默认不渲染可见窗框；耗时长时可展开为系统进度窗口。
   */
  windowless?: boolean
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
  /** 浏览器等应用的待导航 / 当前 URL（与 documentId 互斥） */
  url?: string
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
  /** 无窗口应用会话：默认不渲染可见窗框 */
  windowless?: boolean
  /**
   * 无窗口应用临时展开为系统进度/面板窗口（统一标题栏、可拖动）。
   * 切换时保持同一宿主树，避免应用组件卸载。
   */
  windowlessPanel?: boolean
  /**
   * 标题栏控件样式：
   * - window：普通三键（关闭 / 最小化 / 缩放）
   * - dialog：小型对话框，只提供关闭键
   */
  chromeKind?: 'window' | 'dialog'
  /** 禁用红色关闭按钮 */
  chromeCloseDisabled?: boolean
  /** 禁用黄色最小化（仅 chromeKind=window） */
  chromeMinimizeDisabled?: boolean
  /** 禁用绿色全屏/缩放（仅 chromeKind=window） */
  chromeZoomDisabled?: boolean
  closing?: boolean
  zIndex: number
  x: number
  y: number
  width: number
  height: number
}
