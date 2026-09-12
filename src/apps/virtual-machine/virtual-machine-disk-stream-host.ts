import { filesReadBlobRange, filesStat, filesWriteBytesRange } from '../files/files-api.ts'
import { openQuietBlobWriter } from '../files/files-quiet-blob-write.ts'
import { openMountRangeWriter } from '../files/files-location-mount.ts'
import {
  openDiskOverlayStore,
  replayDiskOverlayStore,
  writeDiskOverlaySnapshot,
  type DiskOverlayStore,
} from './virtual-machine-disk-overlay-store.ts'
import {
  countSystemDebugHot,
  recordSystemDebugHot,
  recordSystemDebugTimeline,
} from '../../os/system-debug-log.ts'
import {
  recordVmDiskStreamIo,
  releaseVmDiskStreamMetrics,
} from './virtual-machine-disk-stream-metrics.ts'
import {
  INSTANT_VM_DISK_RANGE_MAX_BYTES,
  INSTANT_VM_MESSAGE_TYPE,
  isInstantVmDiskReadMessage,
  isInstantVmDiskWriteMessage,
  type InstantVmDiskReadResultMessage,
  type InstantVmDiskWriteResultMessage,
} from './virtual-machine-protocol.ts'
import { getVmRuntimeOrigin } from './virtual-machine-runtime-config.ts'

type StreamEntry = {
  path: string
  size: number
  writable: boolean
  /** 差量写入隐藏耐久层；false 时只留在内存，关机丢弃。 */
  persist: boolean
  /** 关机时把差量并进可见镜像。带快照启动为 false，避免改底盘。 */
  mergeOnRelease: boolean
  snapshotPath?: string
  overlayStore?: DiskOverlayStore
}

export const OVERLAY_FLUSH_INTERVAL_MS = 50
export const OVERLAY_FLUSH_DIRTY_BYTES = 256 * 1024
export const OVERLAY_HIGH_WATER_BYTES = 4 * 1024 * 1024
export const OVERLAY_LOW_WATER_BYTES = 1024 * 1024

export type OverlayPersistSink = {
  append: (offset: number, bytes: Uint8Array) => Promise<void>
  flush: () => Promise<void>
}

export type OverlayFlusher = {
  afterWrite: () => void
  acknowledgeGuestWrite: () => Promise<void>
  flushUntilEmpty: () => Promise<void>
}

type DirtyRun = {
  offset: number
  bytes: Uint8Array
}

const streams = new Map<string, StreamEntry>()
const streamWorkTails = new Map<string, Promise<void>>()
let listenerInstalled = false

export function enqueueStreamWork<T>(streamId: string, work: () => Promise<T>): Promise<T> {
  const previous = streamWorkTails.get(streamId) ?? Promise.resolve()
  const current = previous.then(work, work)
  streamWorkTails.set(
    streamId,
    current.then(
      () => undefined,
      () => undefined,
    ),
  )
  return current
}

function runtimeOrigins(): string[] {
  const configured = getVmRuntimeOrigin()
  try {
    const url = new URL(configured)
    const origins = new Set<string>([url.origin])
    if (url.hostname === 'localhost') {
      origins.add(`${url.protocol}//127.0.0.1${url.port ? `:${url.port}` : ''}`)
    } else if (url.hostname === '127.0.0.1') {
      origins.add(`${url.protocol}//localhost${url.port ? `:${url.port}` : ''}`)
    }
    return [...origins]
  } catch {
    return [configured]
  }
}

export function isRuntimeOrigin(origin: string): boolean {
  return runtimeOrigins().includes(origin)
}

/**
 * 成功的范围读一律 206。v86 对带 Range 的请求收到 200 会当成整文件回传并 abort。
 */
export function diskReadReplyStatus(
  entry: Pick<StreamEntry, 'size'> | undefined,
  offset: number,
  length: number,
): number {
  if (!entry) {
    return 404
  }
  if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(length) || length < 0) {
    return 416
  }
  if (offset >= entry.size) {
    return 416
  }
  return 206
}

export function diskWriteReplyStatus(
  entry: Pick<StreamEntry, 'size' | 'writable'> | undefined,
  offset: number,
  byteLength: number,
): number {
  if (!entry) {
    return 404
  }
  if (!entry.writable) {
    return 403
  }
  if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(byteLength) || byteLength <= 0) {
    return 416
  }
  if (byteLength > INSTANT_VM_DISK_RANGE_MAX_BYTES) {
    return 413
  }
  if (offset >= entry.size || offset + byteLength > entry.size) {
    return 416
  }
  return 200
}

