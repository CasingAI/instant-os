/// <reference lib="webworker" />

import { writeToOpfsSyncAccess } from './files-opfs-sync-range.ts'

/**
 * OPFS 原地写入 Worker。SyncAccessHandle 只能在 Dedicated Worker 里打开。
 * 会话：打开句柄、多次按偏移写、关闭 / 中止；避免 createWritable(keepExistingData)
 * 把整份正文拷进内存。
 */

export type OpfsAccessOpenRequest = {
  type: 'open'
  id: number
  handle: FileSystemFileHandle
}

export type OpfsAccessWriteRequest = {
  type: 'write'
  id: number
  sessionId: number
  offset: number
  bytes: ArrayBuffer
}

export type OpfsAccessFlushRequest = {
  type: 'flush'
  id: number
  sessionId: number
}

export type OpfsAccessCloseRequest = {
  type: 'close'
  id: number
  sessionId: number
}

export type OpfsAccessAbortRequest = {
  type: 'abort'
  id: number
  sessionId: number
}

export type OpfsAccessRequest =
  | OpfsAccessOpenRequest
  | OpfsAccessWriteRequest
  | OpfsAccessFlushRequest
  | OpfsAccessCloseRequest
  | OpfsAccessAbortRequest

export type OpfsAccessResponse =
  | { type: 'opened'; id: number; sessionId: number }
  | { type: 'write-done'; id: number; size: number }
  | { type: 'flushed'; id: number }
  | { type: 'closed'; id: number }
  | { type: 'aborted'; id: number }
  | { type: 'error'; id: number; message: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function adaptAccess(access: FileSystemSyncAccessHandle) {
  return {
    getSize: () => access.getSize(),
    truncate: (size: number) => access.truncate(size),
    write: (buffer: ArrayBuffer, options?: { at?: number }) => access.write(buffer, options),
    flush: () => access.flush(),
  }
}

const sessions = new Map<number, FileSystemSyncAccessHandle>()
let nextSessionId = 1

function closeAccess(access: FileSystemSyncAccessHandle): void {
  try {
    access.flush()
  } catch {
    // 关闭前尽量刷盘；失败仍要 close
  }
  access.close()
}

async function handleOpen(request: OpfsAccessOpenRequest): Promise<OpfsAccessResponse> {
  const access = await request.handle.createSyncAccessHandle()
  const sessionId = nextSessionId
  nextSessionId += 1
  sessions.set(sessionId, access)
  return { type: 'opened', id: request.id, sessionId }
}

async function handleWrite(request: OpfsAccessWriteRequest): Promise<OpfsAccessResponse> {
  const access = sessions.get(request.sessionId)
  if (!access) {
    throw new Error('OPFS 写入会话不存在')
  }
  const size = await writeToOpfsSyncAccess(
    adaptAccess(access),
    request.offset,
    new Uint8Array(request.bytes),
  )
  return { type: 'write-done', id: request.id, size }
}

function handleClose(request: OpfsAccessCloseRequest): OpfsAccessResponse {
  const access = sessions.get(request.sessionId)
  sessions.delete(request.sessionId)
  if (access) {
    closeAccess(access)
  }
  return { type: 'closed', id: request.id }
}

function handleAbort(request: OpfsAccessAbortRequest): OpfsAccessResponse {
  const access = sessions.get(request.sessionId)
  sessions.delete(request.sessionId)
  if (access) {
    try {
      access.close()
    } catch {
      // 已关闭
    }
  }
  return { type: 'aborted', id: request.id }
}

async function handleFlush(request: OpfsAccessFlushRequest): Promise<OpfsAccessResponse> {
  const access = sessions.get(request.sessionId)
  if (!access) {
    throw new Error('OPFS 写入会话不存在')
  }
  access.flush()
  return { type: 'flushed', id: request.id }
}

async function handleRequest(request: OpfsAccessRequest): Promise<void> {
  try {
    let response: OpfsAccessResponse
    if (request.type === 'open') {
      response = await handleOpen(request)
    } else if (request.type === 'write') {
      response = await handleWrite(request)
    } else if (request.type === 'flush') {
      response = await handleFlush(request)
    } else if (request.type === 'close') {
      response = handleClose(request)
    } else {
      response = handleAbort(request)
    }
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
