/**
 * 系统诊断日志主线程门面（黑匣子入口）。
 *
 * 主线程热路径只允许：读内存开关 →（若开）把短字段 postMessage 给独立 Worker。
 * 不写盘、不等回复、不刷新界面（见 todo/system-debug-log-worker.md 4.1）。
 *
 * - `postMessage` 在调用当下就把数据排进 Worker 队列：主线程死循环时，
 *   循环体内执行到的发送仍然有效；
 * - 计数批量合并：热路径每次调用只动内存计数，攒满 HOT_BATCH 或超过耗时阈值
 *   才发一条消息（对象 → 字符串一律在 Worker 里做）；
 * - Worker 惰性创建（开关打开 / 界面请求 / 迁移时），此模块在 Node 单测下可安全 import；
 * - pong 响应必须保持空操作级开销。
 */

import { isSystemDebugLogEnabled, SYSTEM_DEBUG_LOG_SETTINGS_CHANGED_EVENT } from './system-debug-log-settings-storage.ts'
import {
  formatSystemDebugLogLines,
  shortenDebugPath,
  type SystemDebugLogLayer,
  type SystemDebugLogSnapshot,
} from './system-debug-log-core.ts'
import type {
  SystemDebugLogCurrentView,
  SystemDebugLogMainMessage,
  SystemDebugLogStats,
  SystemDebugLogWorkerMessage,
} from './system-debug-log-protocol.ts'

export {
  formatSystemDebugLogLines,
  shortenDebugPath,
} from './system-debug-log-core.ts'
export type {
  SystemDebugCounters,
  SystemDebugCounter,
  SystemDebugLogEntry,
  SystemDebugLogLayer,
  SystemDebugLogSnapshot,
  SystemDebugLogSnapshotKind,
} from './system-debug-log-core.ts'
export type {
  SystemDebugLogCurrentView,
  SystemDebugLogStats,
} from './system-debug-log-protocol.ts'

export const SYSTEM_DEBUG_LOG_CHANGED_EVENT = 'instant-os:system-debug-log-changed'

/** 热路径纯计数攒多少条才发一条批量计数消息 */
const HOT_BATCH_COUNT = 64
/** Worker 未就绪时的待发队列上限，超了就丢（Worker 启动失败时的自保护） */
const PENDING_QUEUE_CAP = 256
/** 界面请求超时：Worker 不可用时静默返回 undefined */
const REQUEST_TIMEOUT_MS = 3000

type TimelineParams = {
  layer: SystemDebugLogLayer
  op: string
  detail?: string | Record<string, unknown>
  durationMs?: number
  at?: number
}

type HotParams = TimelineParams & {
  /** 超过该耗时才生成完整记录；否则只计数（默认 16ms） */
  thresholdMs?: number
}

type HotPending = { count: number; slowestMs: number }

const hotPending = new Map<SystemDebugLogLayer, Map<string, HotPending>>()

let workerHandle: { worker: Worker; ready: boolean } | undefined
let workerStarting = false
let workerFailed = false
const pendingMessages: SystemDebugLogMainMessage[] = []
let droppedWhileWorkerDown = 0

const pendingRequests = new Map<number, { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }>()
let nextRequestId = 1

let bridgeInitialized = false
let legacyMigrated = false

// ---------------------------------------------------------------- Worker 生命周期

