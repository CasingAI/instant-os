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
  /**
   * 带真实大小的列举（可选）。挂载卷的 list 是懒条目——文件不带大小和修改
   * 时间（files-location-mount 为轻量列举刻意不 stat），stat 才是真值；
   * Depth-1 的 PROPFIND 需要真值（XP 列表按 getcontentlength 显示大小），
   * 经此枚举；未提供时退回 list。
   */
  listDetailed?: (dirPath: string) => Promise<WebdavFsEntry[]>
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
// 共享目录同步（subst 方案的客机侧拉取）
// ---------------------------------------------------------------------------

/** 保留路径：客机引导脚本下载的同步脚本本体。 */
export const SHARE_SYNC_SCRIPT_PATH = '/__sync_script'
/** 保留路径：同步清单（D/目录、F/文件，行 = 类型<TAB>相对路径）。 */
export const SHARE_SYNC_MANIFEST_PATH = '/__sync_manifest'

/** 一期探针只读夹具。UNC `\\host\DavWWWRoot\__clip_probe` 对应此 URL 前缀。 */
export const CLIP_PROBE_ROOT = '/__clip_probe'

const CLIP_PROBE_HELLO = 'clip-dav-probe-hello'
const CLIP_PROBE_A = 'alpha'
const CLIP_PROBE_B = 'beta'
const CLIP_PROBE_STAMP = Date.UTC(2026, 8, 10, 6, 0, 0)

/**
 * 二进制夹具体积阶梯。第四轮实测：单个 105 MiB 响应经 v86 fetch 桥送达客机时
 * 卡死（宿主 321ms 生成并回完，之后客机再无动静）。v86 的假网络是**逐段
 * 停等**（每 ~1460 字节一段、等客机 ACK 才发下一段），105 MiB 约 7.5 万次往返，
 * 且 `GrowableRingbuffer` 要一次性涨到 256 MiB。阶梯用来量出真正的可用上限。
 * 全部低于 INSTANT_VM_WEBDAV_BODY_MAX_BYTES(128MiB)。
 */
export const CLIP_PROBE_BIN_SIZES: Readonly<Record<string, number>> = {
  'big.bin': 105 * 1024 * 1024,
  'ladder-256k.bin': 256 * 1024,
  'ladder-1m.bin': 1 * 1024 * 1024,
  'ladder-4m.bin': 4 * 1024 * 1024,
  'ladder-16m.bin': 16 * 1024 * 1024,
  'ladder-32m.bin': 32 * 1024 * 1024,
  'ladder-64m.bin': 64 * 1024 * 1024,
}
/** 大文件夹具名与体积（105 MiB，>100MB 量级）。 */
export const CLIP_PROBE_BIG_NAME = 'big.bin'
export const CLIP_PROBE_BIG_BYTES = CLIP_PROBE_BIN_SIZES[CLIP_PROBE_BIG_NAME]!

export function isClipProbeUrl(url: string): boolean {
  try {
    return decodeClipProbePathname(new URL(url).pathname) !== undefined
  } catch {
    return false
  }
}

function decodeClipProbePathname(pathname: string): string | undefined {
  const trimmed = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  if (trimmed !== CLIP_PROBE_ROOT && !trimmed.startsWith(`${CLIP_PROBE_ROOT}/`)) {
    return undefined
  }
  return trimmed
}

function clipProbeRel(pathname: string): string {
  if (pathname === CLIP_PROBE_ROOT) {
    return ''
  }
  return pathname.slice(CLIP_PROBE_ROOT.length + 1)
}

/** 文本夹具正文；二进制夹具不在表内（走 CLIP_PROBE_BIN_SIZES）。 */
function clipProbeFileText(rel: string): string | undefined {
  if (rel === 'hello.txt') {
    return CLIP_PROBE_HELLO
  }
  if (rel === 'tree/a.txt') {
    return CLIP_PROBE_A
  }
  if (rel === 'tree/sub/b.txt') {
    return CLIP_PROBE_B
  }
  return undefined
}

function clipProbeBinSize(rel: string): number | undefined {
  return Object.prototype.hasOwnProperty.call(CLIP_PROBE_BIN_SIZES, rel)
    ? CLIP_PROBE_BIN_SIZES[rel]
    : undefined
}

