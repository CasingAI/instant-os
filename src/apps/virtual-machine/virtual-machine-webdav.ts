/**
 * 宿主侧 WebDAV 服务器：把客机（XP 映射网络驱动器 Z:）的 DAV 请求映射到
 * Files VFS。协议子集按 XP mrxdav 重定向器的实际需要裁剪：
 *
 * - PROPFIND 请求体一律忽略（v86 HTTP 桥对非 PUT/POST 不转发 body），恒按
 *   allprop 应答；Depth 只认 0/1，其余按 1 处理。
 * - LOCK/UNLOCK/PROPPATCH 是无真实语义的桩：返回成功帧让 Office 等应用
 *   愿意直接打开/保存 Z: 文档；本系统单用户，无真实争用。
 * - 响应不填 Content-Length（v86 桥会剥掉并以 connection: close 定界）。
 *
 * fs 以参数注入：生产环境是 files-api 的薄封装，测试可注入假实现
 * （node 直接跑，不依赖 OPFS）。
 */

export type WebdavRequest = {
  method: string
  url: string
  headers: Record<string, string>
  body?: ArrayBuffer
}

export type WebdavResponse = {
  status: number
  statusText: string
  headers: Record<string, string>
  body?: ArrayBuffer
}

export type WebdavFsEntry = {
  path: string
  name: string
  kind: 'file' | 'folder' | 'symlink'
  mimeType?: string
  byteSize: number
  createdAt: number
  updatedAt: number
}

export type WebdavFs = {
  stat: (path: string) => Promise<WebdavFsEntry | undefined>
  list: (dirPath: string) => Promise<WebdavFsEntry[]>
  readBlob: (path: string) => Promise<Blob>
  readBlobRange: (path: string, offset: number, length: number) => Promise<Blob>
  writeBinary: (path: string, bytes: ArrayBuffer) => Promise<void>
  createBinary: (path: string, bytes: ArrayBuffer) => Promise<void>
  mkdir: (path: string) => Promise<unknown>
  remove: (path: string) => Promise<void>
  rename: (path: string, nextName: string) => Promise<unknown>
  move: (sourcePath: string, destDirPath: string) => Promise<unknown>
  copy: (sourcePath: string, destDirPath: string) => Promise<unknown>
}

const WEBDAV_ALLOW = 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, MOVE, COPY, LOCK, UNLOCK'

export const WEBDAV_LOCK_TOKEN = 'opaquelocktoken:instant-vm-shared-folder'

// ---------------------------------------------------------------------------
// 路径映射
// ---------------------------------------------------------------------------

/**
 * URL 路径 → 共享根下的绝对 VFS 路径。段按 percent-decode 后映射，拒绝
 * `..` 与段内 `/`（%2F）穿越。root 本身必须是已归一的绝对 VFS 路径。
 */
export function webdavTargetPath(url: string, root: string): { ok: true; path: string; segments: string[] } | { ok: false; status: number; statusText: string } {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    return { ok: false, status: 400, statusText: 'Bad Request' }
  }
  const segments: string[] = []
  // 先按原始 pathname 分段，再逐段 decode——若先 decode 再 split，%2F 会被
  // 误当成分隔符（路径混淆）。URL 解析器已把点段（含 %2E%2E 形态）归一化，
  // 段级检查是纵深防御。
  for (const raw of pathname.split('/')) {
    if (raw.length === 0) {
      continue
    }
    let segment: string
    try {
      segment = decodeURIComponent(raw)
    } catch {
      return { ok: false, status: 400, statusText: 'Bad Request' }
    }
    if (segment === '..' || segment === '.' || segment.includes('/') || segment.includes('\\')) {
      return { ok: false, status: 403, statusText: 'Forbidden' }
    }
    segments.push(segment)
  }
  const suffix = segments.length > 0 ? `/${segments.join('/')}` : ''
  return { ok: true, path: `${root.replace(/\/+$/, '')}${suffix}`, segments }
}

/** 从 Destination 头解析目标路径（同 root 规则）。 */
export function webdavDestinationPath(destination: string | undefined, root: string): { ok: true; path: string; segments: string[] } | { ok: false; status: number; statusText: string } {
  if (!destination || destination.length > 2048) {
    return { ok: false, status: 400, statusText: 'Bad Request' }
  }
  return webdavTargetPath(destination, root)
}

