import OpfsAccessWorkerCtor from './files-opfs-access-worker.ts?worker'
import type {
  OpfsAccessAbortRequest,
  OpfsAccessCloseRequest,
  OpfsAccessFlushRequest,
  OpfsAccessOpenRequest,
  OpfsAccessRequest,
  OpfsAccessResponse,
  OpfsAccessWriteRequest,
} from './files-opfs-access-worker.ts'
import { toExactArrayBuffer } from '../../archive/archive-codec.ts'

/**
 * OPFS 原地写入客户端。
 *
 * 含 Vite `?worker` 静态导入，只能被浏览器加载；files-opfs-blobs 动态 import，
 * node 测试走内存后端，不会执行到这里。
 */

let worker: Worker | undefined
let workerFailed = false
let nextId = 1

type Pending = {
  resolve: (response: OpfsAccessResponse) => void
  reject: (error: Error) => void
}

const pending = new Map<number, Pending>()

function getWorker(): Worker {
  if (worker) return worker
  if (workerFailed) {
    throw new Error('OPFS 写入通道不可用，请刷新页面重试')
  }
  worker = new OpfsAccessWorkerCtor()
  worker.onmessage = (event: MessageEvent<OpfsAccessResponse>) => {
    const response = event.data
    const entry = pending.get(response.id)
    if (!entry) return
    pending.delete(response.id)
    if (response.type === 'error') {
      entry.reject(new Error(response.message))
      return
    }
    entry.resolve(response)
  }
  worker.onerror = (event) => {
    workerFailed = true
    const error = new Error(`OPFS 写入通道错误: ${event.message}`)
    for (const entry of pending.values()) {
      entry.reject(error)
    }
    pending.clear()
    worker?.terminate()
    worker = undefined
  }
  return worker
}

function callWorker(
  message: OpfsAccessRequest,
  transfer?: Transferable[],
): Promise<OpfsAccessResponse> {
  return new Promise<OpfsAccessResponse>((resolve, reject) => {
    pending.set(message.id, { resolve, reject })
    try {
      if (transfer && transfer.length > 0) {
        getWorker().postMessage(message, transfer)
      } else {
        getWorker().postMessage(message)
      }
    } catch (error) {
      pending.delete(message.id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

export type OpfsAccessSession = {
  writeAt(offset: number, data: Uint8Array): Promise<number>
  flush(): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}

/**
 * 打开 Worker 内的 SyncAccessHandle 会话，多次按偏移写同一份正文。
 */
export async function openOpfsAccessSession(
  handle: FileSystemFileHandle,
): Promise<OpfsAccessSession> {
  const openRequest: OpfsAccessOpenRequest = {
    type: 'open',
    id: nextId++,
    handle,
  }
  const opened = await callWorker(openRequest)
  if (opened.type !== 'opened') {
    throw new Error('OPFS 写入会话未能打开')
  }
  const sessionId = opened.sessionId
  let closed = false

  async function finish(kind: 'close' | 'abort'): Promise<void> {
    if (closed) return
    closed = true
    const request: OpfsAccessCloseRequest | OpfsAccessAbortRequest = {
      type: kind,
      id: nextId++,
      sessionId,
    }
    await callWorker(request)
  }

  return {
    async writeAt(offset, data) {
      if (closed) throw new Error('OPFS 写入已结束')
      const bytes = toExactArrayBuffer(data.slice())
      const request: OpfsAccessWriteRequest = {
        type: 'write',
        id: nextId++,
        sessionId,
        offset,
        bytes,
      }
      const response = await callWorker(request, [bytes])
      if (response.type !== 'write-done') {
        throw new Error('OPFS 原地写入失败')
      }
      return response.size
    },
    async flush() {
      if (closed) throw new Error('OPFS 写入已结束')
      const request: OpfsAccessFlushRequest = {
        type: 'flush',
        id: nextId++,
        sessionId,
      }
      const response = await callWorker(request)
      if (response.type !== 'flushed') {
        throw new Error('OPFS 刷盘失败')
      }
    },
    close: () => finish('close'),
    abort: () => finish('abort'),
  }
}

/**
 * 短会话：打开、写一次、关闭。bytes 会先复制再转移，调用方视图不受影响。
 */
export async function writeOpfsRangeViaAccessWorker(
  handle: FileSystemFileHandle,
  offset: number,
  data: Uint8Array,
): Promise<number> {
  const session = await openOpfsAccessSession(handle)
  try {
    const size = await session.writeAt(offset, data)
    await session.close()
    return size
  } catch (error) {
    await session.abort().catch(() => undefined)
    throw error
  }
}
