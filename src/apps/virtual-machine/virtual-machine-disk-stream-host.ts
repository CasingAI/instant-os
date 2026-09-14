import { filesReadBlobRange, filesStat, filesWriteBytesRange } from '../files/files-api.ts'
import { reconcileFilesByteTotal } from '../files/files-storage.ts'
import { openQuietBlobWriter } from '../files/files-quiet-blob-write.ts'
import { openMountRangeWriter } from '../files/files-location-mount.ts'
import {
  inspectDiskCacheAttachment,
  openDiskOverlayStore,
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
import type { VmDiskWriteModeId } from './virtual-machine-types.ts'
import { getVmRuntimeOrigin } from './virtual-machine-runtime-config.ts'

type StreamEntry = {
  path: string
  size: number
  writable: boolean
  /**
   * 硬盘写入档位：
   * - `live`：每批尽快写进可见文件（写完裁掉覆盖层，断电后把剩余写完）。
   * - `poweroff` / `none`：每批追加进绑定这份盘的持久缓存；区别只在最终是否合并
   *   （释放时由上层传入 discardCache 决定，切档也不动缓存）。
   */
  mode: VmDiskWriteModeId
  /** poweroff/none 的持久缓存；挂载目录上的镜像没有伴生缓存（仅内存）。 */
  cacheStore?: DiskOverlayStore
}

const streams = new Map<string, StreamEntry>()

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
   * 仅当覆盖层从 offset 起连续盖满该区间时才返回等长副本；有空洞必须返回
   * undefined，让读路径去叠底盘。脏段从区间中部一直延伸到末尾时，若把
   * `cursor` 直接跳到该段，会把这段数据贴到缓冲区开头并谎称读满——v86 按
   * 256KB 对齐预取时，会把后面文件的内容盖到同窗里更早的簇上。
   */
  read(offset: number, length: number): Uint8Array | undefined {
    if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(length) || length <= 0) {
      return undefined
    }
    const end = offset + length
    const out = new Uint8Array(length)
    let cursor = offset
    for (const run of this.runs) {
      if (cursor >= end) break
      if (run.offset >= end) break
      const runEnd = run.offset + run.bytes.byteLength
      if (runEnd <= cursor) continue
      if (run.offset > cursor) {
        return undefined
      }
      const srcStart = cursor - run.offset
      const srcEnd = Math.min(run.bytes.byteLength, end - run.offset)
      if (srcEnd <= srcStart) {
        return undefined
      }
      out.set(run.bytes.subarray(srcStart, srcEnd), cursor - offset)
      cursor = run.offset + srcEnd
    }
    if (cursor < end) return undefined
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

  /**
   * 裁掉已经写进可见文件的区间（live 档每批写完调用）。调用点都在流的串行
   * 工作链上，与读任务互斥，不存在「裁掉后读到旧数据」的窗口。
   */
  trim(offset: number, length: number): void {
    if (length <= 0) return
    const end = offset + length
    const next: DirtyRun[] = []
    for (const run of this.runs) {
      const runEnd = run.offset + run.bytes.byteLength
      if (runEnd <= offset || run.offset >= end) {
        next.push(run)
        continue
      }
      if (run.offset < offset) {
        next.push({ offset: run.offset, bytes: run.bytes.slice(0, offset - run.offset) })
      }
      if (runEnd > end) {
        next.push({ offset: end, bytes: run.bytes.slice(end - run.offset) })
      }
      this.totalDirtyBytes -= Math.min(runEnd, end) - Math.max(run.offset, offset)
    }
    this.runs = next
  }
}

type DirtyRun = {
  offset: number
  bytes: Uint8Array
}

const streamWorkTails = new Map<string, Promise<void>>()
let listenerInstalled = false

const overlays = new Map<string, DirtyOverlay>()

/** live 档的范围写通道：会话长开，释放时关闭。 */
type LiveRangeWriter = {
  writeAt(offset: number, bytes: Uint8Array): Promise<void>
  flush(): Promise<void>
  close(): Promise<void>
}

const liveWriters = new Map<string, LiveRangeWriter>()

async function ensureLiveWriter(
  streamId: string,
  entry: StreamEntry,
): Promise<LiveRangeWriter | undefined> {
  const existing = liveWriters.get(streamId)
  if (existing) return existing
  const mountWriter = await openMountRangeWriter(entry.path)
  const writer = mountWriter ?? (await openQuietBlobWriter(entry.path))
  if (!writer) return undefined
  liveWriters.set(streamId, writer)
  return writer
}