function clipProbeIsFile(rel: string): boolean {
  return clipProbeFileText(rel) !== undefined || clipProbeBinSize(rel) !== undefined
}

function clipProbeFileSize(rel: string): number {
  const text = clipProbeFileText(rel)
  if (text !== undefined) {
    return new TextEncoder().encode(text).byteLength
  }
  return clipProbeBinSize(rel) ?? 0
}

/** 把 offset 所在 64 字节块的标记写进 `out`（`out` 是 [windowStart, +out.length) 的切片）。 */
function writeClipProbeBinMarker(
  out: Uint8Array,
  markerOffset: number,
  markerLength: number,
  windowStart: number,
): void {
  const line = `INSTANT-VM-CLIP-PROBE ${String(markerOffset).padStart(10, '0')} `
  const limit = Math.min(markerLength, line.length)
  for (let i = 0; i < limit; i += 1) {
    const at = markerOffset + i - windowStart
    if (at >= 0 && at < out.length) {
      out[at] = line.charCodeAt(i) & 0x7f
    }
  }
}

/**
 * 二进制夹具全文：每 64 字节一段 `INSTANT-VM-CLIP-PROBE <10 位偏移> ` 标记，
 * 客机端抽头即可核对错位/截断。
 *
 * 每次调用生成一份**新的**数组：响应体经 postMessage 以 transfer 交接，
 * 缓存的缓冲会被 detach，第二次取数就成了空壳。范围请求走 clipProbeBinRange，
 * 只物化被请求的窗口。
 */
function clipProbeBinBytes(total: number): Uint8Array {
  const bytes = new Uint8Array(total)
  for (let offset = 0; offset < total; offset += 64) {
    writeClipProbeBinMarker(bytes, offset, Math.min(64, total - offset), 0)
  }
  return bytes
}

/** 只物化二进制夹具在 [offset, offset+length) 的字节。 */
function clipProbeBinRange(total: number, offset: number, length: number): Uint8Array {
  const want = Math.max(0, Math.min(length, total - offset))
  const out = new Uint8Array(want)
  for (let marker = offset - (offset % 64); marker < offset + want; marker += 64) {
    writeClipProbeBinMarker(out, marker, 64, offset)
  }
  return out
}

function clipProbeBytes(rel: string): Uint8Array {
  const text = clipProbeFileText(rel)
  if (text !== undefined) {
    return new TextEncoder().encode(text)
  }
  return clipProbeBinBytes(clipProbeBinSize(rel) ?? 0)
}

/** 视图已覆盖整块缓冲时直接交底，避免大文件整份再拷一次。 */
function clipProbeArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function clipProbeIsFolder(rel: string): boolean {
  return rel === '' || rel === 'tree' || rel === 'tree/sub'
}

function clipProbeChildren(rel: string): { name: string; rel: string; folder: boolean }[] {
  if (rel === '') {
    const bins = Object.keys(CLIP_PROBE_BIN_SIZES).map((name) => ({
      name,
      rel: name,
      folder: false,
    }))
    return [{ name: 'hello.txt', rel: 'hello.txt', folder: false }, ...bins, { name: 'tree', rel: 'tree', folder: true }]
  }
  if (rel === 'tree') {
    return [
      { name: 'a.txt', rel: 'tree/a.txt', folder: false },
      { name: 'sub', rel: 'tree/sub', folder: true },
    ]
  }
  if (rel === 'tree/sub') {
    return [{ name: 'b.txt', rel: 'tree/sub/b.txt', folder: false }]
  }
  return []
}

function clipProbeEntry(rel: string, folder: boolean): WebdavFsEntry {
  const name = rel === '' ? '__clip_probe' : (rel.split('/').pop() ?? rel)
  return {
    path: `${CLIP_PROBE_ROOT}/${rel}`.replace(/\/$/, ''),
    name,
    kind: folder ? 'folder' : 'file',
    mimeType: folder ? undefined : clipProbeBinSize(rel) !== undefined ? 'application/octet-stream' : 'text/plain',
    byteSize: folder ? 0 : clipProbeFileSize(rel),
    createdAt: CLIP_PROBE_STAMP,
    updatedAt: CLIP_PROBE_STAMP,
  }
}

