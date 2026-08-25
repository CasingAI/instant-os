/// <reference lib="webworker" />

/**
 * 系统诊断日志 Dedicated Worker（黑匣子）。
 *
 * - 拥有独立事件循环：主线程冻住时，本 Worker 仍能收消息、判心跳、落盘；
 * - 双环（时间线/热路径）+ 计数器：对象 → 字符串只在这里做；
 * - 心跳：ping 主线程，连续无 pong → 时间线记「主线程未响应」并立即把
 *   两环 + 计数器写入独立 IndexedDB（不依赖冻住的页面回消息）；
 * - 落盘只有覆盖写快照（live + previous + 最近若干份未响应），自带死上限；
 * - 处理不过来就丢弃并计数，永远不反向阻塞主线程业务。
 */

import {
  MainThreadHeartbeatMonitor,
  SystemDebugLogRecorder,
  stringifySystemDebugDetail,
  type HeartbeatHost,
  type SystemDebugLogLayer,
  type SystemDebugLogSnapshot,
  type SystemDebugLogSnapshotKind,
} from './system-debug-log-core.ts'
import type { SystemDebugLogMainMessage, SystemDebugLogWorkerMessage } from './system-debug-log-protocol.ts'
import {
  clearSystemDebugStore,
  deleteSystemDebugSnapshot,
  estimateSystemDebugStoreBytes,
  getAllSystemDebugSnapshots,
  openSystemDebugLogDb,
  putSystemDebugSnapshot,
  UNRESPONSIVE_SNAPSHOT_LIMIT,
  type StoredSystemDebugSnapshot,
} from './system-debug-log-idb.ts'

const LIVE_KEY = 'live'
const PREVIOUS_KEY = 'previous'
const LEGACY_KEY = 'legacy'
const UNRESPONSIVE_KEY_PREFIX = 'unres-'

/** 平时节流覆盖写 live（量级沿用旧实现的约 1.5 秒） */
const LIVE_FLUSH_MIN_INTERVAL_MS = 1500
const LIVE_FLUSH_MIN_NEW_ENTRIES = 8
const NOTIFY_THROTTLE_MS = 1000
/** 启动时 live 快照超过该时限没有更新，视为上个会话（或其它标签已死）留下 */
const STALE_LIVE_MS = 20_000

const recorder = new SystemDebugLogRecorder()

let enabled = false
let db: IDBDatabase | undefined
let dbOpenPromise: Promise<void> | undefined
let residual: SystemDebugLogSnapshot | undefined
let persistFailureCount = 0

let dirtyEntries = 0
let lastLiveFlushAt = 0
let liveFlushTimer: ReturnType<typeof setTimeout> | undefined
let notifyTimer: ReturnType<typeof setTimeout> | undefined
let pingTimer: ReturnType<typeof setTimeout> | undefined
let heartbeat: MainThreadHeartbeatMonitor | undefined

function post(message: SystemDebugLogWorkerMessage): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message)
}

function now(): number {
  return Date.now()
}

// ---------------------------------------------------------------- 持久化

function snapshotToStored(snapshot: SystemDebugLogSnapshot): StoredSystemDebugSnapshot {
  return { key: '', ...snapshot }
}

async function withDb(work: (database: IDBDatabase) => Promise<void>): Promise<void> {
  if (db === undefined) {
    dbOpenPromise ??= (async () => {
      db = await openSystemDebugLogDb()
    })()
    await dbOpenPromise
  }
  if (db === undefined) {
    return
  }
  await work(db)
}

async function persistSnapshot(kind: SystemDebugLogSnapshotKind, note?: string): Promise<void> {
  const snapshot = recorder.makeSnapshot(kind, now(), note)
  const stored = snapshotToStored(snapshot)
  try {
    await withDb(async (database) => {
      if (kind === 'unresponsive') {
        stored.key = `${UNRESPONSIVE_KEY_PREFIX}${snapshot.savedAt}`
        const existing = await getAllSystemDebugSnapshots(database)
        const unresponsiveKeys = existing
          .filter((item) => item.key.startsWith(UNRESPONSIVE_KEY_PREFIX))
          .sort((a, b) => a.savedAt - b.savedAt)
          .map((item) => item.key)
        // 只保留最近若干份未响应快照，覆盖最旧
        while (unresponsiveKeys.length >= UNRESPONSIVE_SNAPSHOT_LIMIT) {
          await deleteSystemDebugSnapshot(database, unresponsiveKeys.shift()!)
        }
      } else {
        stored.key = kind === 'live' ? LIVE_KEY : kind === 'previous' ? PREVIOUS_KEY : LEGACY_KEY
      }
      await putSystemDebugSnapshot(database, stored)
    })
  } catch {
    persistFailureCount += 1
    // 写失败：丢弃本轮落盘并计数；绝不在主线程重试，也不打断故障现场
  }
}

