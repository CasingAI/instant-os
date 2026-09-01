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

/** [排障埋点·临时] 宿主侧 DAV 应答全量打点（与运行时 SF3-resp 同落一份日志）。随埋点一起删。 */
function zdebug(probeId: string, data: unknown): void {
  ;(window as unknown as { Z_DEBUGGER?: (id: string, data: unknown) => void }).Z_DEBUGGER?.(
    probeId,
    data,
  )
}

function textHead(bytes: ArrayBuffer | undefined): string {
  if (!bytes || bytes.byteLength === 0) {
    return ''
  }
  const view = new Uint8Array(bytes.slice(0, 180))
  let out = ''
  for (const ch of view) {
    out += ch >= 0x20 && ch < 0x7f ? String.fromCharCode(ch) : '.'
  }
  return out
}

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
    // [埋点] 共享文件夹排障：每个 DAV 请求的方法/路径/应答状态。
    console.log(
      '[vm-webdav-host]',
      request.method,
      request.url,
      '->',
      result.status,
      sharedRoot ? `(root=${sharedRoot})` : '(root 未设置!)',
    )
    // [排障埋点·临时] 应答状态与响应体头部随 SF10 落日志。随埋点一起删。
    zdebug('SF10', {
      method: request.method,
      url: request.url,
      status: result.status,
      statusText: result.statusText,
      head: textHead(result.body),
      root: sharedRoot ?? null,
    })
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