/**
 * 客机侧同步脚本（VBScript，cscript 执行，系统 ANSI 无中文）。
 * 引导脚本（exec echo 写入的 8 行）下载本文件后执行；它再拉清单、逐文件
 * 拉取写入 C:\InstantShare。文件名含中文时清单以 UTF-8 下发，ServerXMLHTTP
 * responseText 按 charset 解码成 Unicode，FSO 落盘自动转本机 ANSI 文件名。
 */
export const SHARE_SYNC_SCRIPT = [
  'Option Explicit',
  'On Error Resume Next',
  'Dim fso, log, x, s, lines, line, parts, kind, url, local, root, n',
  'root = "C:\\InstantShare"',
  'Set fso = CreateObject("Scripting.FileSystemObject")',
  'If Err.Number <> 0 Then WScript.Quit 1',
  'Set log = fso.OpenTextFile("C:\\Tools\\share-sync.txt", 8, True)',
  'log.WriteLine Now & " sync begin"',
  'Set x = CreateObject("MSXML2.ServerXMLHTTP")',
  'x.Open "GET", "http://192.168.87.1/__sync_manifest", False',
  'x.Send',
  'If x.status <> 200 Then',
  '  log.WriteLine "manifest status=" & x.status',
  '  log.Close',
  '  WScript.Quit 1',
  'End If',
  'lines = Split(x.responseText, vbLf)',
  'For Each line In lines',
  '  line = Trim(line)',
  '  If Len(line) > 0 Then',
  '    kind = Left(line, 1)',
  '    If kind = "D" Then',
  '      local = Mid(line, 3)',
  '      If Not fso.FolderExists(root & "\\" & local) Then',
  '        fso.CreateFolder root & "\\" & local',
  '        log.WriteLine "mkdir " & local',
  '      End If',
  '    ElseIf kind = "F" Then',
  '      parts = Split(line, Chr(9))',
  '      url = parts(1)',
  '      local = parts(2)',
  '      x.Open "GET", "http://192.168.87.1/" & url, False',
  '      x.Send',
  '      If x.status <> 200 Then',
  '        log.WriteLine "fail " & url & " status=" & x.status',
  '      Else',
  '        Set s = CreateObject("ADODB.Stream")',
  '        s.Open',
  '        s.Type = 1',
  '        s.Write x.responseBody',
  '        s.SaveToFile root & "\\" & local, 2',
  '        s.Close',
  '        Set s = Nothing',
  '        If Err.Number <> 0 Then',
  '          log.WriteLine "savefail " & local & " 0x" & Hex(Err.Number) & " " & Err.Description',
  '          Err.Clear',
  '        Else',
  '          n = UBound(x.responseBody) + 1',
  '          log.WriteLine "saved " & local & " bytes=" & n',
  '        End If',
  '      End If',
  '    End If',
  '  End If',
  'Next',
  'log.WriteLine Now & " sync done"',
  'log.Close',
].join('\r\n')

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

/**
 * 大小写不敏感的头取值。桥传上来的 headers 由运行时 Headers 对象转换，
 * 键一律小写（depth/range/destination/overwrite），而旧版按协议大写
 * 查找（Depth/Range…）全部落空——Depth:0 的 PROPFIND 因此被按 1 处理、
 * 应答塞进整个目录的子条目，XP MiniRedir 判应答无效退回 SMB 报
 * 「找不到网络路径」。统一经此查找防再犯。
 */
function headerValue(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined
  }
  if (headers[name] !== undefined) {
    return headers[name]
  }
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value
    }
  }
  return undefined
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