function ensureWorker(): void {
  if (workerHandle !== undefined || workerStarting || workerFailed) {
    return
  }
  if (typeof Worker === 'undefined' || typeof window === 'undefined') {
    return
  }
  workerStarting = true
  try {
    const worker = new Worker(new URL('./system-debug-log-worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent<SystemDebugLogWorkerMessage>) => {
      handleWorkerMessage(worker, event.data)
    }
    worker.onerror = () => {
      workerFailed = true
      if (workerHandle?.worker === worker) {
        workerHandle = undefined
      }
      pendingMessages.length = 0
      for (const [requestId, waiter] of pendingRequests) {
        clearTimeout(waiter.timer)
        waiter.resolve(undefined)
        pendingRequests.delete(requestId)
      }
    }
    workerHandle = { worker, ready: false }
  } catch {
    workerFailed = true
  }
  workerStarting = false
}

function handleWorkerMessage(worker: Worker, data: SystemDebugLogWorkerMessage): void {
  switch (data.type) {
    case 'worker-ready': {
      if (workerHandle?.worker !== worker) {
        return
      }
      workerHandle.ready = true
      worker.postMessage({ type: 'set-enabled', enabled: isSystemDebugLogEnabled() })
      const queued = pendingMessages.splice(0, pendingMessages.length)
      for (const message of queued) {
        worker.postMessage(message)
      }
      return
    }
    case 'ping': {
      // pong 必须极便宜：不读盘、不查设置、不构造大对象（方案 8.2）
      worker.postMessage({ type: 'pong', seq: data.seq })
      return
    }
    case 'changed': {
      window.dispatchEvent(new CustomEvent(SYSTEM_DEBUG_LOG_CHANGED_EVENT))
      return
    }
    case 'current':
    case 'residual':
    case 'stats': {
      const waiter = pendingRequests.get(data.requestId)
      if (waiter === undefined) {
        return
      }
      pendingRequests.delete(data.requestId)
      clearTimeout(waiter.timer)
      if (data.type === 'current') {
        waiter.resolve(data.view)
      } else if (data.type === 'residual') {
        waiter.resolve(data.snapshot)
      } else {
        waiter.resolve(data.stats)
      }
      return
    }
    case 'error': {
      return
    }
  }
}

function postToWorker(message: SystemDebugLogMainMessage): void {
  const handle = workerHandle
  if (handle !== undefined) {
    if (handle.ready) {
      handle.worker.postMessage(message)
      return
    }
  } else if (workerFailed || typeof Worker === 'undefined') {
    droppedWhileWorkerDown += 1
    return
  } else {
    ensureWorker()
  }
  if (pendingMessages.length >= PENDING_QUEUE_CAP) {
    droppedWhileWorkerDown += 1
    return
  }
  pendingMessages.push(message)
}

// ---------------------------------------------------------------- 埋点入口

/** 生命周期事件 → 时间线环（低频、不采样；用户关掉开关就是全部不记） */
export function recordSystemDebugTimeline(params: TimelineParams): void {
  if (!isSystemDebugLogEnabled()) {
    return
  }
  postToWorker({
    type: 'entry',
    ring: 'timeline',
    layer: params.layer,
    op: params.op,
    detail: params.detail,
    durationMs: params.durationMs,
    at: params.at,
    countDelta: 1,
  })
}

function takePendingCount(layer: SystemDebugLogLayer, op: string): HotPending {
  const layerMap = hotPending.get(layer)
  if (layerMap === undefined) {
    return { count: 0, slowestMs: 0 }
  }
  const pending = layerMap.get(op)
  if (pending === undefined) {
    return { count: 0, slowestMs: 0 }
  }
  layerMap.delete(op)
  return pending
}

/**
 * 热路径完整记录：每次都会发给 Worker 进热路径环（限速/合并在 Worker 侧做）。
 * detail 在调用前已算好——热路径调用方请传现成的短字符串。
 */
export function recordSystemDebugHot(params: HotParams): void {
  if (!isSystemDebugLogEnabled()) {
    return
  }
  const pending = takePendingCount(params.layer, params.op)
  postToWorker({
    type: 'entry',
    ring: 'hot',
    layer: params.layer,
    op: params.op,
    detail: params.detail,
    durationMs: params.durationMs !== undefined
      ? Math.round(params.durationMs * 10) / 10
      : undefined,
    at: params.at,
    countDelta: pending.count + 1,
  })
}

/**
 * 热路径纯计数：每次调用只动内存计数，攒满 HOT_BATCH_COUNT 才发一条批量消息。
 * 不构建 detail 字符串——风暴时（如 tsc 扫类型树）这是唯一可承受的密度。
 */
export function countSystemDebugHot(
  layer: SystemDebugLogLayer,
  op: string,
  durationMs?: number,
): void {
  if (!isSystemDebugLogEnabled()) {
    return
  }
  let layerMap = hotPending.get(layer)
  if (layerMap === undefined) {
    layerMap = new Map()
    hotPending.set(layer, layerMap)
  }
  const pending = layerMap.get(op)
  const count = (pending?.count ?? 0) + 1
  const slowestMs = Math.max(pending?.slowestMs ?? 0, durationMs ?? 0)
  if (count < HOT_BATCH_COUNT) {
    layerMap.set(op, { count, slowestMs })
    return
  }
  layerMap.set(op, { count: 0, slowestMs: 0 })
  postToWorker({
    type: 'entry',
    ring: 'hot',
    layer,
    op,
    durationMs: slowestMs > 0 ? Math.round(slowestMs * 10) / 10 : undefined,
    countDelta: count,
  })
}

/** 计时封装：结束时按阈值决定发完整记录（带 detail）还是纯计数 */
export function beginSystemDebugHotTrace(
  layer: SystemDebugLogLayer,
  op: string,
  options?: { thresholdMs?: number; formatDetail?: (durationMs: number) => string | undefined },
): { end: () => void } {
  if (!isSystemDebugLogEnabled()) {
    return NOOP_TRACE
  }
  const t0 = performance.now()
  return {
    end: () => {
      const durationMs = performance.now() - t0
      const thresholdMs = options?.thresholdMs ?? 16
      if (durationMs > thresholdMs) {
        recordSystemDebugHot({
          layer,
          op,
          detail: options?.formatDetail?.(durationMs),
          durationMs,
          thresholdMs,
        })
        return
      }
      countSystemDebugHot(layer, op, durationMs)
    },
  }
}

const NOOP_TRACE: { end: () => void } = { end: () => {} }

// ---------------------------------------------------------------- 兼容包装（现有埋点锚点）

/** 客户机 fs 系统调用采样：慢调用发完整记录（含路径尾段），快的只计数 */
export function beginFsHostTrace(syscall: string): { end: (path: string | undefined) => void } {
  if (!isSystemDebugLogEnabled()) {
    return NOOP_FS_TRACE
  }
  const t0 = performance.now()
  return {
    end: (path: string | undefined) => {
      const durationMs = performance.now() - t0
      if (durationMs > 16) {
        recordSystemDebugHot({
          layer: 'qjs-fs',
          op: syscall,
          detail: shortenDebugPath(path),
          durationMs,
          thresholdMs: 16,
        })
        return
      }
      countSystemDebugHot('qjs-fs', syscall, durationMs)
    },
  }
}

const NOOP_FS_TRACE: { end: (_path: string | undefined) => void } = { end: () => {} }

/** VFS 慢解析：>8ms 才拼 detail 字符串（全量拼串会在 tsc 扫树时打满主线程） */
export function recordSlowVfsResolve(
  absolutePath: string,
  segmentCount: number,
  durationMs: number,
): void {
  if (!isSystemDebugLogEnabled()) {
    return
  }
  if (durationMs <= 8) {
    countSystemDebugHot('vfs-resolve', 'resolveNode', durationMs)
    return
  }
  recordSystemDebugHot({
    layer: 'vfs-resolve',
    op: 'resolveNode',
    detail: `${shortenDebugPath(absolutePath) ?? absolutePath} seg=${segmentCount}`,
    durationMs,
    thresholdMs: 8,
  })
}

// ---------------------------------------------------------------- 界面请求

function requestFromWorker<T>(
  makeMessage: (requestId: number) => SystemDebugLogMainMessage,
): Promise<T | undefined> {
  return new Promise((resolve) => {
    const requestId = nextRequestId++
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId)
      resolve(undefined)
    }, REQUEST_TIMEOUT_MS)
    pendingRequests.set(requestId, { resolve: resolve as (value: unknown) => void, timer })
    ensureWorker()
    postToWorker(makeMessage(requestId))
  })
}