export class DirtyOverlay {
  private runs: DirtyRun[] = []
  private totalDirtyBytes = 0

  /** 合并重叠或相邻的 run，返回合并后的范围 */
  private mergeRuns(startIndex: number, offset: number, bytes: Uint8Array): DirtyRun {
    const end = offset + bytes.byteLength
    const runs = this.runs
    const first = runs[startIndex]!
    let newStart = Math.min(first.offset, offset)
    let newEnd = Math.max(first.offset + first.bytes.byteLength, end)
    let merged = new Uint8Array(newEnd - newStart)
    merged.set(first.bytes, first.offset - newStart)
    merged.set(bytes, offset - newStart)

    let j = startIndex + 1
    while (j < runs.length) {
      const next = runs[j]!
      if (next.offset > newEnd) break
      const nextEnd = Math.max(newEnd, next.offset + next.bytes.byteLength)
      if (nextEnd > merged.byteLength) {
        const grown = new Uint8Array(nextEnd - newStart)
        grown.set(merged)
        grown.set(next.bytes, next.offset - newStart)
        merged = grown
      } else {
        merged.set(next.bytes, next.offset - newStart)
      }
      newEnd = nextEnd
      j += 1
    }

    this.totalDirtyBytes += merged.byteLength - first.bytes.byteLength
    for (let k = startIndex + 1; k < j; k++) {
      this.totalDirtyBytes -= runs[k]!.bytes.byteLength
    }
    runs.splice(startIndex, j - startIndex, { offset: newStart, bytes: merged })
    return { offset: newStart, bytes: merged }
  }

  write(offset: number, bytes: Uint8Array): void {
    const end = offset + bytes.byteLength
    const runs = this.runs
    let insertIndex = runs.length
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]!
      if (run.offset > end) {
        insertIndex = i
        break
      }
      if (run.offset + run.bytes.byteLength < offset) continue
      // 重叠或相邻：合并
      countSystemDebugHot('vm', 'overlay-merge')
      this.mergeRuns(i, offset, bytes)
      return
    }
    runs.splice(insertIndex, 0, { offset, bytes: new Uint8Array(bytes) })
    this.totalDirtyBytes += bytes.byteLength
    countSystemDebugHot('vm', 'overlay-write')
  }

  /**
   * 从覆盖层读取 [offset, offset+length)。
   * 仅当覆盖层完整覆盖该区间时才返回等长 Uint8Array；否则返回 undefined。
   */
  read(offset: number, length: number): Uint8Array | undefined {
    const end = offset + length
    const out = new Uint8Array(length)
    let cursor = offset
    for (const run of this.runs) {
      if (cursor >= end) break
      if (run.offset >= end) break
      const runEnd = run.offset + run.bytes.byteLength
      if (runEnd <= cursor) continue
      const srcStart = cursor - run.offset
      const srcEnd = Math.min(run.bytes.byteLength, end - run.offset)
      const take = srcEnd - srcStart
      if (take <= 0) continue
      out.set(run.bytes.subarray(srcStart, srcEnd), cursor - offset)
      cursor = run.offset + srcEnd
    }
    if (cursor - offset < length) return undefined
    return out
  }

  runsOverlapping(offset: number, length: number): DirtyRun[] {
    const end = offset + length
    const out: DirtyRun[] = []
    for (const run of this.runs) {
      if (run.offset >= end) break
      const runEnd = run.offset + run.bytes.byteLength
      if (runEnd <= offset) continue
      const srcStart = Math.max(0, offset - run.offset)
      const srcEnd = Math.min(run.bytes.byteLength, end - run.offset)
      out.push({ offset: run.offset + srcStart, bytes: run.bytes.subarray(srcStart, srcEnd) })
    }
    return out
  }

  takeRunsForFlush(maxBytes?: number): DirtyRun[] {
    if (maxBytes === undefined || this.totalDirtyBytes <= maxBytes) {
      const taken = this.runs
      this.runs = []
      this.totalDirtyBytes = 0
      return taken
    }
    let takenBytes = 0
    let cut = 0
    while (cut < this.runs.length && takenBytes < maxBytes) {
      const run = this.runs[cut]!
      if (takenBytes + run.bytes.byteLength > maxBytes && cut > 0) break
      takenBytes += run.bytes.byteLength
      cut += 1
    }
    const taken = this.runs.slice(0, cut)
    this.runs = this.runs.slice(cut)
    this.totalDirtyBytes -= takenBytes
    return taken
  }

  get dirtyBytes(): number {
    return this.totalDirtyBytes
  }

  /** 当前差量段的只读快照，不挪走数据。合并进底盘必须整份成功后再清。 */
  listRuns(): DirtyRun[] {
    return this.runs.map((run) => ({ offset: run.offset, bytes: run.bytes }))
  }

  clear(): void {
    this.runs = []
    this.totalDirtyBytes = 0
  }
}

