import {
  filesCopy,
  filesCreateBinary,
  filesList,
  filesMkdir,
  filesMove,
  filesReadBlob,
  filesReadBlobRange,
  filesRemove,
  filesRename,
  filesStat,
  filesWriteBinary,
} from '../files/files-api.ts'
import {
  INSTANT_VM_MESSAGE_TYPE,
  isInstantVmWebdavRequestMessage,
  type InstantVmWebdavResultMessage,
} from './virtual-machine-protocol.ts'
import { isRuntimeOrigin, postSource } from './virtual-machine-disk-stream-host.ts'
import { createWebdavHandler, type WebdavFs } from './virtual-machine-webdav.ts'

/**
 * 宿主侧 WebDAV 消息监听器（共享文件夹）。
 *
 * 与 disk-stream-host 同款模式：独立 message 监听 + 运行时 origin 校验 +
 * postSource 直气回执（不走 pending map），GET 响应体以 transfer 交接。
 * 共享根由设置流程注入（setWebdavSharedRoot）；未配置时对请求回 503。
 */

const realFs: WebdavFs = {
  stat: filesStat,
  list: filesList,
  readBlob: filesReadBlob,
  readBlobRange: filesReadBlobRange,
  writeBinary: async (path, bytes) => {
    await filesWriteBinary(path, bytes)
  },
  createBinary: async (path, bytes) => {
    await filesCreateBinary(path, bytes)
  },
  mkdir: filesMkdir,
  remove: filesRemove,
  rename: filesRename,
  move: filesMove,
  copy: filesCopy,
}

let sharedRoot: string | undefined
let handler = createWebdavHandler('', realFs)
let listenerInstalled = false

function isSourcePostable(source: MessageEvent['source']):
  | {
      postMessage: (
        message: unknown,
        options: { targetOrigin: string; transfer?: Transferable[] },
      ) => void
    }
  | undefined {
  if (source === null || typeof source !== 'object' || !('postMessage' in source)) {
    return undefined
  }
  const candidate = source as {
    postMessage: (
      message: unknown,
      options: { targetOrigin: string; transfer?: Transferable[] },
    ) => void
  }
  return typeof candidate.postMessage === 'function' ? candidate : undefined
}

function onWebdavMessage(event: MessageEvent): void {
  if (!isInstantVmWebdavRequestMessage(event.data)) {
    return
  }
  if (!isRuntimeOrigin(event.origin)) {
    console.warn('[vm-webdav-host] 忽略来自非运行时源的共享文件夹请求', event.origin)
    return
  }
  const target = isSourcePostable(event.source)
  if (!target) {
    return
  }
  const request = event.data
  const origin = event.origin

  void (async () => {
    let result: InstantVmWebdavResultMessage
    if (!sharedRoot) {
      result = {
        type: INSTANT_VM_MESSAGE_TYPE.webdavResult,
        requestId: request.requestId,
        status: 503,
        statusText: 'Service Unavailable',
        headers: {},
      }
    } else {
      try {
        const response = await handler(request)
        result = {
          type: INSTANT_VM_MESSAGE_TYPE.webdavResult,
          requestId: request.requestId,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          body: response.body,
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        result = {
          type: INSTANT_VM_MESSAGE_TYPE.webdavResult,
          requestId: request.requestId,
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          body: new TextEncoder().encode(detail || 'WebDAV failed').buffer as ArrayBuffer,
        }
      }
    }
    postSource(target, result, origin, result.body ? [result.body] : [])
  })()
}

/** 更新共享根路径（可随时切换；undefined = 关闭，请求一律 503）。 */
export function setWebdavSharedRoot(root: string | undefined): void {
  sharedRoot = root
  handler = createWebdavHandler(root ?? '', realFs)
  if (!listenerInstalled) {
    listenerInstalled = true
    window.addEventListener('message', onWebdavMessage)
  }
}

export function getWebdavSharedRoot(): string | undefined {
  return sharedRoot
}
