import { filesReadBlobRange, filesStat, filesWriteBytesRange } from '../files/files-api.ts'
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
}

const streams = new Map<string, StreamEntry>()
const streamWorkTails = new Map<string, Promise<void>>()
let listenerInstalled = false

function enqueueStreamWork<T>(streamId: string, work: () => Promise<T>): Promise<T> {
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

async function readDiskRange(
  entry: StreamEntry,
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
    const blob = await filesReadBlobRange(entry.path, offset, want)
    const bytes = await blob.arrayBuffer()
    return {
      type: INSTANT_VM_MESSAGE_TYPE.diskReadResult,
      requestId: '',
      streamId: '',
      status,
      totalSize,
      bytes,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`读取镜像失败：${detail}`)
  }
}

async function writeDiskRange(
  entry: StreamEntry,
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
    await filesWriteBytesRange(entry.path, offset, bytes)
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
        const writeBytes = write.bytes.byteLength
        const result = await writeDiskRange(entry, write.offset, write.bytes)
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
      const result = await readDiskRange(entry, read.offset, read.length)
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
  const id = `ds-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`
  streams.set(id, {
    path,
    size: stat.byteSize,
    writable: options?.writable === true,
  })
  ensureListener()
  return id
}

export function releaseVirtualMachineDiskStream(streamId: string | undefined): void {
  if (!streamId) {
    return
  }
  streams.delete(streamId)
  releaseVmDiskStreamMetrics(streamId)
  const tail = streamWorkTails.get(streamId)
  if (!tail) {
    return
  }
  void tail.finally(() => {
    if (streamWorkTails.get(streamId) === tail) {
      streamWorkTails.delete(streamId)
    }
  })
}

export function releaseVirtualMachineDiskStreams(
  message: Partial<{
    hdaStream?: { id: string }
    hdbStream?: { id: string }
    cdromStream?: { id: string }
    fdaStream?: { id: string }
    fdbStream?: { id: string }
    stateStream?: { id: string }
  }>,
): void {
  releaseVirtualMachineDiskStream(message.hdaStream?.id)
  releaseVirtualMachineDiskStream(message.hdbStream?.id)
  releaseVirtualMachineDiskStream(message.cdromStream?.id)
  releaseVirtualMachineDiskStream(message.fdaStream?.id)
  releaseVirtualMachineDiskStream(message.fdbStream?.id)
  releaseVirtualMachineDiskStream(message.stateStream?.id)
}