function parentPath(path: string): string | undefined {
  const index = path.lastIndexOf('/')
  if (index <= 0) {
    return undefined
  }
  return path.slice(0, index)
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function webdavHref(segments: readonly string[], isFolder: boolean): string {
  if (segments.length === 0) {
    return '/'
  }
  const encoded = segments.map((segment) => encodeURIComponent(segment)).join('/')
  return `/${encoded}${isFolder ? '/' : ''}`
}

function httpDate(epochMs: number): string {
  return new Date(epochMs).toUTCString()
}

function isoDate(epochMs: number): string {
  return new Date(epochMs).toISOString()
}

/**
 * getlastmodified 属性专用：XP 老版 mrxdav 不认 "GMT" 时区名，要 RFC1123
 * 的数字时区形式（"-0400"）；UTC 下即 "+0000"。HTTP Last-Modified 头不受
 * 此限，仍走 httpDate 的 GMT 形式。
 */
function davDate(epochMs: number): string {
  return new Date(epochMs).toUTCString().replace(/ GMT$/, ' +0000')
}

/**
 * XP mrxdav 的 XML 解析对 PROPFIND/PROPPATCH 响应零容忍空白——元素之间
 * 出现换行/缩进即解析失败（net use 报系统错误 67），所有 DAV XML 一律单行
 * 无缝拼接。且不发 displayname：XP 会拿它替代 href 寻址，造成路径错乱。
 */
function propXmlFor(entry: WebdavFsEntry): string {
  const resourceType =
    entry.kind === 'folder'
      ? '<D:resourcetype><D:collection/></D:resourcetype>'
      : '<D:resourcetype/>'
  const fileProps =
    entry.kind === 'folder'
      ? ''
      : `<D:getcontentlength>${Math.max(0, entry.byteSize)}</D:getcontentlength>` +
        `<D:getcontenttype>${escapeXml(entry.mimeType ?? 'application/octet-stream')}</D:getcontenttype>`
  return (
    `<D:prop><D:creationdate>${isoDate(entry.createdAt)}</D:creationdate>` +
    `<D:getlastmodified>${davDate(entry.updatedAt)}</D:getlastmodified>` +
    `${resourceType}${fileProps}</D:prop>`
  )
}

/** 生成 207 multistatus；href 与条目一一对应。 */
export function buildPropfindMultistatus(
  responses: readonly { href: string; entry: WebdavFsEntry }[],
): string {
  let xml = '<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">'
  for (const response of responses) {
    xml +=
      `<D:response><D:href>${escapeXml(response.href)}</D:href>` +
      `<D:propstat>${propXmlFor(response.entry)}` +
      '<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
  }
  return `${xml}</D:multistatus>`
}

function propfindEntryXml(href: string): string {
  return (
    `<D:response><D:href>${escapeXml(href)}</D:href>` +
    '<D:propstat><D:prop/><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
  )
}

export function buildProppatchMultistatus(href: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">' +
    `${propfindEntryXml(href)}</D:multistatus>`
  )
}

function lockDiscoveryXml(): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?><D:prop xmlns:D="DAV:"><D:lockdiscovery>' +
    '<D:activelock><D:locktype><D:write/></D:locktype>' +
    '<D:lockscope><D:exclusive/></D:lockscope><D:depth>0</D:depth>' +
    `<D:timeout>Second-3600</D:timeout><D:locktoken><D:href>${WEBDAV_LOCK_TOKEN}</D:href></D:locktoken>` +
    '</D:activelock></D:lockdiscovery></D:prop>'
  )
}

// ---------------------------------------------------------------------------
// 请求处理
// ---------------------------------------------------------------------------

function textResponse(status: number, statusText: string, message: string): WebdavResponse {
  return {
    status,
    statusText,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: new TextEncoder().encode(message).buffer as ArrayBuffer,
  }
}

function emptyResponse(status: number, statusText: string, headers?: Record<string, string>): WebdavResponse {
  return { status, statusText, headers: headers ?? {} }
}

function xmlResponse(status: number, statusText: string, xml: string, headers?: Record<string, string>): WebdavResponse {
  return {
    status,
    statusText,
    headers: { 'Content-Type': 'text/xml; charset=utf-8', ...headers },
    body: new TextEncoder().encode(xml).buffer as ArrayBuffer,
  }
}

function parseDepth(value: string | undefined): 0 | 1 {
  return value === '0' ? 0 : 1
}