export const OVERLAY_FLUSH_MAX_ATTEMPTS = 5

/**
 * 把尚未写入耐久差量的段刷进旁路存储。主覆盖层（读路径）全程不剪。
 * 没有 sink 时（不保存）这是空操作。
 */
export function createOverlayFlusher(
  pending: DirtyOverlay,
  sink: OverlayPersistSink | undefined,
  logPath = '',
): OverlayFlusher {
  let timer: ReturnType<typeof setTimeout> | undefined
  let flushPromise: Promise<void> | undefined
  let flushUntilEmptyPromise: Promise<void> | undefined

  function cancelSchedule(): void {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  function schedule(): void {
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      void flushRound()
    }, OVERLAY_FLUSH_INTERVAL_MS)
  }

  async function persistRuns(runs: DirtyRun[]): Promise<void> {
    if (!sink) {
      return
    }
    let processed = 0
    const persistStartedAt = performance.now()
    try {
      for (const run of runs) {
        await sink.append(run.offset, run.bytes)
        processed += 1
      }
      try {
        await sink.flush()
      } catch (error) {
        processed = 0
        throw error
      }
    } catch (error) {
      recordSystemDebugTimeline({
        layer: 'vm',
        op: 'overlay-persist-failed',
        detail: {
          path: logPath,
          runs: runs.length,
          processed,
          error: error instanceof Error ? error.message : String(error),
        },
      })
      for (const run of runs.slice(processed)) {
        pending.write(run.offset, run.bytes)
      }
      throw error
    } finally {
      const durationMs = performance.now() - persistStartedAt
      if (durationMs > 100) {
        recordSystemDebugHot({
          layer: 'vm',
          op: 'overlay-persist-runs',
          detail: `${runs.length} runs ${durationMs.toFixed(0)}ms`,
          durationMs,
          thresholdMs: 100,
        })
      } else {
        countSystemDebugHot('vm', 'overlay-persist-runs', durationMs)
      }
    }
  }

  function flushRound(maxBytes?: number): Promise<void> {
    if (!sink) return Promise.resolve()
    if (flushPromise) return flushPromise
    if (pending.dirtyBytes === 0) return Promise.resolve()
    cancelSchedule()
    const runs = pending.takeRunsForFlush(maxBytes)
    if (runs.length === 0) return Promise.resolve()
    const inflight = persistRuns(runs).finally(() => {
      if (flushPromise === inflight) {
        flushPromise = undefined
      }
    })
    flushPromise = inflight
    return inflight
  }

  async function flushUntilEmpty(): Promise<void> {
    if (!sink) return
    if (flushUntilEmptyPromise) return flushUntilEmptyPromise
    flushUntilEmptyPromise = (async () => {
      const startedAt = performance.now()
      let rounds = 0
      try {
        cancelSchedule()
        if (flushPromise) {
          try {
            await flushPromise
          } catch {
            // 进行中的一轮已把未落段写回 pending，下面按失败次数重试
          }
        }
        let failures = 0
        while (pending.dirtyBytes > 0) {
          rounds += 1
          try {
            await flushRound()
          } catch {
            failures += 1
            if (failures >= OVERLAY_FLUSH_MAX_ATTEMPTS) {
              recordSystemDebugTimeline({
                layer: 'vm',
                op: 'overlay-flush-giveup',
                detail: { path: logPath, rounds, failures },
              })
              throw new Error('覆盖层刷盘失败次数过多，已中止')
            }
          }
        }
        if (rounds > 1) {
          recordSystemDebugHot({
            layer: 'vm',
            op: 'flush-until-empty',
            detail: `${rounds} rounds ${(performance.now() - startedAt).toFixed(0)}ms`,
            durationMs: performance.now() - startedAt,
            thresholdMs: 100,
          })
        }
      } finally {
        flushUntilEmptyPromise = undefined
      }
    })()
    return flushUntilEmptyPromise
  }

  async function flushUntilBelow(limit: number): Promise<void> {
    if (!sink) return
    const startedAt = performance.now()
    cancelSchedule()
    if (flushUntilEmptyPromise) await flushUntilEmptyPromise
    if (flushPromise) await flushPromise
    let rounds = 0
    while (pending.dirtyBytes > limit) {
      rounds += 1
      await flushRound(Math.max(OVERLAY_FLUSH_DIRTY_BYTES, pending.dirtyBytes - limit))
    }
    if (rounds > 0) {
      const durationMs = performance.now() - startedAt
      if (durationMs > 100) {
        recordSystemDebugHot({
          layer: 'vm',
          op: 'flush-backpressure',
          detail: `${rounds} rounds limit=${limit} ${durationMs.toFixed(0)}ms`,
          durationMs,
          thresholdMs: 100,
        })
      } else {
        countSystemDebugHot('vm', 'flush-backpressure', durationMs)
      }
    }
  }

  function afterWrite(): void {
    if (!sink) return
    if (pending.dirtyBytes >= OVERLAY_FLUSH_DIRTY_BYTES) {
      void flushRound()
    } else if (pending.dirtyBytes > 0) {
      schedule()
    }
  }

  async function acknowledgeGuestWrite(): Promise<void> {
    if (!sink) {
      return
    }
    if (pending.dirtyBytes > OVERLAY_HIGH_WATER_BYTES) {
      recordSystemDebugHot({
        layer: 'vm',
        op: 'write-high-water',
        detail: `dirty=${pending.dirtyBytes} limit=${OVERLAY_LOW_WATER_BYTES}`,
      })
      await flushUntilBelow(OVERLAY_LOW_WATER_BYTES)
      return
    }
    afterWrite()
  }

  return { afterWrite, acknowledgeGuestWrite, flushUntilEmpty }
}

