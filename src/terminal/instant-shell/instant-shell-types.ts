import type { TerminalChangeSet } from '../terminal-changeset.ts'
import type { TerminalFsMode } from '../terminal-fs-mode.ts'

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

/** 客侧 `instant.grep` 选项。 */
export type InstantShellGrepOptions = {
  /** 相对 cwd 或绝对 VFS 路径；默认 cwd */
  path?: string
  /** glob 过滤（`,` 分隔） */
  filesToInclude?: string
  caseSensitive?: boolean
  /** 将 query 当作正则 */
  regex?: boolean
  /** 最多返回命中数，默认 40 */
  maxMatches?: number
}

export type InstantShellGrepMatch = {
  path: string
  line: number
  column: number
  preview: string
  matchedText: string
}

export type InstantShellGrepResult = {
  matches: InstantShellGrepMatch[]
  truncated: boolean
  scannedFiles: number
  patternError?: string
}

/** 客侧 `instant.git.clone` 选项。 */
export type InstantShellGitCloneOptions = {
  url?: string
  owner?: string
  repo?: string
  branch?: string
}

/** 客侧 `instant.git.commit` 选项。 */
export type InstantShellGitCommitOptions = {
  message: string
  paths?: string[]
  all?: boolean
}

/**
 * 客侧 `instant.git`：GitHub 工作树门面（非真实 git）。
 * 路径须能解析到 `/dev/github/{owner}/{repo}`；返回值为 summary 文本。
 */
export type InstantShellGitApi = {
  status: () => Promise<string>
  diff: (path?: string) => Promise<string>
  log: (limit?: number) => Promise<string>
  clone: (options: InstantShellGitCloneOptions) => Promise<string>
  commit: (options: InstantShellGitCommitOptions) => Promise<string>
  push: () => Promise<string>
  pull: () => Promise<string>
  fetch: () => Promise<string>
  switchBranch: (branch: string) => Promise<string>
  discard: (paths: string[]) => Promise<string>
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
  /** 在 VFS 中搜索文本（grep 等价） */
  grep: (query: string, options?: InstantShellGrepOptions) => Promise<InstantShellGrepResult>
  /** GitHub 工作树（非真实 git） */
  git: InstantShellGitApi
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
  /** 当前终端 FS 模式（供 instant.git 门禁）。 */
  getFsMode: () => TerminalFsMode
  /** 当前终端 session UUID（controlled 下 ChangeSet sessionId）。 */
  getTerminalSessionId: () => string
  /**
   * 记录 instant.git 等宿主侧工作树变更，并入本轮 eval 的可撤销 ChangeSet。
   * 无变更时可 no-op。
   */
  noteExternalChangeSet: (changeSet: TerminalChangeSet) => void
  /** 终端实例是否 busy（关窗确认用；仅覆盖当前 eval/任务切片）。 */
  isBusy: () => boolean
  /** 关窗确认；返回 false 表示用户取消。 */
  confirmClose: (message: string) => Promise<boolean>
}
