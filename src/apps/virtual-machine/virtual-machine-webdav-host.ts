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
  listDetailed: async (dirPath) => {
    const entries = await filesList(dirPath)
    // 挂载卷的目录列举是懒条目（files-location-mount 为轻量刻意不 stat）：
    // 文件的大小/修改时间都是 0，只有 stat 才读真实元数据。Depth-1 的
    // PROPFIND 按 getcontentlength 显示大小，必须补真值；本地卷条目已带
    // 真值，缺的才补、并行一次 stat 往返。
    const missing = entries.filter(
      (entry) => entry.kind === 'file' && (entry.byteSize === 0 || entry.updatedAt === 0),
    )
    if (missing.length === 0) {
      return entries
    }
    const enriched = await Promise.all(
      missing.map(async (entry) => (await filesStat(entry.path)) ?? entry),
    )
    const byPath = new Map(enriched.map((entry) => [entry.path, entry]))
    return entries.map((entry) => byPath.get(entry.path) ?? entry)
  },
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