function scheduleLiveFlush(): void {
  if (!enabled || liveFlushTimer !== undefined) {
    return
  }
  liveFlushTimer = setTimeout(() => {
    liveFlushTimer = undefined
    void maybeFlushLive()
  }, LIVE_FLUSH_MIN_INTERVAL_MS)
}

async function maybeFlushLive(force = false): Promise<void> {
  if (!enabled && !force) {
    return
  }
  const nowMs = now()
  if (
    !force &&
    (dirtyEntries < LIVE_FLUSH_MIN_NEW_ENTRIES ||
      nowMs - lastLiveFlushAt < LIVE_FLUSH_MIN_INTERVAL_MS)
  ) {
    return
  }
  dirtyEntries = 0
  lastLiveFlushAt = nowMs
  await persistSnapshot('live')
}

// ---------------------------------------------------------------- 通知界面

function scheduleNotify(): void {
  if (notifyTimer !== undefined) {
    return
  }
  notifyTimer = setTimeout(() => {
    notifyTimer = undefined
    post({ type: 'changed' })
  }, NOTIFY_THROTTLE_MS)
}

// ---------------------------------------------------------------- 心跳

const heartbeatHost: HeartbeatHost = {
  now,
  sendPing(seq: number): void {
    post({ type: 'ping', seq })
  },
  onUnresponsive(info: { sinceLastPongMs: number; missedPings: number }): void {
    const lastEntry = [...recorder.getTimeline(), ...recorder.getHot()].at(-1)
    const detail = `无 pong ${Math.round(info.sinceLastPongMs / 100) / 10}s，丢 ping=${info.missedPings}` +
      (lastEntry !== undefined ? `，最后一条日志 ${lastEntry.layer}:${lastEntry.op}` : '')
    recorder.recordTimeline(
      { layer: 'system', op: 'main-thread-unresponsive', detail },
      now(),
    )
    // 不等节流：两环 + 计数器立即落盘，未响应快照另存一份
    dirtyEntries = 0
    lastLiveFlushAt = now()
    void persistSnapshot('unresponsive', detail)
    void persistSnapshot('live')
    scheduleNotify()
  },
  onRecover(info: { unresponsiveMs: number; missedPings: number }): void {
    recorder.recordTimeline(
      {
        layer: 'system',
        op: 'main-thread-recovered',
        detail: `未响应 ${Math.round(info.unresponsiveMs / 100) / 10}s，期间丢 ping=${info.missedPings}`,
      },
      now(),
    )
    void maybeFlushLive(true)
    scheduleNotify()
  },
}

function schedulePing(): void {
  if (heartbeat === undefined) {
    return
  }
  const delay = heartbeat.tick()
  pingTimer = setTimeout(schedulePing, delay)
}

function startHeartbeat(): void {
  if (heartbeat !== undefined) {
    return
  }
  heartbeat = new MainThreadHeartbeatMonitor(heartbeatHost)
  schedulePing()
}

function stopHeartbeat(): void {
  if (pingTimer !== undefined) {
    clearTimeout(pingTimer)
    pingTimer = undefined
  }
  heartbeat = undefined
}

// ---------------------------------------------------------------- 启动：读取残留 + 抬升 stale live

function storedToSnapshot(stored: StoredSystemDebugSnapshot): SystemDebugLogSnapshot {
  return {
    savedAt: stored.savedAt,
    kind: stored.kind,
    timeline: stored.timeline.map((entry) => ({
      ...entry,
      layer: entry.layer as SystemDebugLogLayer,
    })),
    hot: stored.hot.map((entry) => ({ ...entry, layer: entry.layer as SystemDebugLogLayer })),
    counters: stored.counters,
    note: stored.note,
  }
}

async function loadResidualOnBoot(): Promise<void> {
  try {
    await withDb(async (database) => {
      const snapshots = await getAllSystemDebugSnapshots(database)
      const live = snapshots.find((item) => item.key === LIVE_KEY)
      const nowMs = now()
      if (live !== undefined && nowMs - live.savedAt > STALE_LIVE_MS) {
        // 上个会话（标签被杀 / 未正常关闭）留下的 live：抬升为 previous
        const promoted: StoredSystemDebugSnapshot = { ...live, key: PREVIOUS_KEY, kind: 'previous' }
        await putSystemDebugSnapshot(database, promoted)
        await deleteSystemDebugSnapshot(database, LIVE_KEY)
        snapshots.push(promoted)
      }
      const candidates = snapshots
        .filter((item) => item.key !== LIVE_KEY)
        .sort((a, b) => b.savedAt - a.savedAt)
      residual = candidates[0] !== undefined ? storedToSnapshot(candidates[0]) : undefined
    })
  } catch {
    residual = undefined
  }
}

