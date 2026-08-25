/**
 * 系统诊断日志核心纯逻辑：字符串化 + 时间线/热路径双环 + 计数器 + 主线程心跳状态机。
 *
 * 约束（见 todo/system-debug-log-worker.md）：
 * - 本文件不得触碰 DOM / IndexedDB / localStorage，供诊断 Worker 与单测共用。
 * - 落盘与展示只存字符串行；对象 → 字符串仅在 Worker 侧做（本模块提供工具）。
 * - 时间线环记录生命周期事件，禁止被热路径风暴冲掉。
 * - 序列化必须有死规矩：限深、限键数、限总长，循环引用换占位，绝不抛到业务里。
 */

export type SystemDebugLogLayer =
  | 'npm'
  | 'qjs'
  | 'qjs-fs'
  | 'vfs-resolve'
  | 'require'
  | 'vm'
  | 'files'
  | 'system'

export type SystemDebugLogEntry = {
  id: number
  at: number
  layer: SystemDebugLogLayer
  op: string
  detail?: string
  durationMs?: number
  /** 短窗口内重复合并：同 layer+op+detail 连续出现 ×N */
  repeat?: number
}

export type SystemDebugCounter = {
  /** 埋点被碰到的总次数（含未进环的采样丢弃） */
  count: number
  /** 进环条数 */
  entries: number
  /** 因限速被丢弃的条数 */
  dropped: number
  totalMs: number
  slowestMs: number
  lastAt: number
}

export type SystemDebugCounters = Record<string, SystemDebugCounter>

export type SystemDebugLogSnapshotKind = 'live' | 'previous' | 'unresponsive' | 'legacy'

/** 落盘快照：正文全部是已处理好的字符串行 */
export type SystemDebugLogSnapshot = {
  savedAt: number
  kind: SystemDebugLogSnapshotKind
  timeline: SystemDebugLogEntry[]
  hot: SystemDebugLogEntry[]
  counters: SystemDebugCounters
  /** 如「主线程未响应」的补充说明 */
  note?: string
}

export const TIMELINE_RING_CAPACITY = 128
export const HOT_RING_CAPACITY = 1024

const DETAIL_MAX_LENGTH = 600
const MERGE_WINDOW_MS = 1500
/** 每层每秒进环条数封顶；超出只加 dropped 计数（日志系统过载本身是诊断信号） */
const HOT_LAYER_RATE_PER_SEC = 240
const TIMELINE_LAYER_RATE_PER_SEC = 60

/** 路径只保留末 3 段，控制体积（调用方在拼 detail 前使用） */
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

export function truncateDebugText(text: string, maxLength = DETAIL_MAX_LENGTH): string {
  if (text.length <= maxLength) {
    return text
  }
  const suffix = `…(${text.length})`
  return `${text.slice(0, Math.max(1, maxLength - suffix.length))}${suffix}`
}

/** 对象序列化的死规矩：限深、限键、限数组长度、限总字符 */
function stringifyValue(
  value: unknown,
  budget: { left: number },
  depth: number,
  seen: Set<object>,
): string {
  if (value === null) {
    return 'null'
  }
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value.length > 200 ? `${value.slice(0, 200)}…` : value)
    case 'number':
      return Number.isFinite(value) ? String(value) : String(value)
    case 'boolean':
      return String(value)
    case 'bigint':
      return `${value}n`
    case 'undefined':
      return 'undefined'
    case 'function':
      return '[function]'
    case 'symbol':
      return '[symbol]'
    case 'object':
      break
  }
  const obj = value as object
  if (seen.has(obj)) {
    return '[Circular]'
  }
  if (obj instanceof Error) {
    return truncateDebugText(`${obj.name}: ${obj.message}`)
  }
  if (depth >= 3) {
    return Array.isArray(obj) ? '[…]' : '{…}'
  }
  seen.add(obj)
  try {
    if (Array.isArray(obj)) {
      const parts: string[] = []
      for (let i = 0; i < obj.length && i < 8 && budget.left > 0; i++) {
        const part = stringifyValue(obj[i], budget, depth + 1, seen)
        budget.left -= part.length
        parts.push(part)
      }
      if (obj.length > 8) {
        parts.push(`…+${obj.length - 8}`)
      }
      return `[${parts.join(',')}]`
    }
    const keys = Object.keys(obj as Record<string, unknown>).slice(0, 12)
    const parts: string[] = []
    for (const key of keys) {
      if (budget.left <= 0) {
        parts.push('…')
        break
      }
      let member: unknown
      try {
        member = (obj as Record<string, unknown>)[key]
      } catch {
        member = '[getter throw]'
      }
      const part = `${key}: ${stringifyValue(member, budget, depth + 1, seen)}`
      budget.left -= part.length
      parts.push(part)
    }
    const keyCount = Object.keys(obj as Record<string, unknown>).length
    if (keyCount > 12) {
      parts.push(`…+${keyCount - 12} keys`)
    }
    return `{${parts.join(', ')}}`
  } finally {
    seen.delete(obj)
  }
}

