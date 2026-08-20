import ArchiveWorkerCtor from './archive-worker.ts?worker'
import type {
  ArchiveWorkerDecodeRequest,
  ArchiveWorkerEncodeRequest,
  ArchiveWorkerListRequest,
  ArchiveWorkerRequest,
  ArchiveWorkerResponse,
} from './archive-worker.ts'
import {
  toExactArrayBuffer,
  type ArchiveCodecFormat,
} from './archive-codec.ts'
import type { ArchiveEntryMeta } from './archive-list.ts'

/**
 * Archive Worker 惰性单例客户端。
 *
 * - 本模块含静态 `?worker` 导入（Vite 专用语法），只能被浏览器加载；
 *   files-api 通过动态 import 引用本模块，node 测试不执行到该路径。
 * - 请求按 id 匹配响应；同步解码无法中途打断，AbortSignal 取消只是丢弃
 *   迟到响应（与改造前主线程同步解压的取消语义一致）。
 * - 入参字节先复制为独立 ArrayBuffer 再转移，调用方持有的视图不受影响。
 */

let worker: Worker | undefined
let workerFailed = false
let nextId = 1

type Pending =
  | {
      kind: 'decode'
      resolve: (value: Map<string, Uint8Array>) => void
      reject: (error: Error) => void
    }
  | {
      kind: 'encode'
      resolve: (value: Uint8Array) => void
      reject: (error: Error) => void
    }
  | {
      kind: 'list'
      resolve: (value: { format: ArchiveCodecFormat; entries: ArchiveEntryMeta[] }) => void
      reject: (error: Error) => void
    }

const pending = new Map<number, Pending>()

function getWorker(): Worker {
  if (worker) return worker
  if (workerFailed) {
    throw new Error('Archive worker 加载失败，请刷新页面重试')
  }
  worker = new ArchiveWorkerCtor()
  worker.onmessage = (event: MessageEvent<ArchiveWorkerResponse>) => {
    const response = event.data
    const entry = pending.get(response.id)
    if (!entry) return
    pending.delete(response.id)
    if (response.type === 'error') {
      entry.reject(new Error(response.message))
      return
    }
    if (response.type === 'decode-done') {
      if (entry.kind !== 'decode') return
      const map = new Map<string, Uint8Array>()
      for (const item of response.entries) {
        map.set(item.path, new Uint8Array(item.bytes))
      }
      entry.resolve(map)
      return
    }
    if (response.type === 'list-done') {
      if (entry.kind !== 'list') return
      entry.resolve({ format: response.format, entries: response.entries })
      return
    }
    if (entry.kind !== 'encode') return
    entry.resolve(new Uint8Array(response.bytes))
  }
  worker.onerror = (event) => {
    workerFailed = true
    const error = new Error(`Archive worker 错误: ${event.message}`)
    for (const entry of pending.values()) {
      entry.reject(error)
    }
    pending.clear()
    worker?.terminate()
    worker = undefined
  }
  return worker
}

/** 发送请求；abort 时拒绝并丢弃迟到响应。 */
function postRequest(
  request: ArchiveWorkerRequest,
  transfer: Transferable[],
  signal?: AbortSignal,
): void {
  if (signal?.aborted) {
    throw new Error('aborted')
  }
  getWorker().postMessage(request, transfer)
}

/**
 * 在 Worker 中解码压缩包字节。
 * zip 默认剥公共根（stripRoot: false 保留归档内路径）。
 */
export async function decodeArchiveInWorker(params: {
  bytes: Uint8Array
  format: 'auto' | ArchiveCodecFormat
  stripRoot?: boolean
  signal?: AbortSignal
}): Promise<Map<string, Uint8Array>> {
  const request: ArchiveWorkerDecodeRequest = {
    type: 'decode',
    id: nextId++,
    format: params.format,
    stripRoot: params.stripRoot ?? true,
    bytes: toExactArrayBuffer(params.bytes),
  }
  let onAbort: (() => void) | undefined
  const promise = new Promise<Map<string, Uint8Array>>((resolve, reject) => {
    if (params.signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    pending.set(request.id, { kind: 'decode', resolve, reject })
    onAbort = () => {
      if (pending.delete(request.id)) {
        reject(new Error('aborted'))
      }
    }
    params.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      postRequest(request, [request.bytes], params.signal)
    } catch (error) {
      pending.delete(request.id)
      if (onAbort) params.signal?.removeEventListener('abort', onAbort)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
  try {
    return await promise
  } finally {
    if (onAbort) params.signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * 在 Worker 中打包：目录文件（相对路径 → 字节）→ zip 或 tar.gz。
 */
export async function encodeArchiveInWorker(params: {
  entries: { path: string; bytes: ArrayBuffer }[]
  format: 'zip' | 'gzip-tar' | 'tar'
  signal?: AbortSignal
}): Promise<Uint8Array> {
  const request: ArchiveWorkerEncodeRequest = {
    type: 'encode',
    id: nextId++,
    format: params.format,
    entries: params.entries.map((entry) => ({
      path: entry.path,
      bytes: toExactArrayBuffer(new Uint8Array(entry.bytes)),
    })),
  }
  let onAbort: (() => void) | undefined
  const promise = new Promise<Uint8Array>((resolve, reject) => {
    if (params.signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    pending.set(request.id, { kind: 'encode', resolve, reject })
    onAbort = () => {
      if (pending.delete(request.id)) {
        reject(new Error('aborted'))
      }
    }
    params.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const transfer = request.entries.map((entry) => entry.bytes)
      postRequest(request, transfer, params.signal)
    } catch (error) {
      pending.delete(request.id)
      if (onAbort) params.signal?.removeEventListener('abort', onAbort)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
  try {
    return await promise
  } finally {
    if (onAbort) params.signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * 在 Worker 中列目录：只读条目元数据（不解压内容）。
 */
export async function listArchiveInWorker(params: {
  bytes: Uint8Array
  format?: 'auto' | ArchiveCodecFormat
  signal?: AbortSignal
}): Promise<{ format: ArchiveCodecFormat; entries: ArchiveEntryMeta[] }> {
  const request: ArchiveWorkerListRequest = {
    type: 'list',
    id: nextId++,
    format: params.format ?? 'auto',
    bytes: toExactArrayBuffer(params.bytes),
  }
  let onAbort: (() => void) | undefined
  const promise = new Promise<{ format: ArchiveCodecFormat; entries: ArchiveEntryMeta[] }>(
    (resolve, reject) => {
      if (params.signal?.aborted) {
        reject(new Error('aborted'))
        return
      }
      pending.set(request.id, { kind: 'list', resolve, reject })
      onAbort = () => {
        if (pending.delete(request.id)) {
          reject(new Error('aborted'))
        }
      }
      params.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        postRequest(request, [request.bytes], params.signal)
      } catch (error) {
        pending.delete(request.id)
        if (onAbort) params.signal?.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    },
  )
  try {
    return await promise
  } finally {
    if (onAbort) params.signal?.removeEventListener('abort', onAbort)
  }
}