async function closeLiveWriter(streamId: string): Promise<void> {
  const writer = liveWriters.get(streamId)
  if (!writer) return
  liveWriters.delete(streamId)
  try {
    await writer.flush()
  } catch {
    // close 仍会收口；flush 失败说明盘有问题，交给收口的错误通道
  }
  await writer.close().catch((error: unknown) => {
    recordSystemDebugTimeline({
      layer: 'vm',
      op: 'live-writer-close-failed',
      detail: error instanceof Error ? error.message : String(error),
    })
  })
}

export const LIVE_IMAGE_WRITE_MAX_ATTEMPTS = 5

/** 用户在硬控画面上点了「放弃」的流：写入循环在下一个段之前停下来。 */
const abandonRequests = new Set<string>()

export function requestVirtualMachineDiskStreamAbandon(
  streamIds: readonly (string | undefined)[],
): void {
  for (const id of streamIds) {
    if (id) {
      abandonRequests.add(id)
    }
  }
}

/**
 * live 档把覆盖层剩余脏段全部写进可见文件（每批写完 / 释放收尾 / 切档时用）。
 * 失败重试，超过次数上限抛错——调用方（收口）会把错误上报为落盘未完成。
 * 用户请求放弃时在段间停下：剩余部分留在覆盖层里随会话丢弃。
 */