/** 埋点 detail：字符串原样（超长截断），浅对象安全序列化，绝不抛出 */
export function stringifySystemDebugDetail(
  value: string | Record<string, unknown> | undefined,
  maxLength = DETAIL_MAX_LENGTH,
): string | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value === 'string') {
    return truncateDebugText(value, maxLength)
  }
  if (typeof value === 'object') {
    try {
      return truncateDebugText(stringifyValue(value, { left: maxLength }, 0, new Set()), maxLength)
    } catch {
      return '[unserializable]'
    }
  }
  return truncateDebugText(String(value), maxLength)
}

export function formatSystemDebugLogLines(entries: readonly SystemDebugLogEntry[]): string {
  return entries
    .map((entry) => {
      const time = new Date(entry.at).toISOString()
      const dur = entry.durationMs !== undefined ? ` ${entry.durationMs}ms` : ''
      const repeat = entry.repeat !== undefined && entry.repeat > 1 ? ` ×${entry.repeat}` : ''
      const detail = entry.detail ? ` ${entry.detail}` : ''
      return `${time} [${entry.layer}] ${entry.op}${dur}${repeat}${detail}`
    })
    .join('\n')
}

/** 每层令牌桶限速：风暴时宁可丢弃并计数，也不让环被同层刷光 */
class LayerRateLimiter {
  private buckets = new Map<string, { tokens: number; refilledAt: number }>()

  allow(key: string, perSec: number, now: number): boolean {
    let bucket = this.buckets.get(key)
    if (bucket === undefined) {
      bucket = { tokens: perSec, refilledAt: now }
      this.buckets.set(key, bucket)
    }
    const elapsed = Math.max(0, now - bucket.refilledAt)
    if (elapsed > 0) {
      bucket.tokens = Math.min(perSec, bucket.tokens + (elapsed / 1000) * perSec)
      bucket.refilledAt = now
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return true
    }
    return false
  }
}

export type RecordEntryParams = {
  layer: SystemDebugLogLayer
  op: string
  detail?: string
  durationMs?: number
  at?: number
}

/**
 * 双环记录器。只在诊断 Worker（或单测）里跑，主线程不实例化。
 */
export class SystemDebugLogRecorder {
  private timeline: SystemDebugLogEntry[] = []
  private hot: SystemDebugLogEntry[] = []
  private counters = new Map<string, SystemDebugCounter>()
  private limiter = new LayerRateLimiter()
  private nextId = 1

  private bumpCounter(
    layer: SystemDebugLogLayer,
    op: string,
    delta: { count?: number; entries?: number; dropped?: number; ms?: number },
    now: number,
  ): void {
    const key = `${layer}:${op}`
    let counter = this.counters.get(key)
    if (counter === undefined) {
      counter = { count: 0, entries: 0, dropped: 0, totalMs: 0, slowestMs: 0, lastAt: now }
      this.counters.set(key, counter)
    }
    if (delta.count !== undefined) {
      counter.count += delta.count
    }
    if (delta.entries !== undefined) {
      counter.entries += delta.entries
    }
    if (delta.dropped !== undefined) {
      counter.dropped += delta.dropped
    }
    if (delta.ms !== undefined && delta.ms > 0) {
      counter.totalMs += delta.ms
      if (delta.ms > counter.slowestMs) {
        counter.slowestMs = delta.ms
      }
    }
    counter.lastAt = now
  }

  /** 时间线：生命周期事件，低频，几乎不采样；热路径禁止写入 */
  recordTimeline(params: RecordEntryParams, now: number): void {
    const at = params.at ?? now
    if (!this.limiter.allow(`t:${params.layer}`, TIMELINE_LAYER_RATE_PER_SEC, now)) {
      this.bumpCounter(params.layer, params.op, { count: 1, dropped: 1 }, at)
      return
    }
    this.timeline.push({
      id: this.nextId++,
      at,
      layer: params.layer,
      op: params.op,
      detail: params.detail,
      durationMs: params.durationMs,
    })
    if (this.timeline.length > TIMELINE_RING_CAPACITY) {
      this.timeline.splice(0, this.timeline.length - TIMELINE_RING_CAPACITY)
    }
    this.bumpCounter(params.layer, params.op, { count: 1, entries: 1, ms: params.durationMs }, at)
  }