/** 当前会话视图：时间线 + 热路径 + 计数器（问 Worker 内存环，不走主线程存储） */
export function fetchSystemDebugCurrent(): Promise<SystemDebugLogCurrentView | undefined> {
  return requestFromWorker<SystemDebugLogCurrentView>(
    (requestId) => ({ type: 'request-current', requestId }),
  )
}

/** 上次会话残留 / 未响应快照（新标签读诊断库，不依赖冻住标签的内存） */
export function fetchSystemDebugResidual(): Promise<SystemDebugLogSnapshot | undefined> {
  return requestFromWorker<SystemDebugLogSnapshot>(
    (requestId) => ({ type: 'request-residual', requestId }),
  )
}

/** 诊断库占用估算（开发者设置冷路径用） */
export function fetchSystemDebugStats(): Promise<SystemDebugLogStats | undefined> {
  return requestFromWorker<SystemDebugLogStats>(
    (requestId) => ({ type: 'request-stats', requestId }),
  )
}

/** 清空当前会话：内存两环 + 库里的 live 快照 */
export function clearSystemDebugCurrent(): Promise<void> {
  return requestFromWorker<void>((requestId) => ({ type: 'clear-current', requestId })).then(
    () => undefined,
  )
}

/** 清空诊断数据：内存两环 + 诊断库全部快照（不含 instant-os-data / instant-os-files） */
export function clearAllSystemDebugData(): Promise<void> {
  return requestFromWorker<void>((requestId) => ({ type: 'clear-all', requestId })).then(
    () => undefined,
  )
}

