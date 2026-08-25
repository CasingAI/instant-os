/**
 * 系统诊断日志主线程 ↔ Worker 消息协议。
 * 主线程只发短字段（结构化克隆发生在主线程，见方案 4.4）；
 * detail 允许浅对象，序列化只在 Worker 里做。
 */
import type {
  SystemDebugCounters,
  SystemDebugLogEntry,
  SystemDebugLogLayer,
  SystemDebugLogSnapshot,
} from './system-debug-log-core.ts'

export type SystemDebugLogEntryMessage = {
  type: 'entry'
  ring: 'timeline' | 'hot'
  layer: SystemDebugLogLayer
  op: string
  detail?: string | Record<string, unknown>
  durationMs?: number
  at?: number
  /** 本条消息携带的埋点次数（含被采样丢弃、只计数部分） */
  countDelta: number
}

export type SystemDebugLogMainMessage =
  | SystemDebugLogEntryMessage
  | { type: 'set-enabled'; enabled: boolean }
  | { type: 'pong'; seq: number }
  | { type: 'flush' }
  | { type: 'request-current'; requestId: number }
  | { type: 'request-residual'; requestId: number }
  | { type: 'request-stats'; requestId: number }
  | { type: 'clear-current' }
  | { type: 'clear-all' }
  | { type: 'dismiss-residual' }
  | { type: 'import-residual'; savedAt: number; entries: SystemDebugLogEntry[] }

export type SystemDebugLogCurrentView = {
  enabled: boolean
  timeline: SystemDebugLogEntry[]
  hot: SystemDebugLogEntry[]
  counters: SystemDebugCounters
  /** 主线程心跳当前是否处于「未响应」判定 */
  mainThreadUnresponsive: boolean
}

export type SystemDebugLogStats = {
  bytes: number
  snapshots: number
  /** Worker 侧 IndexedDB 写入失败次数 */
  persistFailures: number
}

export type SystemDebugLogWorkerMessage =
  | { type: 'worker-ready' }
  | { type: 'ping'; seq: number }
  | { type: 'changed' }
  | { type: 'current'; requestId: number; view: SystemDebugLogCurrentView }
  | { type: 'residual'; requestId: number; snapshot: SystemDebugLogSnapshot | undefined }
  | { type: 'stats'; requestId: number; stats: SystemDebugLogStats }
  | { type: 'error'; message: string }
