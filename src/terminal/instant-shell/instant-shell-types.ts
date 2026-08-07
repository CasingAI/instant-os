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
  /** 排除这些文件（glob，`,` 分隔），叠加在默认排除之上 */
  filesToExclude?: string
  /**
   * 默认 true：遵守各层 .gitignore（含子目录嵌套）+ 默认 search.exclude
   * （node_modules/dist/build/coverage/.git）。
   * 置 false 则忽略以上全部，连 node_modules 一起扫（.git 仍恒跳过）。
   */
  useExcludeSettingsAndIgnoreFiles?: boolean
  caseSensitive?: boolean
  /** 将 query 当作正则 */
  regex?: boolean
  /** 最多返回命中数，默认 100 */
  maxMatches?: number
  /** 每命中行附带的上下文行数（前后各 N 行），默认 0 */
  contextLines?: number
  /** 最多扫描文件数，默认 10000；0 表示不限制（配合 timeoutMs 做纯时间兜底） */
  maxFiles?: number
  /** 目录递归最大深度，默认 64 */
  maxDepth?: number
  /** 单文件最大字节数（超出跳过），默认 512 * 1024 */
  maxFileBytes?: number
  /** 软截止（毫秒），覆盖枚举+扫描；超时返回部分结果并标记 truncatedReason='timeout'。不传则不限制 */
  timeoutMs?: number
  /** 是否返回目录文件总数（仅本地卷原生可计数，挂载卷返回 undefined） */
  includeTotalCount?: boolean
}

export type InstantShellGrepContextLine = {
  line: number
  text: string
  /** 是否为命中行 */
  isMatch: boolean
}

export type InstantShellGrepMatch = {
  path: string
  line: number
  column: number
  preview: string
  matchedText: string
  /** contextLines > 0 时的上下文行 */
  context?: InstantShellGrepContextLine[]
}

export type InstantShellGrepResult = {
  matches: InstantShellGrepMatch[]
  /** 结果可能不完整（命中/文件数/深度/超时任一上限触发） */
  truncated: boolean
  /** 截断原因 */
  truncatedReason?: 'maxMatches' | 'maxFiles' | 'maxDepth' | 'timeout'
  scannedFiles: number
  /** 本次收集到的文件总数（用于判断 maxFiles 是否被触达） */
  filesToScan: number
  /** 目录下文件总数（仅 includeTotalCount 时；仅本地卷原生可计数，挂载卷为 undefined） */
  totalFiles?: number
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
  /**
   * 是否在 commit 说明末尾附加 Instant Agent 的 Co-authored-by。
   * 默认 true；传 false 可取消。
   */
  includeCoAuthor?: boolean
}

export type InstantShellGitChangeKind = 'added' | 'modified' | 'deleted'

export type InstantShellGitChange = {
  path: string
  kind: InstantShellGitChangeKind
}

export type InstantShellGitRepoRef = {
  owner: string
  repo: string
  branch: string
  /** 完整 tip SHA；无 tip 时为 null */
  head: string | null
}

export type InstantShellGitStatusResult = InstantShellGitRepoRef & {
  summary: string
  clean: boolean
  hasUnpushedCommits: boolean
  changes: InstantShellGitChange[]
}

export type InstantShellGitDiffFile = InstantShellGitChange & {
  notice?: string
  original?: string
  modified?: string
}

export type InstantShellGitDiffResult = {
  summary: string
  files: InstantShellGitDiffFile[]
  truncated: boolean
}

export type InstantShellGitCommitEntry = {
  sha: string
  message: string
}

export type InstantShellGitBranchEntry = {
  name: string
  tip: string | null
  current: boolean
}

export type InstantShellGitLogResult = InstantShellGitRepoRef & {
  summary: string
  localCommits: InstantShellGitCommitEntry[]
  remoteCommits: InstantShellGitCommitEntry[]
  branches: InstantShellGitBranchEntry[]
}

export type InstantShellGitCloneResult = InstantShellGitRepoRef & {
  summary: string
  repoRoot: string
}

export type InstantShellGitCommitResult = InstantShellGitRepoRef & {
  summary: string
  message: string
  changes: InstantShellGitChange[]
}