async function readDiskRange(
  entry: StreamEntry,
  overlay: DirtyOverlay,
  offset: number,
  length: number,
): Promise<InstantVmDiskReadResultMessage> {
  const startedAt = performance.now()
  try {
    const totalSize = entry.size
    const status = diskReadReplyStatus(entry, offset, length)
    if (status !== 206) {
      return {
        type: INSTANT_VM_MESSAGE_TYPE.diskReadResult,
        requestId: '',
        streamId: '',
        status,
        totalSize,
      }
    }
    const want = Math.min(length, totalSize - offset, INSTANT_VM_DISK_RANGE_MAX_BYTES)

    const overlayBytes = overlay.read(offset, want)
    if (overlayBytes !== undefined) {
      countSystemDebugHot('vm', 'disk-read', performance.now() - startedAt)
      return {
        type: INSTANT_VM_MESSAGE_TYPE.diskReadResult,
        requestId: '',
        streamId: '',
        status,
        totalSize,
        bytes: overlayBytes.buffer.slice(
          overlayBytes.byteOffset,
          overlayBytes.byteOffset + overlayBytes.byteLength,
        ) as ArrayBuffer,
      }
    }
    const runs = overlay.runsOverlapping(offset, want)
    if (runs.length === 0) {
      const blob = await filesReadBlobRange(entry.path, offset, want)
      const bytes = await blob.arrayBuffer()
      const durationMs = performance.now() - startedAt
      if (durationMs > 32) {
        recordSystemDebugHot({
          layer: 'vm',
          op: 'disk-read',
          detail: `${want}B ${(durationMs).toFixed(0)}ms`,
          durationMs,
        })
      } else {
        countSystemDebugHot('vm', 'disk-read', durationMs)
      }
      return {
        type: INSTANT_VM_MESSAGE_TYPE.diskReadResult,
        requestId: '',
        streamId: '',
        status,
        totalSize,
        bytes,
      }
    }
    const blob = await filesReadBlobRange(entry.path, offset, want)
    const base = new Uint8Array(await blob.arrayBuffer())
    for (const run of runs) {
      const start = run.offset - offset
      base.set(run.bytes, start)
    }
    const durationMs = performance.now() - startedAt
    if (durationMs > 32) {
      recordSystemDebugHot({
        layer: 'vm',
        op: 'disk-read',
        detail: `merge ${runs.length} runs ${want}B ${(durationMs).toFixed(0)}ms`,
        durationMs,
      })
    } else {
      countSystemDebugHot('vm', 'disk-read', durationMs)
    }
    return {
      type: INSTANT_VM_MESSAGE_TYPE.diskReadResult,
      requestId: '',
      streamId: '',
      status,
      totalSize,
      bytes: base.buffer as ArrayBuffer,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`读取镜像失败：${detail}`)
  }
}