export async function writeLiveOverlayIntoImage(
  streamId: string,
  entry: StreamEntry,
  overlay: DirtyOverlay,
): Promise<void> {
  let failures = 0
  while (overlay.dirtyBytes > 0) {
    if (abandonRequests.has(streamId)) {
      return
    }
    const runs = overlay.listRuns()
    try {
      const writer = await ensureLiveWriter(streamId, entry)
      if (writer) {
        for (const run of runs) {
          await writer.writeAt(run.offset, run.bytes)
        }
        await writer.flush()
        for (const run of runs) {
          overlay.trim(run.offset, run.bytes.byteLength)
        }
      } else {
        for (const run of runs) {
          await filesWriteBytesRange(entry.path, run.offset, run.bytes)
          overlay.trim(run.offset, run.bytes.byteLength)
        }
      }
    } catch (error) {
      failures += 1
      if (failures >= LIVE_IMAGE_WRITE_MAX_ATTEMPTS) {
        recordSystemDebugTimeline({
          layer: 'vm',
          op: 'live-image-write-giveup',
          detail: {
            path: entry.path,
            remainingBytes: overlay.dirtyBytes,
            error: error instanceof Error ? error.message : String(error),
          },
        })
        throw error
      }
    }
  }
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
    const blob = await filesReadBlobRange(entry.path, offset, want)
    const base = new Uint8Array(await blob.arrayBuffer())
    const cacheRuns = entry.cacheStore
      ? await entry.cacheStore.readOverlapping(offset, want)
      : []
    for (const run of cacheRuns) {
      base.set(run.bytes, run.offset - offset)
    }
    for (const run of overlay.runsOverlapping(offset, want)) {
      base.set(run.bytes, run.offset - offset)
    }
    const durationMs = performance.now() - startedAt
    if (durationMs > 32) {
      recordSystemDebugHot({
        layer: 'vm',
        op: 'disk-read',
        detail: `merge ${cacheRuns.length} cache ${want}B ${(durationMs).toFixed(0)}ms`,
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

/**
 * 写批次的落点。宿主对客机写点头，只代表这一批已经进了该档该去的地方：
 * live = 可见文件；poweroff/none = 主机磁盘上的缓存。挂载目录上的镜像没有
 * 伴生缓存，只进内存覆盖层（关机靠覆盖层合并）。
 */
async function writeDiskRange(
  streamId: string,
  entry: StreamEntry,
  overlay: DirtyOverlay,
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
    const writeStartedAt = performance.now()
    if (entry.mode === 'live') {
      const writer = await ensureLiveWriter(streamId, entry)
      if (writer) {
        await writer.writeAt(offset, view)
      } else {
        await filesWriteBytesRange(entry.path, offset, view)
      }
      // 已进可见文件：覆盖层裁掉，断电后只剩未写完的尾巴
      overlay.trim(offset, view.byteLength)
    } else if (entry.cacheStore) {
      await entry.cacheStore.append(offset, view)
      await entry.cacheStore.flush()
      overlay.trim(offset, view.byteLength)
    }
    const durationMs = performance.now() - writeStartedAt
    if (durationMs > 32) {
      recordSystemDebugHot({
        layer: 'vm',
        op: 'disk-write',
        detail: `${bytes.byteLength}B ${entry.mode} ${(durationMs).toFixed(0)}ms`,
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
        const writeBytes = write.bytes.byteLength
        const result = await writeDiskRange(streamId, entry, overlay, write.offset, write.bytes)
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

function isMountPath(path: string): boolean {
  return path.startsWith('/mount/')
}

/** 持久缓存只对有节点树的内部卷开；挂载进来的真文件夹不落伴生文件。 */
async function openCacheStoreForPath(path: string): Promise<DiskOverlayStore | undefined> {
  if (isMountPath(path)) {
    return undefined
  }
  return openDiskOverlayStore({ imagePath: path })
}

/** 为本地镜像注册按需范围读（及可选差量回写）会话；返回 stream id。 */
export async function registerVirtualMachineDiskStream(
  path: string,
  options?: {
    writable?: boolean
    mode?: VmDiskWriteModeId
  },
): Promise<string> {
  const startedAt = performance.now()
  const stat = await filesStat(path)
  if (!stat || stat.kind !== 'file') {
    throw new Error(`文件不存在：${path}`)
  }
  const writable = options?.writable === true
  const mode = options?.mode ?? 'none'
  const overlay = new DirtyOverlay()
  let cacheStore: DiskOverlayStore | undefined
  if (writable && mode !== 'live' && !isMountPath(path)) {
    cacheStore = await openCacheStoreForPath(path)
  }
  const id = `ds-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`
  const entry: StreamEntry = { path, size: stat.byteSize, writable, mode, cacheStore }
  streams.set(id, entry)
  overlays.set(id, overlay)
  if (writable && mode === 'live' && (await inspectDiskCacheAttachment({ imagePath: path }))) {
    const leftover = await openCacheStoreForPath(path)
    if (leftover) {
      await mergeOverlayIntoImage(path, overlay, leftover)
    }
  }
  ensureListener()
  recordSystemDebugTimeline({
    layer: 'vm',
    op: 'disk-stream-register',
    detail: `${stat.byteSize}B writable=${writable} mode=${mode}`,
    durationMs: Math.round(performance.now() - startedAt),
  })
  return id
}

/**
 * 运行中切档。live 与缓存档互切、poweroff/none 互切：
 * - 切到 live：缓存里已有的改动（含开机重放的历史）先落进可见文件，缓存删除。
 * - poweroff ⇄ none：只改最终合不合并，缓存保留、继续追加同一份。
 */
export async function setVirtualMachineDiskStreamMode(
  streamId: string | undefined,
  mode: VmDiskWriteModeId,
): Promise<void> {
  if (!streamId) return
  await enqueueStreamWork(streamId, async () => {
    const entry = streams.get(streamId)
    const overlay = overlays.get(streamId)
    if (!entry || !overlay || !entry.writable) return
    if (mode === entry.mode) return
    if (mode === 'live') {
      await mergeOverlayIntoImage(entry.path, overlay, entry.cacheStore, { streamId })
      entry.cacheStore = undefined
      entry.mode = 'live'
      return
    }
    if (entry.mode === 'live') {
      entry.cacheStore = await openCacheStoreForPath(entry.path)
    }
    entry.mode = mode
  })
}

async function persistOverlayTailToStore(
  overlay: DirtyOverlay,
  store: DiskOverlayStore,
): Promise<void> {
  for (const run of overlay.listRuns()) {
    await store.append(run.offset, run.bytes)
    overlay.trim(run.offset, run.bytes.byteLength)
  }
  await store.flush()
}

export async function mergeOverlayIntoImage(
  path: string,
  overlay: DirtyOverlay,
  store?: DiskOverlayStore,
  options?: {
    /** 每写一段之前检查；返回 true 立即停止（用户放弃）。缓存保留，下次急救还能再合并。 */
    shouldAbort?: () => boolean
    streamId?: string
  },
): Promise<void> {
  if (store) {
    await persistOverlayTailToStore(overlay, store)
  }
  const storeSegments = store ? await store.segments() : []
  const overlayRuns = store ? [] : overlay.listRuns()
  const units =
    storeSegments.length > 0
      ? storeSegments.map((seg) => ({ offset: seg.offset, length: seg.length }))
      : overlayRuns.map((run) => ({ offset: run.offset, length: run.bytes.byteLength }))
  if (units.length === 0) {
    await store?.remove()
    overlay.clear()
    return
  }
  const total = units.reduce((sum, unit) => sum + unit.length, 0)
  if (options?.streamId) {
    pendingMergeBytes.set(options.streamId, total)
    flushTotalBytes.set(
      options.streamId,
      Math.max(flushTotalBytes.get(options.streamId) ?? 0, total),
    )
  }
  const mountWriter = await openMountRangeWriter(path)
  const writer = mountWriter ?? (await openQuietBlobWriter(path))
  let remaining = total
  try {
    for (const unit of units) {
      if (options?.shouldAbort?.()) {
        await writer?.close().catch(() => undefined)
        return
      }
      const bytes = store
        ? await store.readRun(unit.offset, unit.length)
        : overlayRuns.find((run) => run.offset === unit.offset)?.bytes
      if (!bytes) continue
      if (writer) {
        await writer.writeAt(unit.offset, bytes)
      } else {
        await filesWriteBytesRange(path, unit.offset, bytes)
      }
      if (!store) {
        overlay.trim(unit.offset, unit.length)
      }
      remaining -= unit.length
      if (options?.streamId) {
        pendingMergeBytes.set(options.streamId, Math.max(0, remaining))
      }
    }
    if (writer) {
      await writer.flush()
      await writer.close()
    }
  } catch (error) {
    await writer?.abort().catch(() => undefined)
    throw error
  }
  await store?.remove()
  overlay.clear()
  if (options?.streamId) {
    pendingMergeBytes.set(options.streamId, 0)
  }
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

/** release 第一阶段：挂闸门、排干积压与宽限窗口内的迟到写。 */
async function openReleaseGate(streamId: string): Promise<void> {
  const releaseStartedAt = performance.now()
  const state: StreamReleaseState = {
    startedAt: releaseStartedAt,
    closing: false,
    acceptedWriteCount: 0,
    discardedWrites: 0,
  }
  releaseStates.set(streamId, state)
  try {
    // 收尾窗口：先排干 release 前积压的任务；宽限期内有新写到达则静默观察，
    // 连续安静或宽限到期才关门。关门与最后一轮 drain 的完成落在同一同步段，
    // 迟到写要么已被排干、要么撞上 closing 被拒绝，不会掉进 close 之后。
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
}

/** release 第二阶段：按档位收尾并清理会话；返回被丢弃的写条数。 */
async function closeReleasedStream(
  streamId: string,
  options?: {
    discardCache?: boolean
  },
): Promise<number> {
  const entry = streams.get(streamId)
  const state = releaseStates.get(streamId)
  const releaseStartedAt = state?.startedAt ?? performance.now()
  try {
    await drainStreamWork(streamId)
    if (entry) {
      const overlay = overlays.get(streamId) ?? new DirtyOverlay()
      // 按档位收尾前先钉住进度基准：之后 pending 只减不增，UI 的 total 从此不再重置
      const cacheDirty = entry.cacheStore?.dirtyBytes() ?? 0
      flushTotalBytes.set(
        streamId,
        Math.max(flushTotalBytes.get(streamId) ?? 0, overlay.dirtyBytes + cacheDirty),
      )
      const abandoned = abandonRequests.has(streamId)
      if (entry.mode === 'live') {
        await writeLiveOverlayIntoImage(streamId, entry, overlay)
      } else if (entry.mode === 'none' && options?.discardCache) {
        await entry.cacheStore?.remove()
        overlay.clear()
      } else if (abandoned && entry.mode === 'none') {
        await entry.cacheStore?.remove()
        overlay.clear()
      } else {
        await mergeOverlayIntoImage(entry.path, overlay, entry.cacheStore, {
          shouldAbort: () => abandonRequests.has(streamId),
          streamId,
        })
        // 大批量范围写刚落盘，顺手校准 byte-total（漂移自愈，见 files-storage）
        void reconcileFilesByteTotal().catch(() => undefined)
      }
    }
    recordSystemDebugTimeline({
      layer: 'vm',
      op: 'disk-stream-release',
      ...(abandonRequests.has(streamId) ? { detail: 'abandoned' } : {}),
      durationMs: Math.round(performance.now() - releaseStartedAt),
    })
  } finally {
    abandonRequests.delete(streamId)
    await closeLiveWriter(streamId).catch(() => undefined)
    streams.delete(streamId)
    overlays.delete(streamId)
    flushTotalBytes.delete(streamId)
    pendingMergeBytes.delete(streamId)
    releaseStates.delete(streamId)
    releaseVmDiskStreamMetrics(streamId)
    streamWorkTails.delete(streamId)
  }
  const discarded = state?.discardedWrites ?? 0
  if (discarded > 0) {
    recordSystemDebugTimeline({
      layer: 'vm',
      op: 'disk-stream-release-discarded',
      detail: `${discarded} writes dropped, image may miss acked data`,
    })
  }
  return discarded
}

export async function releaseVirtualMachineDiskStream(
  streamId: string | undefined,
  options?: {
    /** none 档收尾：用户确认不保存时丢弃缓存（默认按合并收尾）。 */
    discardCache?: boolean
  },
): Promise<number> {
  if (!streamId) {
    return 0
  }
  await openReleaseGate(streamId)
  return closeReleasedStream(streamId, options)
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
  options?: {
    /**
     * none 档收尾询问：全部流排干、缓存已落稳之后调用一次（整台机器只问一轮），
     * 返回 'discard' = 删缓存不写盘，'merge' = 合并进可见文件；缺省按合并。
     */
    decideCache?: () => Promise<'discard' | 'merge'>
  },
): Promise<DiskStreamsReleaseResult> {
  const ids = [
    message.hdaStream?.id,
    message.hdbStream?.id,
    message.cdromStream?.id,
    message.fdaStream?.id,
    message.fdbStream?.id,
    message.stateStream?.id,
  ].filter((id): id is string => typeof id === 'string')
  await Promise.all(ids.map((id) => openReleaseGate(id)))
  let discardCache = false
  // 已 abandon 的 none 流收尾直接丢缓存，不再构成「要不要写入硬盘文件」的问询对象；
  // 全部 none 流都已放弃时组件可能早已卸载，弹窗没人应答。只读流（如光驱）虽以
  // none 档注册，但从未写过盘，不能算问询对象——否则挂了流式光驱的机器每次
  // 正常关机都弹多余的「写入硬盘文件？」。
  const hasNoneStream = ids.some((id) => {
    const entry = streams.get(id)
    return entry?.mode === 'none' && entry.writable === true && !abandonRequests.has(id)
  })
  if (hasNoneStream && options?.decideCache) {
    discardCache = (await options.decideCache()) === 'discard'
  }
  const discarded = await Promise.all(
    ids.map((id) => closeReleasedStream(id, { discardCache })),
  )
  return { discardedWrites: discarded.reduce((sum, count) => sum + count, 0) }
}

export type VirtualMachineDiskFlushProgress = {
  /** 覆盖层中尚未进可见文件/未合并的字节数（挂载卷在 close 原子替换前包含全部脏段） */
  pendingBytes: number
  /**
   * 进度基准（总量）：收尾开始时各流 pending 的记录值之和。合并过程中 pending 递减、
   * total 不变，UI 才能算出单向前进的百分比（切到别的机器再切回也不会从 0 重来）。
   * 无记录的流以当前 pending 兜底，保证 total ≥ pending；0 = 尚无基准（挂载卷黑盒阶段）。
   */
  totalBytes: number
}

/**
 * 关机合并的进度基准：closeReleasedStream 在 drain 完成后记录的 pending 峰值。
 * 之后的合并只减不增，记录值固定不变，进度条基准由这里而非 UI 侧维护。
 */
const flushTotalBytes = new Map<string, number>()
const pendingMergeBytes = new Map<string, number>()

/** 关机刷盘进度查询：按流 id 汇总覆盖层剩余脏字节、缓存脏槽与进度基准。 */
export function getVirtualMachineDiskFlushProgress(
  streamIds: readonly (string | undefined)[],
): VirtualMachineDiskFlushProgress {
  let pendingBytes = 0
  let totalBytes = 0
  for (const id of streamIds) {
    if (!id) continue
    const overlayPending = overlays.get(id)?.dirtyBytes ?? 0
    const cacheStore = streams.get(id)?.cacheStore
    const cachePending = cacheStore?.dirtyBytes() ?? 0
    const mergePending = pendingMergeBytes.get(id)
    const pending = mergePending ?? (cacheStore ? cachePending : overlayPending)
    pendingBytes += pending
    totalBytes += Math.max(flushTotalBytes.get(id) ?? 0, pending)
  }
  return { pendingBytes, totalBytes }
}
