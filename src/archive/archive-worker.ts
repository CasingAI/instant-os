/// <reference lib="webworker" />

import { gunzipSync } from 'fflate'
import {
  detectArchiveFormat,
  gzipBytes,
  tarBytes,
  toExactArrayBuffer,
  zipBytes,
  type ArchiveCodecFormat,
} from './archive-codec.ts'
import { isoBytes, unisoBytes } from './archive-iso.ts'
import { listArchiveEntries, type ArchiveEntryMeta } from './archive-list.ts'
import { untarBytes } from './archive-untar.ts'
import { unzipBytes } from './archive-unzip.ts'

/**
 * Archive Worker：纯编解码（fflate + tar + iso9660），不碰 VFS。
 * 解码 / 编码都在本线程同步执行（fflate sync 接口），主线程因此不被阻塞。
 * 请求与响应均为判别联合，字节走 transferable ArrayBuffer 转移。
 */

export type ArchiveWorkerDecodeRequest = {
  type: 'decode'
  id: number
  format: 'auto' | ArchiveCodecFormat
  stripRoot: boolean
  bytes: ArrayBuffer
}

export type ArchiveWorkerEncodeRequest = {
  type: 'encode'
  id: number
  format: 'zip' | 'gzip-tar' | 'tar' | 'iso'
  entries: { path: string; bytes: ArrayBuffer }[]
}

export type ArchiveWorkerListRequest = {
  type: 'list'
  id: number
  format: 'auto' | ArchiveCodecFormat
  bytes: ArrayBuffer
}

export type ArchiveWorkerRequest =
  | ArchiveWorkerDecodeRequest
  | ArchiveWorkerEncodeRequest
  | ArchiveWorkerListRequest

export type ArchiveWorkerResponse =
  | { type: 'decode-done'; id: number; entries: { path: string; bytes: ArrayBuffer }[] }
  | { type: 'encode-done'; id: number; bytes: ArrayBuffer }
  | { type: 'list-done'; id: number; format: ArchiveCodecFormat; entries: ArchiveEntryMeta[] }
  | { type: 'error'; id: number; message: string }

function post(payload: ArchiveWorkerResponse): void {
  ;(self as unknown as Worker).postMessage(payload)
}

function toTransferableEntries(map: Map<string, Uint8Array>): { path: string; bytes: ArrayBuffer }[] {
  return [...map.entries()].map(([path, bytes]) => ({
    path,
    bytes: toExactArrayBuffer(bytes),
  }))
}

function handleDecode(request: ArchiveWorkerDecodeRequest): void {
  try {
    const input = new Uint8Array(request.bytes)
    const detected = request.format === 'auto' ? detectArchiveFormat(input) : request.format
    if (detected === undefined) {
      throw new Error('无法识别的压缩包格式')
    }
    const format = detected

    let entries: Map<string, Uint8Array>
    switch (format) {
      case 'zip':
        entries = unzipBytes(input, { stripRoot: request.stripRoot })
        break
      case 'iso':
        entries = unisoBytes(input)
        break
      case 'tar':
        entries = new Map(Object.entries(untarBytes(input)))
        break
      case 'gzip-tar': {
        // 与旧 decodeGzipTar 同语义：gunzip 失败则当裸 tar 解（不引 archive-extract，
        // 避免把 files-api / IndexedDB 依赖链拖进 Worker bundle）
        let tarData: Uint8Array
        try {
          tarData = gunzipSync(input)
        } catch {
          tarData = input
        }
        entries = new Map(Object.entries(untarBytes(tarData)))
        break
      }
      case 'gzip-file':
        entries = new Map([['data', gunzipSync(input)]])
        break
      default:
        throw new Error('无法识别的压缩包格式')
    }

    post({
      type: 'decode-done',
      id: request.id,
      entries: toTransferableEntries(entries),
    })
  } catch (error) {
    post({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function handleEncode(request: ArchiveWorkerEncodeRequest): void {
  try {
    const files: Record<string, Uint8Array> = {}
    for (const entry of request.entries) {
      files[entry.path] = new Uint8Array(entry.bytes)
    }
    const out =
      request.format === 'zip'
        ? zipBytes(files)
        : request.format === 'tar'
          ? tarBytes(files)
          : request.format === 'iso'
            ? isoBytes(files)
            : gzipBytes(tarBytes(files))
    post({ type: 'encode-done', id: request.id, bytes: toExactArrayBuffer(out) })
  } catch (error) {
    post({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function handleList(request: ArchiveWorkerListRequest): void {
  try {
    const listing = listArchiveEntries(new Uint8Array(request.bytes), request.format)
    post({ type: 'list-done', id: request.id, format: listing.format, entries: listing.entries })
  } catch (error) {
    post({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

self.onmessage = (event: MessageEvent<ArchiveWorkerRequest>) => {
  const request = event.data
  if (request.type === 'decode') {
    handleDecode(request)
  } else if (request.type === 'list') {
    handleList(request)
  } else {
    handleEncode(request)
  }
}

// 让 TS 把此文件当 worker 模块
export {}