async function writeDiskRange(
  entry: StreamEntry,
  overlay: DirtyOverlay,
  pending: DirtyOverlay,
  flusher: OverlayFlusher,
  offset: number,
  bytes: ArrayBuffer,
): Promise<InstantVmDiskWriteResultMessage> {
  const status = diskWriteReplyStatus(entry, offset, bytes.byteLength)
  if (status !== 200) {
    return {
      type: INSTANT_VM_MESSAGE_TYPE.diskWriteResult,
      requestId: '',
      streamId: '',
      status,
      totalSize: entry.size,
    }
  }
  try {
    const view = new Uint8Array(bytes)
    overlay.write(offset, view)
    if (entry.persist) {
      pending.write(offset, view)
    }
    const writeStartedAt = performance.now()
    await flusher.acknowledgeGuestWrite()
    const durationMs = performance.now() - writeStartedAt
    if (durationMs > 32) {
      recordSystemDebugHot({
        layer: 'vm',
        op: 'disk-write',
        detail: `${bytes.byteLength}B ack ${(durationMs).toFixed(0)}ms`,
        durationMs,
      })
    } else {
      countSystemDebugHot('vm', 'disk-write', durationMs)
    }
    return {
      type: INSTANT_VM_MESSAGE_TYPE.diskWriteResult,
      requestId: '',
      streamId: '',
      status: 200,
      totalSize: entry.size,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`回写镜像失败：${detail}`)
  }
}

export function postSource(
  source: {
    postMessage: (
      message: unknown,
      options: { targetOrigin: string; transfer?: Transferable[] },
    ) => void
  },
  message: object,
  origin: string,
  transfer: Transferable[] = [],
): void {
  source.postMessage(message, { targetOrigin: origin, transfer })
}

const overlays = new Map<string, DirtyOverlay>()
const pendingOverlays = new Map<string, DirtyOverlay>()
const flushers = new Map<string, OverlayFlusher>()

function overlaySink(entry: StreamEntry): OverlayPersistSink | undefined {
  const store = entry.overlayStore
  if (!store) {
    return undefined
  }
  return {
    append: (offset, bytes) => store.append(offset, bytes),
    flush: () => store.flush(),
  }
}

function ensureFlusher(streamId: string, entry: StreamEntry): OverlayFlusher {
  const existing = flushers.get(streamId)
  if (existing) {
    return existing
  }
  const pending = pendingOverlays.get(streamId) ?? new DirtyOverlay()
  pendingOverlays.set(streamId, pending)
  const created = createOverlayFlusher(pending, overlaySink(entry), entry.path)
  flushers.set(streamId, created)
  return created
}

/** 释放闸门状态：按流记录 release 起点与宽限期内写入的接收情况。 */
export type StreamReleaseState = {
  /** release 开始时刻（performance.now() 时钟），此前接收的消息一律放行 */
  startedAt: number
  /** 收尾窗口结束：此后到达的写一律拒绝 */
  closing: boolean
  /** release 开始后被放行的写条数（静默检测用） */
  acceptedWriteCount: number
  /** 被拒绝的写条数（>0 说明镜像缺了可能已向客机 ack 的数据） */
  discardedWrites: number
}

// release 开始后仍放行新写的总宽限：强拆路径下 CPU 尚未停，尾部数据能收多少收多少
export const RELEASE_WRITE_GRACE_MAX_MS = 10_000
// 宽限期内连续这么久没有新写即认为收尾完成，立即关门进入 flush/close
export const RELEASE_WRITE_QUIESCE_MS = 500

const releaseStates = new Map<string, StreamReleaseState>()

/**
 * 释放期间的消息闸门：
 * - release 开始前接收的消息（含已入队还没执行的写）一律放行——它们是停机前
 *   v86 发出的合法数据，可能已向客机 ack；执行时才丢弃等于制造 hive 半提交。
 * - release 开始后的读没有意义，直接拒绝；写给宽限期，到期或关门后拒绝并计数。
 */