export type InstantShellGitPushResult = InstantShellGitRepoRef & {
  summary: string
}

export type InstantShellGitPullResult = InstantShellGitRepoRef & {
  summary: string
}

export type InstantShellGitFetchResult = InstantShellGitRepoRef & {
  summary: string
  localSha: string | null
  remoteSha: string | null
  upToDate: boolean
  branchCount: number
  cachedCommitCount: number
}

export type InstantShellGitSwitchBranchResult = InstantShellGitRepoRef & {
  summary: string
  syncedWithRemote: boolean
}

export type InstantShellGitDiscardResult = InstantShellGitRepoRef & {
  summary: string
  discarded: InstantShellGitChange[]
}

export type InstantShellGitUndoResult = {
  summary: string
  head: string | null
}

export type InstantShellGitAmendResult = {
  summary: string
  head: string | null
}

export type InstantShellGitCreateBranchOptions = {
  name: string
  checkout?: boolean
  publish?: boolean
}

export type InstantShellGitCreateBranchResult = {
  summary: string
  branch: string
  currentBranch: string
  head: string | null
  published: boolean
  checkedOut: boolean
}

export type InstantShellGitStashSaveResult = {
  summary: string
  stashedCount: number
  message?: string
}

export type InstantShellGitStashPopResult = {
  summary: string
  remainingStashCount: number
}

export type InstantShellGitStashEntry = {
  id: string
  branch: string
  createdAt: number
  message?: string
  changeCount: number
}

export type InstantShellGitStashListResult = {
  summary: string
  stashes: InstantShellGitStashEntry[]
}

/**
 * 客侧 `instant.git`：GitHub 工作树门面（非真实 git）。
 * 路径须能解析到 `/dev/github/{owner}/{repo}`；返回值为带 summary 的结构化对象。
 */
export type InstantShellGitApi = {
  status: () => Promise<InstantShellGitStatusResult>
  diff: (path?: string) => Promise<InstantShellGitDiffResult>
  log: (limit?: number) => Promise<InstantShellGitLogResult>
  clone: (options: InstantShellGitCloneOptions) => Promise<InstantShellGitCloneResult>
  commit: (options: InstantShellGitCommitOptions) => Promise<InstantShellGitCommitResult>
  push: () => Promise<InstantShellGitPushResult>
  pull: () => Promise<InstantShellGitPullResult>
  fetch: () => Promise<InstantShellGitFetchResult>
  switchBranch: (branch: string) => Promise<InstantShellGitSwitchBranchResult>
  discard: (paths: string[]) => Promise<InstantShellGitDiscardResult>
  undo: () => Promise<InstantShellGitUndoResult>
  amend: (message: string) => Promise<InstantShellGitAmendResult>
  createBranch: (
    options: InstantShellGitCreateBranchOptions,
  ) => Promise<InstantShellGitCreateBranchResult>
  stashSave: (message?: string) => Promise<InstantShellGitStashSaveResult>
  stashPop: () => Promise<InstantShellGitStashPopResult>
  stashList: () => Promise<InstantShellGitStashListResult>
}

/** 客侧 `instant.wish` 的能力缺口类别。 */
export type InstantShellWishCategory =
  | 'capability'
  | 'policy'
  | 'network'
  | 'data'
  | 'tooling'
  | 'other'

/** 客侧 `instant.wish` 选项。 */
export type InstantShellWishOptions = {
  /** 缺口一句话（名词化 backlog 标题） */
  summary: string
  category: InstantShellWishCategory
  /** 当时正要做什么 */
  blockedStep: string
  /** 已尝试变通，最多 5 条 */
  attempted?: string[]
  /** 可选短补充 */
  detail?: string
}

export type InstantShellWishResult = {
  wishId: string
  summary: string
  duplicated: boolean
  /** 恒为 `/dev/terminal/wishlist.jsonl` */
  path: string
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
  /**
   * 向平台愿望单登记能力缺口（落盘 `/dev/terminal/wishlist.jsonl`）。
   * Ask/Plan 只读终端也允许；不期待即时兑现。
   */
  wish: (options: InstantShellWishOptions) => Promise<InstantShellWishResult>
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
