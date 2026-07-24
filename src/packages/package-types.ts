/** Instant PackageService 类型（L2） */

import { DEFAULT_PACKAGE_STORE_ROOT } from './package-store-paths.ts'

export type PackageId = string

export type PackageTaskKind =
  | 'install'
  | 'uninstall'
  | 'update'
  | 'npx-fetch'
  | 'cleanup'

export type PackageTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type PackageLogLevel = 'info' | 'warn' | 'error'

export type PackageLogLine = {
  at: number
  level: PackageLogLevel
  message: string
}

/** pnpm 风格计数：resolved / reused / downloaded / added */
export type PackageInstallCounters = {
  resolved: number
  reused: number
  downloaded: number
  added: number
}

export type PackageInstallDepChange = {
  name: string
  version: string
  /** 直接依赖进 dependencies；其余算 transitive（终端默认只展示直接依赖） */
  section: 'dependencies' | 'devDependencies' | 'transitive'
}

/** 安装任务收尾摘要（终端 / App 共用） */
export type PackageInstallReport = {
  counters: PackageInstallCounters
  /** Packages: +N -M */
  addedCount: number
  removedCount: number
  alreadyUpToDate: boolean
  durationMs: number
  /** 直接依赖变更，用于 dependencies: / + name version */
  depChanges: PackageInstallDepChange[]
  /** 可选上下文一行，如锁优先跳过 registry */
  contextLine?: string
}

/** 安装过程进度（不写入 logs，避免刷屏） */
export type PackageTaskProgress = {
  phase: 'resolve' | 'download' | 'extract' | 'link' | 'lifecycle'
  /** 0–100；总量未知时省略 */
  percent?: number
  detail: string
  counters?: PackageInstallCounters
  /** Packages: +N（解析完成后可知） */
  packagesPlus?: number
  packagesMinus?: number
  /** 大包下载旁注，如 `typescript@5.4.5: 12.3 MB / 28.1 MB` */
  fetchHint?: string
  done?: boolean
}

export type PackageTask = {
  id: string
  kind: PackageTaskKind
  projectRoot: string
  status: PackageTaskStatus
  createdAt: number
  updatedAt: number
  packages: string[]
  logs: PackageLogLine[]
  /** 当前下载/解压进度；阶段结束或任务结束时清空 */
  progress?: PackageTaskProgress
  /** 成功（或已最新）时的结构化摘要 */
  installReport?: PackageInstallReport
  error?: string
  abortController: AbortController
}

export type PackageLockEntry = {
  name: string
  version: string
  integrity?: string
  resolved?: string
  dependencies?: Record<string, string>
}

export type InstantPackageLock = {
  lockfileVersion: 1
  name?: string
  packages: Record<string, PackageLockEntry>
}

export type PackageManifest = {
  name: string
  version: string
  description?: string
  main?: string
  module?: string
  exports?: unknown
  bin?: string | Record<string, string>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  scripts?: Record<string, string>
  /** 有 binding.gyp / 明确 native 时拒绝 */
  hasNative?: boolean
}

export type RegistryPackageVersion = {
  version: string
  dist: {
    tarball: string
    integrity?: string
    shasum?: string
  }
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  bin?: string | Record<string, string>
  main?: string
  module?: string
  exports?: unknown
  /** 若 metadata 含 binary / gypfile 等 */
  hasNative?: boolean
}

export type PackageServiceConfig = {
  registryUrl: string
  storeRoot: string
  maxTarballBytes: number
  maxStoreBytes: number
  maxProjectFiles: number
  fetchTimeoutMs: number
  allowedHosts: readonly string[]
  /**
   * 为 true 时 install 不跑 lifecycle（preinstall/install/postinstall/prepare）。
   * 默认 true（更安全）；设置 → NPM 或 CLI `--scripts` / `--ignore-scripts` 可覆盖。
   */
  ignoreScripts: boolean
}

export const DEFAULT_PACKAGE_SERVICE_CONFIG: PackageServiceConfig = {
  registryUrl: 'https://registry.npmjs.org',
  storeRoot: DEFAULT_PACKAGE_STORE_ROOT,
  maxTarballBytes: 32 * 1024 * 1024,
  maxStoreBytes: 512 * 1024 * 1024,
  maxProjectFiles: 50_000,
  fetchTimeoutMs: 60_000,
  allowedHosts: ['registry.npmjs.org', 'registry.npmmirror.com', 'cdn.npmmirror.com'],
  ignoreScripts: true,
}

export type PackageServiceEvent =
  | { type: 'task'; task: Omit<PackageTask, 'abortController'> }
  | { type: 'log'; taskId: string; line: PackageLogLine }
  | {
      type: 'progress'
      taskId: string
      progress: PackageTaskProgress | undefined
    }
  | { type: 'store'; usedBytes: number }
