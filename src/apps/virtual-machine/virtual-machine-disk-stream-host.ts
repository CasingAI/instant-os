import { filesReadBlobRange, filesStat } from '../files/files-api.ts'
import {
  INSTANT_VM_MESSAGE_TYPE,
  isInstantVmDiskReadMessage,
  type InstantVmDiskReadResultMessage,
} from './virtual-machine-protocol.ts'
import { getVmRuntimeOrigin } from './virtual-machine-runtime-config.ts'

type StreamEntry = {
  path: string
  size: number
}

const streams = new Map<string, StreamEntry>()
let listenerInstalled = false

function runtimeOrigins(): string[] {
  const configured = getVmRuntimeOrigin()
  if (!configured) {
    return []
  }
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

async function readDiskRange(
  entry: StreamEntry,
  offset: number,
  length: number,
): Promise<InstantVmDiskReadResultMessage> {
  const totalSize = entry.size
  if (offset < 0 || length < 0 || offset >= totalSize) {
    return {
      type: INSTANT_VM_MESSAGE_TYPE.diskReadResult,
      requestId: '',
      streamId: '',
      status: 416,
      totalSize,
    }
  }
  const want = Math.min(length, totalSize - offset)
  try {
    const blob = await filesReadBlobRange(entry.path, offset, want)
    const bytes = await blob.arrayBuffer()
    const status = offset === 0 && want === totalSize ? 200 : 206
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

function onDiskReadMessage(event: MessageEvent): void {
  if (!isRuntimeOrigin(event.origin)) {
    return
  }
  if (!isInstantVmDiskReadMessage(event.data)) {
    return
  }
  const message = event.data
  const entry = streams.get(message.streamId)
  const source = event.source
  if (!source || typeof source !== 'object' || !('postMessage' in source)) {
    return
  }

  void (async () => {
    try {
      if (!entry) {
        const reply: InstantVmDiskReadResultMessage = {
          type: INSTANT_VM_MESSAGE_TYPE.diskReadResult,
          requestId: message.requestId,
          streamId: message.streamId,
          status: 404,
          totalSize: 0,
        }
        source.postMessage(reply, event.origin)
        return
      }
      const result = await readDiskRange(entry, message.offset, message.length)
      const reply: InstantVmDiskReadResultMessage = {
        ...result,
        requestId: message.requestId,
        streamId: message.streamId,
      }
      const transfer = reply.bytes ? [reply.bytes] : []
      source.postMessage(reply, event.origin, transfer)
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      source.postMessage(
        {
          type: INSTANT_VM_MESSAGE_TYPE.error,
          requestId: message.requestId,
          message: text || '读取镜像失败',
        },
        event.origin,
      )
    }
  })()
}

function ensureListener(): void {
  if (listenerInstalled) {
    return
  }
  listenerInstalled = true
  window.addEventListener('message', onDiskReadMessage)
}

/** 为大体积本地镜像注册按需范围读会话；返回 stream id。 */
export async function registerVirtualMachineDiskStream(path: string): Promise<string> {
  const stat = await filesStat(path)
  if (!stat || stat.kind !== 'file') {
    throw new Error(`文件不存在：${path}`)
  }
  const id = `ds-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`
  streams.set(id, { path, size: stat.byteSize })
  ensureListener()
  return id
}

export function releaseVirtualMachineDiskStream(streamId: string | undefined): void {
  if (!streamId) {
    return
  }
  streams.delete(streamId)
}

export function releaseVirtualMachineDiskStreams(
  message: Partial<{
    hdaStream?: { id: string }
    cdromStream?: { id: string }
    fdaStream?: { id: string }
    stateStream?: { id: string }
  }>,
): void {
  releaseVirtualMachineDiskStream(message.hdaStream?.id)
  releaseVirtualMachineDiskStream(message.cdromStream?.id)
  releaseVirtualMachineDiskStream(message.fdaStream?.id)
  releaseVirtualMachineDiskStream(message.stateStream?.id)
}