/** 隐藏「上次会话残留」并删除库内非 live 快照 */
export function dismissSystemDebugResidual(): Promise<void> {
  return requestFromWorker<void>((requestId) => ({ type: 'dismiss-residual', requestId })).then(
    () => undefined,
  )
}

/** 卡死对话框「复制最近诊断」：能点时从 Worker 取，冻住时只能靠新开标签 */
export async function copyRecentSystemDebugText(limit: number): Promise<string> {
  const view = await fetchSystemDebugCurrent()
  if (view === undefined) {
    return ''
  }
  return [
    '=== 时间线（最近） ===',
    formatSystemDebugLogLines(view.timeline.slice(-limit)),
    '',
    '=== 热路径（最近） ===',
    formatSystemDebugLogLines(view.hot.slice(-limit)),
  ].join('\n')
}

// ---------------------------------------------------------------- 初始化 / 迁移

/** 旧版 localStorage 快照键（迁移一次后删除，避免两套残留） */
const LEGACY_LIVE_KEY = 'instant-os-system-debug-log-live'
const LEGACY_RESIDUAL_KEY = 'instant-os-system-debug-log-residual'

function readLegacySnapshot(
  key: string,
): { savedAt: number; entries: { id: number; at: number; layer: string; op: string; detail?: string; durationMs?: number }[] } | undefined {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) {
      return undefined
    }
    const parsed = JSON.parse(raw) as { savedAt?: unknown; entries?: unknown }
    if (typeof parsed.savedAt !== 'number' || !Array.isArray(parsed.entries)) {
      return undefined
    }
    return {
      savedAt: parsed.savedAt,
      entries: parsed.entries.filter(
        (entry): entry is { id: number; at: number; layer: string; op: string; detail?: string; durationMs?: number } =>
          entry !== null &&
          typeof entry === 'object' &&
          typeof (entry as { at?: unknown }).at === 'number' &&
          typeof (entry as { layer?: unknown }).layer === 'string' &&
          typeof (entry as { op?: unknown }).op === 'string',
      ),
    }
  } catch {
    return undefined
  }
}

function migrateLegacyLocalStorage(): void {
  if (legacyMigrated) {
    return
  }
  legacyMigrated = true
  if (typeof localStorage === 'undefined') {
    return
  }
  try {
    const live = readLegacySnapshot(LEGACY_LIVE_KEY)
    const residual = readLegacySnapshot(LEGACY_RESIDUAL_KEY)
    const newest =
      residual !== undefined && (live === undefined || residual.savedAt >= live.savedAt)
        ? residual
        : live
    if (newest !== undefined && newest.entries.length > 0) {
      ensureWorker()
      postToWorker({
        type: 'import-residual',
        savedAt: newest.savedAt,
        entries: newest.entries.map((entry, index) => ({
          id: index + 1,
          at: entry.at,
          layer: entry.layer as SystemDebugLogLayer,
          op: entry.op,
          detail: entry.detail,
          durationMs: entry.durationMs,
        })),
      })
    }
    localStorage.removeItem(LEGACY_LIVE_KEY)
    localStorage.removeItem(LEGACY_RESIDUAL_KEY)
  } catch {
    // ignore
  }
}

/**
 * main.tsx 最早调用：按开关起 Worker、挂 pong、监听设置变化、迁移旧快照。
 * 之后界面与埋点都只经过本模块，不再直接碰 localStorage 正文。
 */
export function initSystemDebugLogBridge(): void {
  if (bridgeInitialized || typeof window === 'undefined') {
    return
  }
  bridgeInitialized = true
  window.addEventListener(SYSTEM_DEBUG_LOG_SETTINGS_CHANGED_EVENT, () => {
    const enabled = isSystemDebugLogEnabled()
    if (enabled) {
      ensureWorker()
      postToWorker({ type: 'set-enabled', enabled: true })
    } else if (workerHandle !== undefined) {
      workerHandle.worker.postMessage({ type: 'set-enabled', enabled: false })
    }
  })
  // 整页卸载前尽力补一次落盘（Worker 随页死，落盘是唯一幸存通道）
  window.addEventListener('pagehide', () => {
    if (workerHandle?.ready === true) {
      workerHandle.worker.postMessage({ type: 'flush' })
    }
  })
  if (isSystemDebugLogEnabled()) {
    ensureWorker()
    postToWorker({ type: 'set-enabled', enabled: true })
  }
  migrateLegacyLocalStorage()
}