  /** 热路径：短窗口重复合并 + 每层限速；被丢弃/合并仍然计数 */
  recordHot(params: RecordEntryParams, now: number): void {
    const at = params.at ?? now
    const last = this.hot[this.hot.length - 1]
    if (
      last !== undefined &&
      last.layer === params.layer &&
      last.op === params.op &&
      last.detail === params.detail &&
      at - last.at <= MERGE_WINDOW_MS
    ) {
      last.repeat = (last.repeat ?? 1) + 1
      if (params.durationMs !== undefined && params.durationMs > (last.durationMs ?? 0)) {
        last.durationMs = params.durationMs
      }
      this.bumpCounter(params.layer, params.op, { count: 1, ms: params.durationMs }, at)
      return
    }
    if (!this.limiter.allow(`h:${params.layer}`, HOT_LAYER_RATE_PER_SEC, now)) {
      this.bumpCounter(params.layer, params.op, { count: 1, dropped: 1 }, at)
      return
    }
    this.hot.push({
      id: this.nextId++,
      at,
      layer: params.layer,
      op: params.op,
      detail: params.detail,
      durationMs: params.durationMs,
    })
    if (this.hot.length > HOT_RING_CAPACITY) {
      this.hot.splice(0, this.hot.length - HOT_RING_CAPACITY)
    }
    this.bumpCounter(params.layer, params.op, { count: 1, entries: 1, ms: params.durationMs }, at)
  }

  /** 只加计数不进环（主线程批量发来的采样丢弃 delta） */
  addCountDelta(
    layer: SystemDebugLogLayer,
    op: string,
    count: number,
    slowestMs: number | undefined,
    now: number,
  ): void {
    this.bumpCounter(layer, op, { count, ms: slowestMs }, now)
  }

  clear(): void {
    this.timeline = []
    this.hot = []
    this.counters.clear()
    this.nextId = 1
  }

  getTimeline(): SystemDebugLogEntry[] {
    return this.timeline.slice()
  }

  getHot(): SystemDebugLogEntry[] {
    return this.hot.slice()
  }

  getCounters(): SystemDebugCounters {
    const record: SystemDebugCounters = {}
    for (const [key, counter] of this.counters) {
      record[key] = { ...counter }
    }
    return record
  }

  makeSnapshot(kind: SystemDebugLogSnapshotKind, now: number, note?: string): SystemDebugLogSnapshot {
    return {
      savedAt: now,
      kind,
      timeline: this.getTimeline(),
      hot: this.getHot(),
      counters: this.getCounters(),
      note,
    }
  }
}

export type HeartbeatMonitorOptions = {
  pingIntervalMs: number
  slowPingIntervalMs: number
  unresponsiveAfterMs: number
}

export type HeartbeatHost = {
  now(): number
  sendPing(seq: number): void
  /** 判定整页主线程未响应（连续 ping 无 pong） */
  onUnresponsive(info: { sinceLastPongMs: number; missedPings: number }): void
  /** 主线程恢复响应 */
  onRecover(info: { unresponsiveMs: number; missedPings: number }): void
}

/**
 * 主线程心跳状态机：Worker 侧驱动，tick() 返回下次 tick 的间隔。
 * 判据是「回不了 pong」：ping 能进主线程队列，但卡死时处理不了（见方案 3.3）。
 * 可注入时钟与收发函数，便于单测。
 */
export class MainThreadHeartbeatMonitor {
  private seq = 0
  private lastPongAt: number
  private unresponsiveSince: number | undefined
  private missedPings = 0
  private readonly host: HeartbeatHost
  private readonly options: HeartbeatMonitorOptions

  constructor(
    host: HeartbeatHost,
    options?: HeartbeatMonitorOptions,
  ) {
    this.host = host
    this.options = options ?? {
      pingIntervalMs: 2000,
      slowPingIntervalMs: 4000,
      unresponsiveAfterMs: 5000,
    }
    this.lastPongAt = host.now()
  }

  notifyPong(): void {
    const now = this.host.now()
    if (this.unresponsiveSince !== undefined) {
      this.host.onRecover({
        unresponsiveMs: now - this.unresponsiveSince,
        missedPings: this.missedPings,
      })
      this.unresponsiveSince = undefined
      this.missedPings = 0
    }
    this.lastPongAt = now
  }

  /** 发一次 ping 并做超时判定；返回距下次 tick 的毫秒数 */
  tick(): number {
    const now = this.host.now()
    this.seq += 1
    this.host.sendPing(this.seq)
    if (this.unresponsiveSince === undefined) {
      if (now - this.lastPongAt >= this.options.unresponsiveAfterMs) {
        this.unresponsiveSince = this.lastPongAt
        this.missedPings = 1
        this.host.onUnresponsive({
          sinceLastPongMs: now - this.lastPongAt,
          missedPings: this.missedPings,
        })
      }
    } else {
      this.missedPings += 1
    }
    return this.unresponsiveSince === undefined
      ? this.options.pingIntervalMs
      : this.options.slowPingIntervalMs
  }

  isUnresponsive(): boolean {
    return this.unresponsiveSince !== undefined
  }
}
