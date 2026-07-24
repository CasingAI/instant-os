import { isSystemDebugLogEnabled } from './system-debug-log-settings-storage.ts'

export type SystemDebugLogLayer =
  | 'npm'
  | 'qjs'
  | 'qjs-fs'
  | 'vfs-resolve'
  | 'require'
  | 'system'

export type SystemDebugLogEntry = {
  id: number
  at: number
  layer: SystemDebugLogLayer
  op: string
  detail?: string
  durationMs?: number
}

export const SYSTEM_DEBUG_LOG_CHANGED_EVENT = 'instant-os:system-debug-log-changed'

const RING_CAPACITY = 1024
/** 当前会话持续覆盖写入；卡死标签无法刷新时，其它标签可从这里抬升为残留 */
const LIVE_STORAGE_KEY = 'instant-os-system-debug-log-live'
/** 启动时从 live 抬升；跨标签可读，直到用户隐藏 */
const RESIDUAL_STORAGE_KEY = 'instant-os-system-debug-log-residual'
const SNAPSHOT_EVERY_ENTRIES = 64
/** 硬限速：即使慢操作也不要更频繁地 sync 写 localStorage（否则诊断本身会打满主线程） */
const SNAPSHOT_MIN_INTERVAL_MS = 1500
const NOTIFY_THROTTLE_MS = 1000

const ring: SystemDebugLogEntry[] = []
let nextId = 1
let guestFsSampleCounter = 0
let entriesSinceSnapshot = 0
let lastSnapshotAt = 0
let notifyTimer: ReturnType<typeof setTimeout> | undefined
let previousSessionEntries: SystemDebugLogEntry[] | undefined
let previousSessionSavedAt: number | undefined

export type SystemDebugLogSessionSnapshot = {
  savedAt: number
  entries: SystemDebugLogEntry[]
}

function readSnapshot(key: string): SystemDebugLogSessionSnapshot | undefined {
  if (typeof localStorage === 'undefined') {
    return undefined
  }
  try {
    const raw = localStorage.getItem(key)
    if (!raw) {
      return undefined
    }
    const parsed = JSON.parse(raw) as SystemDebugLogSessionSnapshot
    if (!parsed || !Array.isArray(parsed.entries)) {
      return undefined
    }
    return {
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
      entries: parsed.entries.slice(-RING_CAPACITY),
    }
  } catch {
    return undefined
  }
}

function writeSnapshot(key: string, snapshot: SystemDebugLogSessionSnapshot): void {
  if (typeof localStorage === 'undefined') {
    return
  }
  try {
    localStorage.setItem(key, JSON.stringify(snapshot))
  } catch {
    // quota or private mode — ignore
  }
}

function removeSnapshot(key: string): void {
  if (typeof localStorage === 'undefined') {
    return
  }
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

function loadPreviousSessionFromStorage(): void {
  // 先抬升其它标签（或上次未正常关闭）留下的 live 快照
  const live = readSnapshot(LIVE_STORAGE_KEY)
  if (live !== undefined && live.entries.length > 0) {
    writeSnapshot(RESIDUAL_STORAGE_KEY, live)
    removeSnapshot(LIVE_STORAGE_KEY)
  }

  const residual = readSnapshot(RESIDUAL_STORAGE_KEY)
  if (residual === undefined || residual.entries.length === 0) {
    previousSessionEntries = undefined
    previousSessionSavedAt = undefined
    return
  }
  previousSessionEntries = residual.entries
  previousSessionSavedAt = residual.savedAt
}

loadPreviousSessionFromStorage()

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (
      event.key !== LIVE_STORAGE_KEY &&
      event.key !== RESIDUAL_STORAGE_KEY &&
      event.key !== undefined
    ) {
      return
    }
    // 其它标签写入 live/残留时，刷新本标签「上次会话残留」展示
    const residual = readSnapshot(RESIDUAL_STORAGE_KEY)
    const live = readSnapshot(LIVE_STORAGE_KEY)
    const newest =
      residual !== undefined &&
      (live === undefined || residual.savedAt >= live.savedAt)
        ? residual
        : live
    if (newest !== undefined && newest.entries.length > 0) {
      previousSessionEntries = newest.entries
      previousSessionSavedAt = newest.savedAt
      if (live !== undefined && (residual === undefined || live.savedAt > residual.savedAt)) {
        writeSnapshot(RESIDUAL_STORAGE_KEY, live)
      }
    }
    scheduleNotify()
  })
}

function scheduleNotify() {
  if (typeof window === 'undefined') {
    return
  }
  if (notifyTimer !== undefined) {
    return
  }
  notifyTimer = setTimeout(() => {
    notifyTimer = undefined
    window.dispatchEvent(new CustomEvent(SYSTEM_DEBUG_LOG_CHANGED_EVENT))
  }, NOTIFY_THROTTLE_MS)
}

