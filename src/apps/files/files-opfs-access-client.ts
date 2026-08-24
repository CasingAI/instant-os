import OpfsAccessWorkerCtor from './files-opfs-access-worker.ts?worker'
import type {
  OpfsAccessRequest,
  OpfsAccessResponse,
  OpfsAccessWriteRangeRequest,
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
  resolve: (size: number) => void
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
    entry.resolve(response.size)
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

/**
 * 在 Worker 里按偏移原地写入 OPFS 正文。bytes 会先复制再转移，调用方视图不受影响。
 */
export function writeOpfsRangeViaAccessWorker(
  handle: FileSystemFileHandle,
  offset: number,
  data: Uint8Array,
): Promise<number> {
  const request: OpfsAccessWriteRangeRequest = {
    type: 'write-range',
    id: nextId++,
    handle,
    offset,
    bytes: toExactArrayBuffer(data.slice()),
  }
  return new Promise<number>((resolve, reject) => {
    pending.set(request.id, { resolve, reject })
    try {
      const message: OpfsAccessRequest = request
      getWorker().postMessage(message, [request.bytes])
    } catch (error) {
      pending.delete(request.id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