function handleClipProbe(request: WebdavRequest, pathname: string): WebdavResponse | undefined {
  const normalized = decodeClipProbePathname(pathname)
  if (normalized === undefined) {
    return undefined
  }
  const method = request.method.toUpperCase()
  const rel = clipProbeRel(normalized)
  const folder = clipProbeIsFolder(rel)
  if (method === 'PUT' && rel === 'sink') {
    // Upload measurement sink: accept and discard the body. Used by the probe
    // to time guest->host throughput (the reverse direction of the slow GET),
    // which distinguishes "guest ACKs slowly" from "both directions slow".
    return emptyResponse(201, 'Created')
  }
  if (!folder && !clipProbeIsFile(rel)) {
    return textResponse(404, 'Not Found', 'Not Found')
  }
  if (method === 'GET' || method === 'HEAD') {
    if (folder) {
      return textResponse(405, 'Method Not Allowed', 'Not a file')
    }
    const binSize = clipProbeBinSize(rel)
    const total = clipProbeFileSize(rel)
    const headers: Record<string, string> = {
      'Content-Type': binSize !== undefined ? 'application/octet-stream' : 'text/plain; charset=utf-8',
      'Last-Modified': httpDate(CLIP_PROBE_STAMP),
      'Accept-Ranges': 'bytes',
    }
    const range = parseWebdavRange(headerValue(request.headers, 'Range'))
    if (range) {
      if (range.offset >= total && total > 0) {
        return emptyResponse(416, 'Range Not Satisfiable', {
          'Content-Range': `bytes */${total}`,
        })
      }
      const length = Math.min(range.length, Math.max(0, total - range.offset))
      headers['Content-Range'] = `bytes ${range.offset}-${range.offset + length - 1}/${total}`
      headers['Content-Length'] = String(length)
      if (method === 'HEAD') {
        return { status: 206, statusText: 'Partial Content', headers }
      }
      const slice =
        binSize !== undefined
          ? clipProbeBinRange(binSize, range.offset, length)
          : clipProbeBytes(rel).subarray(range.offset, range.offset + length)
      return {
        status: 206,
        statusText: 'Partial Content',
        headers,
        body: clipProbeArrayBuffer(slice),
      }
    }
    if (method === 'HEAD') {
      headers['Content-Length'] = String(total)
      return { status: 200, statusText: 'OK', headers }
    }
    return {
      status: 200,
      statusText: 'OK',
      headers,
      body: clipProbeArrayBuffer(clipProbeBytes(rel)),
    }
  }
  if (method === 'PROPFIND') {
    let requestedHref = pathname
    try {
      requestedHref = new URL(request.url).pathname || pathname
    } catch {
      requestedHref = pathname
    }
    const self = clipProbeEntry(rel, folder)
    const responses: { href: string; entry: WebdavFsEntry }[] = [{ href: requestedHref, entry: self }]
    const depth = parseDepth(headerValue(request.headers, 'Depth'))
    if (folder && depth === 1) {
      for (const child of clipProbeChildren(rel)) {
        const segments = ['__clip_probe', ...child.rel.split('/').filter(Boolean)]
        responses.push({
          href: webdavHref(segments, child.folder),
          entry: clipProbeEntry(child.rel, child.folder),
        })
      }
    }
    return xmlResponse(207, 'Multi-Status', buildPropfindMultistatus(responses))
  }
  if (method === 'PUT') {
    return emptyResponse(405, 'Method Not Allowed')
  }
  return emptyResponse(405, 'Method Not Allowed')
}

