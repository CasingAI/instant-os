import { filesReadBlobRange, filesStat, filesWriteBytesRange } from '../files/files-api.ts'
import { openQuietBlobWriter, type QuietBlobWriter } from '../files/files-quiet-blob-write.ts'
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
  quietWriter: QuietBlobWriter | undefined
}

export const OVERLAY_FLUSH_INTERVAL_MS = 50
export const OVERLAY_FLUSH_DIRTY_BYTES = 256 * 1024
export const OVERLAY_HIGH_WATER_BYTES = 4 * 1024 * 1024
export const OVERLAY_LOW_WATER_BYTES = 1024 * 1024

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

function isRuntimeOrigin(origin: string): boolean {
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
      this.mergeRuns(i, offset, bytes)
      return
    }
    runs.splice(insertIndex, 0, { offset, bytes: new Uint8Array(bytes) })
    this.totalDirtyBytes += bytes.byteLength
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
}

export const OVERLAY_FLUSH_MAX_ATTEMPTS = 5

export function createOverlayFlusher(
  _streamId: string,
  entry: StreamEntry,
  overlay: DirtyOverlay,
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
    let processed = 0
    try {
      if (!entry.quietWriter) {
        for (const run of runs) {
          await filesWriteBytesRange(entry.path, run.offset, run.bytes)
          processed += 1
        }
        return
      }
      for (const run of runs) {
        await entry.quietWriter.writeAt(run.offset, run.bytes)
        processed += 1
      }
      try {
        await entry.quietWriter.flush()
      } catch (error) {
        processed = 0
        throw error
      }
    } catch (error) {
      for (const run of runs.slice(processed)) {
        overlay.write(run.offset, run.bytes)
      }
      throw error
    }
  }

  function flushRound(maxBytes?: number): Promise<void> {
    if (flushPromise) return flushPromise
    if (overlay.dirtyBytes === 0) return Promise.resolve()
    cancelSchedule()
    const runs = overlay.takeRunsForFlush(maxBytes)
    if (runs.length === 0) return Promise.resolve()
    const pending = persistRuns(runs).finally(() => {
      if (flushPromise === pending) {
        flushPromise = undefined
      }
    })
    flushPromise = pending
    return pending
  }

  async function flushUntilEmpty(): Promise<void> {
    if (flushUntilEmptyPromise) return flushUntilEmptyPromise
    flushUntilEmptyPromise = (async () => {
      try {
        cancelSchedule()
        if (flushPromise) {
          try {
            await flushPromise
          } catch {
            // 进行中的一轮已把未落盘段写回覆盖层，下面按失败次数重试
          }
        }
        let failures = 0
        while (overlay.dirtyBytes > 0) {
          try {
            await flushRound()
          } catch {
            failures += 1
            if (failures >= OVERLAY_FLUSH_MAX_ATTEMPTS) {
              throw new Error('覆盖层刷盘失败次数过多，已中止')
            }
          }
        }
      } finally {
        flushUntilEmptyPromise = undefined
      }
    })()
    return flushUntilEmptyPromise
  }

  async function flushUntilBelow(limit: number): Promise<void> {
    cancelSchedule()
    if (flushUntilEmptyPromise) await flushUntilEmptyPromise
    if (flushPromise) await flushPromise
    while (overlay.dirtyBytes > limit) {
      await flushRound(Math.max(OVERLAY_FLUSH_DIRTY_BYTES, overlay.dirtyBytes - limit))
    }
  }

  function afterWrite(): void {
    if (overlay.dirtyBytes >= OVERLAY_FLUSH_DIRTY_BYTES) {
      void flushRound()
    } else if (overlay.dirtyBytes > 0) {
      schedule()
    }
  }

  async function acknowledgeGuestWrite(): Promise<void> {
    if (overlay.dirtyBytes > OVERLAY_HIGH_WATER_BYTES) {
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
  try {
    const overlayBytes = overlay.read(offset, want)
    if (overlayBytes !== undefined) {
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
      return {
        type: INSTANT_VM_MESSAGE_TYPE.diskReadResult,
        requestId: '',
        streamId: '',
        status,
        totalSize,
        bytes: await blob.arrayBuffer(),
      }
    }
    const blob = await filesReadBlobRange(entry.path, offset, want)
    const base = new Uint8Array(await blob.arrayBuffer())
    for (const run of runs) {
      const start = run.offset - offset
      base.set(run.bytes, start)
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
    overlay.write(offset, new Uint8Array(bytes))
    await flusher.acknowledgeGuestWrite()
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

function postSource(
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
const flushers = new Map<string, OverlayFlusher>()
const releasingIds = new Set<string>()

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
  const entry = streams.get(streamId)
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

  void enqueueStreamWork(streamId, async () => {
    try {
      if (releasingIds.has(streamId)) {
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
        let flusher = flushers.get(streamId)
        if (!flusher) {
          flusher = createOverlayFlusher(streamId, entry, overlay)
          flushers.set(streamId, flusher)
        }
        const writeBytes = write.bytes.byteLength
        const result = await writeDiskRange(entry, overlay, flusher, write.offset, write.bytes)
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

/** 为本地镜像注册按需范围读（及可选回写）会话；返回 stream id。 */
export async function registerVirtualMachineDiskStream(
  path: string,
  options?: { writable?: boolean },
): Promise<string> {
  const stat = await filesStat(path)
  if (!stat || stat.kind !== 'file') {
    throw new Error(`文件不存在：${path}`)
  }
  const writable = options?.writable === true
  const quietWriter = writable ? await openQuietBlobWriter(path) : undefined
  const id = `ds-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`
  streams.set(id, {
    path,
    size: stat.byteSize,
    writable,
    quietWriter,
  })
  ensureListener()
  return id
}

export async function flushVirtualMachineDiskStream(streamId: string | undefined): Promise<void> {
  if (!streamId) return
  const overlay = overlays.get(streamId)
  const flusher = flushers.get(streamId)
  if (flusher) {
    await flusher.flushUntilEmpty()
    return
  }
  if (!overlay) return
  const entry = streams.get(streamId)
  if (!entry) return
  const created = createOverlayFlusher(streamId, entry, overlay)
  flushers.set(streamId, created)
  await created.flushUntilEmpty()
}

async function drainStreamWork(streamId: string): Promise<void> {
  for (;;) {
    const tail = streamWorkTails.get(streamId)
    if (!tail) return
    await tail
    if (streamWorkTails.get(streamId) === tail) return
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

export async function releaseVirtualMachineDiskStream(streamId: string | undefined): Promise<void> {
  if (!streamId) {
    return
  }
  releasingIds.add(streamId)
  const entry = streams.get(streamId)
  const flusher = flushers.get(streamId)
  try {
    await drainThenFlushThenClose({
      drain: () => drainStreamWork(streamId),
      flushUntilEmpty: async () => {
        if (flusher) {
          await flusher.flushUntilEmpty()
          return
        }
        const overlay = overlays.get(streamId)
        if (!overlay || !entry) return
        const created = createOverlayFlusher(streamId, entry, overlay)
        flushers.set(streamId, created)
        await created.flushUntilEmpty()
      },
      close: async () => {
        if (entry?.quietWriter) {
          await entry.quietWriter.close()
        }
      },
    })
  } finally {
    streams.delete(streamId)
    overlays.delete(streamId)
    flushers.delete(streamId)
    releasingIds.delete(streamId)
    releaseVmDiskStreamMetrics(streamId)
    streamWorkTails.delete(streamId)
  }
}

export function countVirtualMachineDiskStreams(): number {
  return streams.size
}

export async function releaseVirtualMachineDiskStreams(
  message: Partial<{
    hdaStream?: { id: string }
    hdbStream?: { id: string }
    cdromStream?: { id: string }
    fdaStream?: { id: string }
    fdbStream?: { id: string }
    stateStream?: { id: string }
  }>,
): Promise<void> {
  await Promise.all([
    releaseVirtualMachineDiskStream(message.hdaStream?.id),
    releaseVirtualMachineDiskStream(message.hdbStream?.id),
    releaseVirtualMachineDiskStream(message.cdromStream?.id),
    releaseVirtualMachineDiskStream(message.fdaStream?.id),
    releaseVirtualMachineDiskStream(message.fdbStream?.id),
    releaseVirtualMachineDiskStream(message.stateStream?.id),
  ])
}