export function evaluateReleaseGate(
  state: StreamReleaseState | undefined,
  receivedAt: number,
  isWrite: boolean,
): 'process' | 'drop' {
  if (!state) {
    return 'process'
  }
  if (receivedAt < state.startedAt) {
    return 'process'
  }
  if (!isWrite) {
    return 'drop'
  }
  if (state.closing || receivedAt - state.startedAt > RELEASE_WRITE_GRACE_MAX_MS) {
    state.discardedWrites += 1
    return 'drop'
  }
  state.acceptedWriteCount += 1
  return 'process'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function onDiskStreamMessage(event: MessageEvent): void {
  const isRead = isInstantVmDiskReadMessage(event.data)
  const isWrite = isInstantVmDiskWriteMessage(event.data)
  if (!isRead && !isWrite) {
    return
  }
  if (!isRuntimeOrigin(event.origin)) {
    console.warn('[vm-disk-host] 忽略来自非运行时源的磁盘消息', event.origin)
    return
  }
  const streamId = event.data.streamId
  const source = event.source
  if (!source || typeof source !== 'object' || !('postMessage' in source)) {
    return
  }
  const target = source as {
    postMessage: (
      message: unknown,
      options: { targetOrigin: string; transfer?: Transferable[] },
    ) => void
  }
  const receivedAt = performance.now()
  countSystemDebugHot('vm', isWrite ? 'disk-write-msg' : 'disk-read-msg')

  void enqueueStreamWork(streamId, async () => {
    const queueWaitMs = performance.now() - receivedAt
    if (queueWaitMs > 64) {
      // 串行工作链堵了：客机 IO 在排队等上一条（GB 级 flush / 慢盘）
      recordSystemDebugHot({
        layer: 'vm',
        op: 'stream-queue-wait',
        detail: `${queueWaitMs.toFixed(0)}ms ${isWrite ? 'write' : 'read'}`,
        durationMs: queueWaitMs,
      })
    } else {
      countSystemDebugHot('vm', 'stream-queue-wait', queueWaitMs)
    }
    try {
      // entry 在执行时现查：消息可能在 release 完成后才轮到执行，旧引用会写向已 close 的会话
      const entry = streams.get(streamId)
      const release = releaseStates.get(streamId)
      if (release && evaluateReleaseGate(release, receivedAt, isWrite) === 'drop') {
        if (isInstantVmDiskWriteMessage(event.data)) {
          postSource(
            target,
            {
              type: INSTANT_VM_MESSAGE_TYPE.diskWriteResult,
              requestId: event.data.requestId,
              streamId: event.data.streamId,
              status: 404,
              totalSize: 0,
            } satisfies InstantVmDiskWriteResultMessage,
            event.origin,
          )
          return
        }
        if (isInstantVmDiskReadMessage(event.data)) {
          postSource(
            target,
            {
              type: INSTANT_VM_MESSAGE_TYPE.diskReadResult,
              requestId: event.data.requestId,
              streamId: event.data.streamId,
              status: 404,
              totalSize: 0,
            } satisfies InstantVmDiskReadResultMessage,
            event.origin,
          )
        }
        return
      }
      if (isInstantVmDiskWriteMessage(event.data)) {
        const write = event.data
        if (!entry) {
          postSource(
            target,
            {
              type: INSTANT_VM_MESSAGE_TYPE.diskWriteResult,
              requestId: write.requestId,
              streamId: write.streamId,
              status: 404,
              totalSize: 0,
            } satisfies InstantVmDiskWriteResultMessage,
            event.origin,
          )
          return
        }
        const overlay = overlays.get(streamId) ?? new DirtyOverlay()
        overlays.set(streamId, overlay)
        const pending = pendingOverlays.get(streamId) ?? new DirtyOverlay()
        pendingOverlays.set(streamId, pending)
        const flusher = ensureFlusher(streamId, entry)
        const writeBytes = write.bytes.byteLength
        const result = await writeDiskRange(
          entry,
          overlay,
          pending,
          flusher,
          write.offset,
          write.bytes,
        )
        if (result.status === 200) {
          recordVmDiskStreamIo({
            streamId,
            direction: 'write',
            bytes: writeBytes,
            durationMs: performance.now() - receivedAt,
          })
        }
        postSource(
          target,
          {
            ...result,
            requestId: write.requestId,
            streamId: write.streamId,
          },
          event.origin,
        )
        return
      }

      if (!isInstantVmDiskReadMessage(event.data)) {
        return
      }
      const read = event.data
      if (!entry) {
        const reply: InstantVmDiskReadResultMessage = {
          type: INSTANT_VM_MESSAGE_TYPE.diskReadResult,
          requestId: read.requestId,
          streamId: read.streamId,
          status: 404,
          totalSize: 0,
        }
        postSource(target, reply, event.origin)
        return
      }
      const overlay = overlays.get(streamId)
      const result = await readDiskRange(entry, overlay ?? new DirtyOverlay(), read.offset, read.length)
      if (result.status === 206) {
        recordVmDiskStreamIo({
          streamId,
          direction: 'read',
          bytes: result.bytes?.byteLength ?? 0,
          durationMs: performance.now() - receivedAt,
        })
      }
      const reply: InstantVmDiskReadResultMessage = {
        ...result,
        requestId: read.requestId,
        streamId: read.streamId,
      }
      const transfer = reply.bytes ? [reply.bytes] : []
      postSource(target, reply, event.origin, transfer)
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      const failed = event.data as { requestId?: string }
      postSource(
        target,
        {
          type: INSTANT_VM_MESSAGE_TYPE.error,
          requestId: typeof failed.requestId === 'string' ? failed.requestId : 'disk',
          message: text || (isWrite ? '回写镜像失败' : '读取镜像失败'),
        },
        event.origin,
      )
    }
  })
}

function ensureListener(): void {
  if (listenerInstalled) {
    return
  }
  listenerInstalled = true
  window.addEventListener('message', onDiskStreamMessage)
}

/** 为本地镜像注册按需范围读（及可选差量回写）会话；返回 stream id。 */
export async function registerVirtualMachineDiskStream(
  path: string,
  options?: {
    writable?: boolean
    persist?: boolean
    mergeOnRelease?: boolean
    snapshotPath?: string
  },
): Promise<string> {
  const startedAt = performance.now()
  const stat = await filesStat(path)
  if (!stat || stat.kind !== 'file') {
    throw new Error(`文件不存在：${path}`)
  }
  const writable = options?.writable === true
  const persist = writable && options?.persist === true
  const snapshotPath = options?.snapshotPath?.trim() || undefined
  const mergeOnRelease = persist && options?.mergeOnRelease !== false && snapshotPath === undefined
  const overlay = new DirtyOverlay()
  let overlayStore: DiskOverlayStore | undefined
  if (writable) {
    const key = { imagePath: path, snapshotPath }
    if (snapshotPath || persist) {
      await replayDiskOverlayStore(key, (offset, bytes) => overlay.write(offset, bytes))
    }
    if (persist) {
      overlayStore = await openDiskOverlayStore(key)
    }
  }
  const id = `ds-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`
  streams.set(id, {
    path,
    size: stat.byteSize,
    writable,
    persist,
    mergeOnRelease,
    snapshotPath,
    overlayStore,
  })
  overlays.set(id, overlay)
  pendingOverlays.set(id, new DirtyOverlay())
  ensureListener()
  recordSystemDebugTimeline({
    layer: 'vm',
    op: 'disk-stream-register',
    detail: `${stat.byteSize}B writable=${writable} persist=${persist} merge=${mergeOnRelease}`,
    durationMs: Math.round(performance.now() - startedAt),
  })
  return id
}

export async function mergeOverlayIntoImage(
  path: string,
  overlay: DirtyOverlay,
  store?: DiskOverlayStore,
): Promise<void> {
  const runs = overlay.listRuns()
  if (runs.length === 0) {
    await store?.remove()
    overlay.clear()
    return
  }
  const mountWriter = await openMountRangeWriter(path)
  const writer = mountWriter ?? (await openQuietBlobWriter(path))
  try {
    if (writer) {
      for (const run of runs) {
        await writer.writeAt(run.offset, run.bytes)
      }
      await writer.flush()
      await writer.close()
    } else {
      for (const run of runs) {
        await filesWriteBytesRange(path, run.offset, run.bytes)
      }
    }
  } catch (error) {
    await writer?.abort().catch(() => undefined)
    throw error
  }
  await store?.remove()
  overlay.clear()
}

export async function freezeVirtualMachineDiskStreamOverlays(
  streamIds: readonly (string | undefined)[],
  snapshotPath: string,
): Promise<void> {
  const trimmed = snapshotPath.trim()
  if (!trimmed) {
    return
  }
  for (const streamId of streamIds) {
    if (!streamId) continue
    const entry = streams.get(streamId)
    const overlay = overlays.get(streamId)
    if (!entry?.writable || !overlay) continue
    const flusher = flushers.get(streamId)
    if (flusher) {
      await flusher.flushUntilEmpty()
    }
    await writeDiskOverlaySnapshot(
      { imagePath: entry.path, snapshotPath: trimmed },
      overlay.listRuns(),
    )
  }
}

export async function flushVirtualMachineDiskStream(streamId: string | undefined): Promise<void> {
  if (!streamId) return
  const entry = streams.get(streamId)
  if (!entry) return
  await ensureFlusher(streamId, entry).flushUntilEmpty()
}

async function drainStreamWork(streamId: string): Promise<void> {
  let rounds = 0
  for (;;) {
    const tail = streamWorkTails.get(streamId)
    if (!tail) break
    await tail
    rounds += 1
    countSystemDebugHot('vm', 'stream-drain-round')
    if (streamWorkTails.get(streamId) === tail) break
  }
  if (rounds > 8) {
    recordSystemDebugHot({
      layer: 'vm',
      op: 'stream-drain',
      detail: `${rounds} rounds`,
    })
  }
}

export async function drainThenFlushThenClose(params: {
  drain: () => Promise<void>
  flushUntilEmpty: () => Promise<void>
  close: () => Promise<void>
}): Promise<void> {
  await params.drain()
  await params.flushUntilEmpty()
  await params.close()
}

export async function releaseVirtualMachineDiskStream(
  streamId: string | undefined,
): Promise<number> {
  if (!streamId) {
    return 0
  }
  const releaseStartedAt = performance.now()
  const state: StreamReleaseState = {
    startedAt: releaseStartedAt,
    closing: false,
    acceptedWriteCount: 0,
    discardedWrites: 0,
  }
  releaseStates.set(streamId, state)
  const entry = streams.get(streamId)
  try {
    // 收尾窗口：先排干 release 前积压的任务；宽限期内有新写到达则静默观察，
    // 连续安静或宽限到期才关门。关门与最后一轮 drain 的完成落在同一同步段，
    // 迟到写要么已被排干、要么撞上 closing 被拒绝，不会掉进 flush/close 之后。
    await drainStreamWork(streamId)
    let seenAccepted = state.acceptedWriteCount
    while (
      seenAccepted > 0 &&
      performance.now() < releaseStartedAt + RELEASE_WRITE_GRACE_MAX_MS
    ) {
      await delay(RELEASE_WRITE_QUIESCE_MS)
      await drainStreamWork(streamId)
      if (state.acceptedWriteCount === seenAccepted) {
        break
      }
      seenAccepted = state.acceptedWriteCount
    }
  } finally {
    state.closing = true
  }
  try {
    await drainThenFlushThenClose({
      drain: () => drainStreamWork(streamId),
      flushUntilEmpty: async () => {
        if (!entry) return
        await ensureFlusher(streamId, entry).flushUntilEmpty()
      },
      close: async () => {
        if (!entry) return
        const overlay = overlays.get(streamId) ?? new DirtyOverlay()
        if (entry.mergeOnRelease) {
          await mergeOverlayIntoImage(entry.path, overlay, entry.overlayStore)
          return
        }
        if (!entry.persist) {
          overlay.clear()
        }
      },
    })
    recordSystemDebugTimeline({
      layer: 'vm',
      op: 'disk-stream-release',
      durationMs: Math.round(performance.now() - releaseStartedAt),
    })
  } finally {
    streams.delete(streamId)
    overlays.delete(streamId)
    pendingOverlays.delete(streamId)
    flushers.delete(streamId)
    releaseStates.delete(streamId)
    releaseVmDiskStreamMetrics(streamId)
    streamWorkTails.delete(streamId)
  }
  if (state.discardedWrites > 0) {
    recordSystemDebugTimeline({
      layer: 'vm',
      op: 'disk-stream-release-discarded',
      detail: `${state.discardedWrites} writes dropped, image may miss acked data`,
    })
  }
  return state.discardedWrites
}

export function countVirtualMachineDiskStreams(): number {
  return streams.size
}

export type DiskStreamsReleaseResult = { discardedWrites: number }

export async function releaseVirtualMachineDiskStreams(
  message: Partial<{
    hdaStream?: { id: string }
    hdbStream?: { id: string }
    cdromStream?: { id: string }
    fdaStream?: { id: string }
    fdbStream?: { id: string }
    stateStream?: { id: string }
  }>,
): Promise<DiskStreamsReleaseResult> {
  const discarded = await Promise.all([
    releaseVirtualMachineDiskStream(message.hdaStream?.id),
    releaseVirtualMachineDiskStream(message.hdbStream?.id),
    releaseVirtualMachineDiskStream(message.cdromStream?.id),
    releaseVirtualMachineDiskStream(message.fdaStream?.id),
    releaseVirtualMachineDiskStream(message.fdbStream?.id),
    releaseVirtualMachineDiskStream(message.stateStream?.id),
  ])
  return { discardedWrites: discarded.reduce((sum, count) => sum + count, 0) }
}

export type VirtualMachineDiskFlushProgress = {
  /** 覆盖层中尚未落盘的字节数（挂载卷在 close 原子替换前包含全部脏段） */
  pendingBytes: number
}

/** 关机刷盘进度查询：按流 id 汇总覆盖层剩余脏字节，给 UI 轮询用。 */
export function getVirtualMachineDiskFlushProgress(
  streamIds: readonly (string | undefined)[],
): VirtualMachineDiskFlushProgress {
  let pendingBytes = 0
  for (const id of streamIds) {
    if (!id) continue
    pendingBytes += overlays.get(id)?.dirtyBytes ?? 0
  }
  return { pendingBytes }
}
