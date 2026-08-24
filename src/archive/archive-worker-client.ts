import ArchiveWorkerCtor from './archive-worker.ts?worker'
import type {
  ArchiveWorkerDecodeRequest,
  ArchiveWorkerEncodeRequest,
  ArchiveWorkerListRequest,
} from './archive-worker.ts'
import {
  toExactArrayBuffer,
  type ArchiveCodecFormat,
} from './archive-codec.ts'
import type { ArchiveEntryMeta } from './archive-list.ts'
import { runArchiveWorkerJob, type ArchiveJobWorker } from './archive-worker-job.ts'

/**
 * Archive Worker 浏览器客户端。
 *
 * - 本模块含静态 `?worker` 导入（Vite 专用语法），只能被浏览器加载；
 *   files-api 通过动态 import 引用本模块，node 测试不执行到该路径。
 * - 每个请求新建一只 Worker；取消时 terminate 这一只，立刻打断同步编解码。
 * - 入参字节先复制为独立 ArrayBuffer 再转移，调用方持有的视图不受影响。
 */

let nextId = 1

function createArchiveWorker(): ArchiveJobWorker {
  return new ArchiveWorkerCtor() as ArchiveJobWorker
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
  const response = await runArchiveWorkerJob({
    createWorker: createArchiveWorker,
    request,
    transfer: [request.bytes],
    signal: params.signal,
  })
  if (response.type !== 'decode-done') {
    throw new Error('Archive worker 响应不匹配')
  }
  const map = new Map<string, Uint8Array>()
  for (const item of response.entries) {
    map.set(item.path, new Uint8Array(item.bytes))
  }
  return map
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
  const transfer = request.entries.map((entry) => entry.bytes)
  const response = await runArchiveWorkerJob({
    createWorker: createArchiveWorker,
    request,
    transfer,
    signal: params.signal,
  })
  if (response.type !== 'encode-done') {
    throw new Error('Archive worker 响应不匹配')
  }
  return new Uint8Array(response.bytes)
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
  const response = await runArchiveWorkerJob({
    createWorker: createArchiveWorker,
    request,
    transfer: [request.bytes],
    signal: params.signal,
  })
  if (response.type !== 'list-done') {
    throw new Error('Archive worker 响应不匹配')
  }
  return { format: response.format, entries: response.entries }
}
