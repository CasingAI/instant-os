/// <reference lib="webworker" />

import { writeThroughOpfsSyncAccess } from './files-opfs-sync-range.ts'

/**
 * OPFS 原地写入 Worker。SyncAccessHandle 只能在 Dedicated Worker 里打开，
 * 按偏移写完即关，避免和主线程读同一份正文抢锁。
 */

export type OpfsAccessWriteRangeRequest = {
  type: 'write-range'
  id: number
  handle: FileSystemFileHandle
  offset: number
  bytes: ArrayBuffer
}

export type OpfsAccessResponse =
  | { type: 'write-range-done'; id: number; size: number }
  | { type: 'error'; id: number; message: string }

export type OpfsAccessRequest = OpfsAccessWriteRangeRequest

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function writeRange(request: OpfsAccessWriteRangeRequest): Promise<number> {
  const access = await request.handle.createSyncAccessHandle()
  try {
    return await writeThroughOpfsSyncAccess(
      {
        getSize: () => access.getSize(),
        truncate: (size) => access.truncate(size),
        write: (buffer, options) => access.write(buffer, options),
        flush: () => access.flush(),
      },
      request.offset,
      new Uint8Array(request.bytes),
    )
  } finally {
    access.close()
  }
}

async function handleRequest(request: OpfsAccessRequest): Promise<void> {
  try {
    const size = await writeRange(request)
    const response: OpfsAccessResponse = { type: 'write-range-done', id: request.id, size }
    self.postMessage(response)
  } catch (error) {
    const response: OpfsAccessResponse = {
      type: 'error',
      id: request.id,
      message: errorMessage(error) || 'OPFS 原地写入失败',
    }
    self.postMessage(response)
  }
}

let chain: Promise<void> = Promise.resolve()

self.onmessage = (event: MessageEvent<OpfsAccessRequest>) => {
  const request = event.data
  chain = chain.then(
    () => handleRequest(request),
    () => handleRequest(request),
  )
}