export function createWebdavHandler(root: string, fs: WebdavFs): (request: WebdavRequest) => Promise<WebdavResponse> {
  return async (request: WebdavRequest): Promise<WebdavResponse> => {
    const method = request.method.toUpperCase()

    // 同步脚本/清单走保留路径，绕过 DAV 语义（subst 方案的客机侧拉取）。
    let pathname = ''
    try {
      pathname = new URL(request.url).pathname
    } catch {
      pathname = ''
    }
    if (pathname === SHARE_SYNC_SCRIPT_PATH) {
      if (method !== 'GET') {
        return emptyResponse(405, 'Method Not Allowed')
      }
      return textResponse(200, 'OK', SHARE_SYNC_SCRIPT)
    }
    if (pathname === SHARE_SYNC_MANIFEST_PATH) {
      if (method !== 'GET') {
        return emptyResponse(405, 'Method Not Allowed')
      }
      const lines: string[] = []
      let visited = 0
      const walk = async (dir: string, prefix: string): Promise<void> => {
        if (visited > 20_000) {
          return
        }
        for (const entry of await fs.list(dir)) {
          if (visited > 20_000) {
            return
          }
          visited += 1
          if (entry.kind === 'symlink') {
            continue
          }
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name
          if (entry.kind === 'folder') {
            lines.push(`D\t${rel.split('/').join('\\')}`)
            await walk(entry.path, rel)
          } else {
            const urlPath = rel
              .split('/')
              .map((segment) => encodeURIComponent(segment))
              .join('/')
            lines.push(`F\t${urlPath}\t${rel.split('/').join('\\')}`)
          }
        }
      }
      await walk(root.replace(/\/+$/, ''), '')
      return textResponse(200, 'OK', `${lines.join('\n')}\n`)
    }

    if (method === 'OPTIONS') {
      return emptyResponse(200, 'OK', {
        DAV: '1',
        'MS-Author-Via': 'DAV',
        Allow: WEBDAV_ALLOW,
        'Content-Length': '0',
      })
    }

    const clipProbe = handleClipProbe(request, pathname)
    if (clipProbe) {
      return clipProbe
    }

    const target = webdavTargetPath(request.url, root)
    if (!target.ok) {
      return textResponse(target.status, target.statusText, target.statusText)
    }
    const isRoot = target.segments.length === 0
    const depth = parseDepth(headerValue(request.headers, 'Depth'))
    const range = parseWebdavRange(headerValue(request.headers, 'Range'))

    try {
      switch (method) {
        case 'PROPFIND': {
          const entry = await fs.stat(target.path)
          if (!entry) {
            return textResponse(404, 'Not Found', 'Not Found')
          }
          // XP MiniRedir 对「被请求资源」的 href 要求与请求 URI 精确一致（含
          // 尾斜杠形态）：根请求 '/' 恰好匹配所以列表正常；点开子文件夹时它
          // 发 PROPFIND /out（无尾斜杠），应答 href 若归一化成 /out/ 即失配，
          // 重定向器判资源不存在、退回 SMB 报「找不到网络路径」。目标条目
          // 原样回显请求 pathname，子条目仍用规范形（目录带尾斜杠）。
          let requestedHref = '/'
          try {
            requestedHref = new URL(request.url).pathname || '/'
          } catch {
            // URL 已由 webdavTargetPath 校验过，不会走到这里。
          }
          const responses: { href: string; entry: WebdavFsEntry }[] = [
            {
              href: requestedHref,
              entry,
            },
          ]
          if (entry.kind === 'folder' && depth === 1) {
            const children = await (fs.listDetailed ?? fs.list)(target.path)
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
          const destination = webdavDestinationPath(headerValue(request.headers, 'Destination'), root)
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
          const overwrite = headerValue(request.headers, 'Overwrite') !== 'F'
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

// ---------------------------------------------------------------------------
// 请求行日志（dav_clipboard_paste 一期探针）
// ---------------------------------------------------------------------------

export type WebdavRequestLineInput = {
  at: Date
  method: string
  url: string
  status: number
  bytes: number
  durationMs: number
  /** 附加说明（如 503 no-shared-root），追加在行尾。 */
  note?: string
}

/**
 * 一条 WebDAV 请求的可复制单行（浏览器控制台）。宿主每拦截到一条就打一行，
 * 与客机 C:\Tools\clip-dav-probe.log / clip-dav-hdrop.log 按时刻对齐——
 * 探针要回答「资源管理器对哪种路径发起了真目录查询/读取」就看这三方对时。
 * 纯函数：host 模块只管调用，字面量断言在 node 里跑。
 */
export function formatWebdavRequestLine(input: WebdavRequestLineInput): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  const at = `${pad(input.at.getHours())}:${pad(input.at.getMinutes())}:${pad(input.at.getSeconds())}.${pad(input.at.getMilliseconds(), 3)}`
  let path = input.url
  try {
    const parsed = new URL(input.url)
    path = parsed.pathname + parsed.search
    try {
      path = decodeURI(path)
    } catch {
      /* 畸形百分号序列：保留编码原样 */
    }
  } catch {
    /* 相对路径等非全 URL：原样输出 */
  }
  if (path.length > 120) {
    path = path.slice(0, 117) + '...'
  }
  const note = input.note ? ` ${input.note}` : ''
  return `[vm-webdav] ${at} ${input.method.toUpperCase()} ${path} ${input.status} ${input.bytes}B ${input.durationMs}ms${note}`
}