/** Range 头 → [offset, length]；无法解析返回 undefined（按整文件读）。 */
export function parseWebdavRange(value: string | undefined): { offset: number; length: number } | undefined {
  if (!value) {
    return undefined
  }
  const match = /^bytes=(\d+)-(\d+)?$/i.exec(value.trim())
  if (!match) {
    return undefined
  }
  const offset = Number(match[1])
  if (!Number.isFinite(offset) || offset < 0) {
    return undefined
  }
  if (match[2] === undefined) {
    return { offset, length: Number.MAX_SAFE_INTEGER }
  }
  const end = Number(match[2])
  if (!Number.isFinite(end) || end < offset) {
    return undefined
  }
  return { offset, length: end - offset + 1 }
}

export function createWebdavHandler(root: string, fs: WebdavFs): (request: WebdavRequest) => Promise<WebdavResponse> {
  return async (request: WebdavRequest): Promise<WebdavResponse> => {
    const method = request.method.toUpperCase()

    if (method === 'OPTIONS') {
      return emptyResponse(200, 'OK', {
        DAV: '1',
        'MS-Author-Via': 'DAV',
        Allow: WEBDAV_ALLOW,
        'Content-Length': '0',
      })
    }

    const target = webdavTargetPath(request.url, root)
    if (!target.ok) {
      return textResponse(target.status, target.statusText, target.statusText)
    }
    const isRoot = target.segments.length === 0
    const depth = parseDepth(request.headers.Depth)
    const range = parseWebdavRange(request.headers.Range)

    try {
      switch (method) {
        case 'PROPFIND': {
          const entry = await fs.stat(target.path)
          if (!entry) {
            return textResponse(404, 'Not Found', 'Not Found')
          }
          const responses: { href: string; entry: WebdavFsEntry }[] = [
            {
              href: webdavHref(target.segments, entry.kind === 'folder'),
              entry,
            },
          ]
          if (entry.kind === 'folder' && depth === 1) {
            const children = await fs.list(target.path)
            for (const child of children) {
              const childSegments = [...target.segments, child.name]
              responses.push({
                href: webdavHref(childSegments, child.kind === 'folder'),
                entry: child,
              })
            }
          }
          return xmlResponse(207, 'Multi-Status', buildPropfindMultistatus(responses))
        }

        case 'GET':
        case 'HEAD': {
          const entry = await fs.stat(target.path)
          if (!entry) {
            return textResponse(404, 'Not Found', 'Not Found')
          }
          if (entry.kind !== 'file') {
            return textResponse(405, 'Method Not Allowed', 'Not a file')
          }
          const headers: Record<string, string> = {
            'Content-Type': entry.mimeType ?? 'application/octet-stream',
            'Last-Modified': httpDate(entry.updatedAt),
            'Accept-Ranges': 'bytes',
          }
          if (range) {
            const length = Math.min(range.length, Math.max(0, entry.byteSize - range.offset))
            if (range.offset >= entry.byteSize && entry.byteSize > 0) {
              return emptyResponse(416, 'Range Not Satisfiable', {
                'Content-Range': `bytes */${entry.byteSize}`,
              })
            }
            const blob = await fs.readBlobRange(target.path, range.offset, length)
            headers['Content-Range'] = `bytes ${range.offset}-${range.offset + Math.max(0, length) - 1}/${entry.byteSize}`
            const bytes = method === 'HEAD' ? undefined : (await blob.arrayBuffer()) as ArrayBuffer
            return { status: 206, statusText: 'Partial Content', headers, ...(bytes ? { body: bytes } : {}) }
          }
          if (method === 'HEAD') {
            headers['Content-Length'] = String(entry.byteSize)
            return { status: 200, statusText: 'OK', headers }
          }
          const blob = await fs.readBlob(target.path)
          return {
            status: 200,
            statusText: 'OK',
            headers,
            body: (await blob.arrayBuffer()) as ArrayBuffer,
          }
        }

        case 'PUT': {
          if (isRoot) {
            return textResponse(403, 'Forbidden', 'Cannot PUT the share root')
          }
          const parent = parentPath(target.path)
          const parentEntry = parent ? await fs.stat(parent) : undefined
          if (parentEntry?.kind !== 'folder') {
            return textResponse(409, 'Conflict', 'Parent folder missing')
          }
          const existing = await fs.stat(target.path)
          if (existing?.kind === 'folder') {
            return textResponse(405, 'Method Not Allowed', 'Target is a folder')
          }
          const bytes = request.body ?? new ArrayBuffer(0)
          if (existing) {
            await fs.writeBinary(target.path, bytes)
            return emptyResponse(204, 'No Content')
          }
          await fs.createBinary(target.path, bytes)
          return emptyResponse(201, 'Created')
        }

        case 'MKCOL': {
          if (isRoot) {
            return textResponse(405, 'Method Not Allowed', 'Share root already exists')
          }
          if (await fs.stat(target.path)) {
            return textResponse(405, 'Method Not Allowed', 'Already exists')
          }
          const parent = parentPath(target.path)
          if (!parent || (await fs.stat(parent))?.kind !== 'folder') {
            return textResponse(409, 'Conflict', 'Parent folder missing')
          }
          await fs.mkdir(target.path)
          return emptyResponse(201, 'Created')
        }

        case 'DELETE': {
          if (isRoot) {
            return textResponse(403, 'Forbidden', 'Cannot delete the share root')
          }
          const entry = await fs.stat(target.path)
          if (!entry) {
            return textResponse(404, 'Not Found', 'Not Found')
          }
          await fs.remove(target.path)
          return emptyResponse(204, 'No Content')
        }

        case 'MOVE':
        case 'COPY': {
          if (isRoot) {
            return textResponse(403, 'Forbidden', 'Cannot move or copy the share root')
          }
          const destination = webdavDestinationPath(request.headers.Destination, root)
          if (!destination.ok) {
            return textResponse(destination.status, destination.statusText, destination.statusText)
          }
          if (destination.path === target.path) {
            return textResponse(403, 'Forbidden', 'Source and destination are the same')
          }
          const source = await fs.stat(target.path)
          if (!source) {
            return textResponse(404, 'Not Found', 'Not Found')
          }
          const overwrite = request.headers.Overwrite !== 'F'
          const existingDest = await fs.stat(destination.path)
          if (existingDest && !overwrite) {
            return textResponse(412, 'Precondition Failed', 'Destination exists')
          }
          const destParent = parentPath(destination.path)
          if (!destParent || (await fs.stat(destParent))?.kind !== 'folder') {
            return textResponse(409, 'Conflict', 'Destination parent missing')
          }
          const destName = destination.segments[destination.segments.length - 1] ?? ''
          if (!destName) {
            return textResponse(400, 'Bad Request', 'Bad destination')
          }
          if (existingDest) {
            await fs.remove(destination.path)
          }
          if (parentPath(target.path) === destParent) {
            if (method === 'MOVE') {
              await fs.rename(target.path, destName)
              return emptyResponse(201, 'Created')
            }
            // 同目录复制：先复制（无冲突时落在原名上），名字不符则改名
            const copied = await fs.copy(target.path, destParent)
            const copiedEntry = copied as { name?: string }
            if (copiedEntry?.name && copiedEntry.name !== destName) {
              await fs.rename(`${destParent}/${copiedEntry.name}`, destName)
            }
            return emptyResponse(201, 'Created')
          }
          if (method === 'MOVE') {
            await fs.move(target.path, destParent)
            const moved = await fs.stat(`${destParent}/${destName}`)
            const movedName = (moved as { name?: string })?.name
            if (movedName && movedName !== destName) {
              await fs.rename(`${destParent}/${movedName}`, destName)
            }
            return emptyResponse(201, 'Created')
          }
          const copied = await fs.copy(target.path, destParent)
          const copiedEntry = copied as { name?: string }
          if (copiedEntry?.name && copiedEntry.name !== destName) {
            await fs.rename(`${destParent}/${copiedEntry.name}`, destName)
          }
          return emptyResponse(201, 'Created')
        }

        case 'PROPPATCH': {
          return xmlResponse(207, 'Multi-Status', buildProppatchMultistatus(webdavHref(target.segments, false)))
        }

        case 'LOCK': {
          return xmlResponse(200, 'OK', lockDiscoveryXml(), {
            'Lock-Token': `<${WEBDAV_LOCK_TOKEN}>`,
          })
        }

        case 'UNLOCK': {
          return emptyResponse(204, 'No Content')
        }

        default:
          return textResponse(501, 'Not Implemented', `Unsupported method: ${method}`)
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return textResponse(500, 'Internal Server Error', detail || 'WebDAV operation failed')
    }
  }
}
