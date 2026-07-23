/** Instant PackageService 类型（L2） */

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

/** 安装过程进度（不写入 logs，避免刷屏） */
export type PackageTaskProgress = {
  phase: 'download' | 'extract'
  /** 0–100；总量未知时省略 */
  percent?: number
  detail: string
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
}

export const DEFAULT_PACKAGE_SERVICE_CONFIG: PackageServiceConfig = {
  registryUrl: 'https://registry.npmjs.org',
  storeRoot: '/user/.instant-pkg-store',
  maxTarballBytes: 32 * 1024 * 1024,
  maxStoreBytes: 512 * 1024 * 1024,
  maxProjectFiles: 50_000,
  fetchTimeoutMs: 60_000,
  allowedHosts: ['registry.npmjs.org', 'registry.npmmirror.com', 'cdn.npmmirror.com'],
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