// ---------------------------------------------------------------- 消息处理

async function handleMessage(message: SystemDebugLogMainMessage): Promise<void> {
  switch (message.type) {
    case 'set-enabled': {
      if (message.enabled === enabled) {
        return
      }
      enabled = message.enabled
      if (enabled) {
        recorder.recordTimeline(
          { layer: 'system', op: 'diagnostics-enabled' },
          now(),
        )
        startHeartbeat()
        void maybeFlushLive(true)
      } else {
        recorder.recordTimeline(
          { layer: 'system', op: 'diagnostics-disabled' },
          now(),
        )
        stopHeartbeat()
        // 关闭：停心跳、停常规写库；最后补一次快照后不再主动落盘
        if (liveFlushTimer !== undefined) {
          clearTimeout(liveFlushTimer)
          liveFlushTimer = undefined
        }
        dirtyEntries = 0
        await persistSnapshot('live')
      }
      scheduleNotify()
      return
    }
    case 'entry': {
      const detail = stringifySystemDebugDetail(message.detail)
      if (message.ring === 'timeline') {
        recorder.recordTimeline(
          {
            layer: message.layer,
            op: message.op,
            detail,
            durationMs: message.durationMs,
            at: message.at,
          },
          now(),
        )
      } else {
        recorder.recordHot(
          {
            layer: message.layer,
            op: message.op,
            detail,
            durationMs: message.durationMs,
            at: message.at,
          },
          now(),
        )
      }
      if (message.countDelta > 1) {
        recorder.addCountDelta(
          message.layer,
          message.op,
          message.countDelta - 1,
          undefined,
          now(),
        )
      }
      dirtyEntries += 1
      scheduleLiveFlush()
      scheduleNotify()
      return
    }
    case 'pong': {
      heartbeat?.notifyPong()
      return
    }
    case 'flush': {
      await maybeFlushLive(true)
      return
    }
    case 'request-current': {
      post({
        type: 'current',
        requestId: message.requestId,
        view: {
          enabled,
          timeline: recorder.getTimeline(),
          hot: recorder.getHot(),
          counters: recorder.getCounters(),
          mainThreadUnresponsive: heartbeat?.isUnresponsive() ?? false,
        },
      })
      return
    }
    case 'request-residual': {
      post({ type: 'residual', requestId: message.requestId, snapshot: residual })
      return
    }
    case 'request-stats': {
      let bytes = 0
      let snapshots = 0
      try {
        await withDb(async (database) => {
          bytes = await estimateSystemDebugStoreBytes(database)
          snapshots = (await getAllSystemDebugSnapshots(database)).length
        })
      } catch {
        bytes = 0
      }
      post({
        type: 'stats',
        requestId: message.requestId,
        stats: { bytes, snapshots, persistFailures: persistFailureCount },
      })
      return
    }
    case 'clear-current': {
      recorder.clear()
      dirtyEntries = 0
      try {
        await withDb((database) => deleteSystemDebugSnapshot(database, LIVE_KEY))
      } catch {
        // ignore
      }
      scheduleNotify()
      return
    }
    case 'clear-all': {
      recorder.clear()
      residual = undefined
      dirtyEntries = 0
      try {
        await withDb((database) => clearSystemDebugStore(database))
      } catch {
        // ignore
      }
      scheduleNotify()
      return
    }
    case 'dismiss-residual': {
      residual = undefined
      try {
        await withDb(async (database) => {
          const snapshots = await getAllSystemDebugSnapshots(database)
          for (const item of snapshots) {
            if (item.key !== LIVE_KEY) {
              await deleteSystemDebugSnapshot(database, item.key)
            }
          }
        })
      } catch {
        // ignore
      }
      scheduleNotify()
      return
    }
    case 'import-residual': {
      const imported: SystemDebugLogSnapshot = {
        savedAt: message.savedAt,
        kind: 'legacy',
        timeline: [],
        hot: message.entries.map((entry) => ({ ...entry, layer: entry.layer as SystemDebugLogLayer })),
        counters: {},
      }
      try {
        await withDb((database) => {
          const stored = snapshotToStored(imported)
          stored.key = LEGACY_KEY
          return putSystemDebugSnapshot(database, stored)
        })
        if (residual === undefined || residual.savedAt < imported.savedAt) {
          residual = imported
        }
      } catch {
        // ignore
      }
      scheduleNotify()
      return
    }
  }
}

self.onmessage = (event: MessageEvent<SystemDebugLogMainMessage>) => {
  const message = event.data
  if (!message || typeof message !== 'object') {
    return
  }
  void handleMessage(message).catch(() => {
    // Worker 内处理失败不影响主线程业务
  })
}

void loadResidualOnBoot().finally(() => {
  post({ type: 'worker-ready' })
})
