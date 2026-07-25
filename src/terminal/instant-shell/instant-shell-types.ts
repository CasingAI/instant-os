/** 终端客侧 `instant.openApp` 选项。 */
export type InstantShellOpenAppOptions = {
  /** 全局绝对路径（如 `/user/笔记.txt`） */
  documentId?: string
  /** 浏览器待导航 URL（与 documentId 互斥） */
  url?: string
}

export type InstantShellAppKind = 'builtin' | 'generated' | 'ext'

export type InstantShellAppInfo = {
  id: string
  name: string
  kind: InstantShellAppKind
}

export type InstantShellWindowInfo = {
  windowId: string
  appId: string
  title: string
  minimized: boolean
  maximized: boolean
  fullscreen: boolean
  zIndex: number
}

/** 客侧 `globalThis.instant` 表面（均为 Promise，便于 async 宿主桥）。 */
export type InstantShellApi = {
  openApp: (appId: string, options?: InstantShellOpenAppOptions) => Promise<void>
  openPath: (path: string) => Promise<void>
  openUrl: (url: string) => Promise<void>
  listApps: () => Promise<InstantShellAppInfo[]>
  listWindows: () => Promise<InstantShellWindowInfo[]>
  focus: (target: string) => Promise<void>
  close: (target: string) => Promise<void>
  minimize: (target: string) => Promise<void>
  restore: (target: string) => Promise<void>
  toggleFullscreen: (target: string) => Promise<void>
  toggleMaximize: (target: string) => Promise<void>
}

/**
 * 宿主绑定：由终端 React 用 `useOs` 等组装；本模块不调用 hooks。
 */
export type InstantShellHost = {
  openApp: (appId: string, options?: InstantShellOpenAppOptions) => void
  openGeneratedApp: (appId: string, title: string) => void
  openExtApp: (appId: string, title: string) => void
  listApps: () => InstantShellAppInfo[]
  listWindows: () => InstantShellWindowInfo[]
  /** 解析 appId 或 windowId；找不到则抛错。 */
  resolveTarget: (
    target: string,
  ) =>
    | { type: 'window'; windowId: string; appId: string }
    | { type: 'app'; appId: string; windowId?: string }
  focusWindow: (windowId: string) => void
  closeWindow: (windowId: string) => void
  closeWindowsForApp: (appId: string) => void
  minimizeWindow: (windowId: string) => void
  restoreWindow: (windowId: string) => void
  toggleFullscreen: (windowId: string) => void
  toggleMaximize: (windowId: string) => void
  getCwd: () => string
  /** 终端实例是否 busy（关窗确认用；仅覆盖当前 eval/任务切片）。 */
  isBusy: () => boolean
  /** 关窗确认；返回 false 表示用户取消。 */
  confirmClose: (message: string) => Promise<boolean>
}