function persistSnapshot(force: boolean) {
  if (typeof localStorage === 'undefined') {
    return
  }
  const now = Date.now()
  // 始终尊重最小间隔，避免 tsc 风暴期每十几条就 JSON.stringify 整环
  if (now - lastSnapshotAt < SNAPSHOT_MIN_INTERVAL_MS) {
    return
  }
  if (!force && entriesSinceSnapshot < SNAPSHOT_EVERY_ENTRIES) {
    return
  }
  entriesSinceSnapshot = 0
  lastSnapshotAt = now
  writeSnapshot(LIVE_STORAGE_KEY, {
    savedAt: now,
    entries: ring.slice(),
  })
}

/** 路径只保留末 3 段，控制体积 */
export function shortenDebugPath(absolutePath: string | undefined): string | undefined {
  if (absolutePath === undefined || absolutePath.length === 0) {
    return undefined
  }
  const parts = absolutePath.split('/').filter((part) => part.length > 0)
  if (parts.length === 0) {
    return '/'
  }
  const tail = parts.slice(-3).join('/')
  return parts.length > 3 ? `…/${tail}` : `/${tail}`
}

export function appendSystemDebugLog(params: {
  layer: SystemDebugLogLayer
  op: string
  detail?: string
  durationMs?: number
  at?: number
  /** 生命周期 / 错误：跳过关开关与采样 */
  force?: boolean
}): void {
  if (!params.force && !isSystemDebugLogEnabled()) {
    return
  }

  const entry: SystemDebugLogEntry = {
    id: nextId++,
    at: params.at ?? Date.now(),
    layer: params.layer,
    op: params.op,
    detail: params.detail,
    durationMs: params.durationMs,
  }

  ring.push(entry)
  if (ring.length > RING_CAPACITY) {
    ring.splice(0, ring.length - RING_CAPACITY)
  }

  entriesSinceSnapshot += 1
  persistSnapshot(false)
  scheduleNotify()
}

export function recordSampledGuestFsSyscall(
  syscall: string,
  absolutePath: string | undefined,
  durationMs: number,
): void {
  if (!isSystemDebugLogEnabled()) {
    return
  }
  guestFsSampleCounter += 1
  const force = durationMs > 16
  if (!force && guestFsSampleCounter % 16 !== 0) {
    return
  }
  appendSystemDebugLog({
    layer: 'qjs-fs',
    op: syscall,
    detail: shortenDebugPath(absolutePath),
    durationMs: Math.round(durationMs * 10) / 10,
    force: true,
  })
}

export function beginFsHostTrace(syscall: string): { end: (path: string | undefined) => void } {
  const t0 = performance.now()
  return {
    end(path: string | undefined) {
      recordSampledGuestFsSyscall(syscall, path, performance.now() - t0)
    },
  }
}

export function recordSlowVfsResolve(
  absolutePath: string,
  segmentCount: number,
  durationMs: number,
): void {
  if (!isSystemDebugLogEnabled()) {
    return
  }
  // 只记真正慢的解析。深路径（pnpm seg≥9）但 <8ms 的命中/快速未命中绝不能全量记——
  // 否则 tsc 扫 openai 类型树时诊断日志本身就会把主线程打满。
  if (durationMs <= 8) {
    return
  }
  appendSystemDebugLog({
    layer: 'vfs-resolve',
    op: 'resolveNode',
    detail: `${shortenDebugPath(absolutePath) ?? absolutePath} seg=${segmentCount}`,
    durationMs: Math.round(durationMs * 10) / 10,
    force: true,
  })
}

export function listSystemDebugLogs(): SystemDebugLogEntry[] {
  return ring.slice()
}

export function getPreviousSessionSystemDebugLogs(): SystemDebugLogEntry[] {
  return previousSessionEntries?.slice() ?? []
}

export function getPreviousSessionSystemDebugSavedAt(): number | undefined {
  return previousSessionSavedAt
}

export function clearSystemDebugLogs(): void {
  ring.length = 0
  entriesSinceSnapshot = 0
  removeSnapshot(LIVE_STORAGE_KEY)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SYSTEM_DEBUG_LOG_CHANGED_EVENT))
  }
}

export function formatSystemDebugLogLines(entries: SystemDebugLogEntry[]): string {
  return entries
    .map((entry) => {
      const time = new Date(entry.at).toISOString()
      const dur =
        entry.durationMs !== undefined ? ` ${entry.durationMs}ms` : ''
      const detail = entry.detail ? ` ${entry.detail}` : ''
      return `${time} [${entry.layer}] ${entry.op}${dur}${detail}`
    })
    .join('\n')
}

export function dismissPreviousSessionSystemDebugLogs(): void {
  previousSessionEntries = undefined
  previousSessionSavedAt = undefined
  removeSnapshot(RESIDUAL_STORAGE_KEY)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SYSTEM_DEBUG_LOG_CHANGED_EVENT))
  }
}
