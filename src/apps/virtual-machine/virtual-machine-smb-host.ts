import {
  filesCreateBinary,
  filesList,
  filesMkdir,
  filesMove,
  filesReadBlobRange,
  filesRemove,
  filesRename,
  filesStat,
  filesWriteBinary,
  filesWriteBytesRange,
} from '../files/files-api.ts'
import {
  INSTANT_VM_MESSAGE_TYPE,
  isInstantVmSmbFsRequestMessage,
  type InstantVmSmbFsEntry,
  type InstantVmSmbFsErrorKind,
  type InstantVmSmbFsRequestMessage,
  type InstantVmSmbFsResultMessage,
} from './virtual-machine-protocol.ts'
import { isRuntimeOrigin, postSource } from './virtual-machine-disk-stream-host.ts'

/**
 * 宿主侧 SMB 消息监听器（共享文件夹 445 通路的后端）。
 *
 * 与 webdav-host 同款模式：独立 message 监听 + 运行时 origin 校验 +
 * postSource 直接回执。op 分派与路径安全是纯函数部分
 * （createSmbFsHandler，node 可测），监听器只是薄壳。
 *
 * 共享根由设置流程注入（setSmbSharedRoot，与 setWebdavSharedRoot 同一调用点
 * 喂同一个根）；未配置时一律回 denied。
 *
 * 每条请求在浏览器控制台打一行「时间 op 路径 结果 耗时」（[vm-smb] 前缀）。
 */

// ---------------------------------------------------------------------------
// 纯函数部分：op → VFS 分派（node 可测）
// ---------------------------------------------------------------------------

export type SmbHostFsEntry = {
  path: string
  name: string
  kind: string
  byteSize: number
  createdAt: number
  updatedAt: number
}

export type SmbHostFs = {
  stat: (path: string) => Promise<SmbHostFsEntry | undefined>
  list: (dirPath: string) => Promise<SmbHostFsEntry[]>
  readBlobRange: (path: string, offset: number, length: number) => Promise<Blob>
  writeBytesRange: (path: string, offset: number, bytes: ArrayBuffer | Uint8Array) => Promise<unknown>
  writeBinary: (path: string, bytes: ArrayBuffer) => Promise<unknown>
  createBinary: (path: string, bytes: ArrayBuffer) => Promise<unknown>
  mkdir: (path: string) => Promise<unknown>
  remove: (path: string) => Promise<void>
  rename: (path: string, nextName: string) => Promise<unknown>
  move: (sourcePath: string, destDirPath: string) => Promise<unknown>
}

export type SmbHostResult = {
  ok: boolean
  error?: InstantVmSmbFsErrorKind
  entry?: InstantVmSmbFsEntry | null
  entries?: InstantVmSmbFsEntry[]
  data?: ArrayBuffer
}

function fail(error: InstantVmSmbFsErrorKind): SmbHostResult {
  return { ok: false, error }
}

/**
 * 相对路径 → 共享根下的绝对 VFS 路径。段级校验：拒 `..`、`.`、反斜杠、
 * 冒号与空段混入（SMB 服务端已按 / 分隔规整，这里是纵深防御）。
 */
export function smbTargetPath(root: string, rel: string): { ok: true; path: string } | { ok: false } {
  const segments: string[] = []
  for (const raw of rel.split('/')) {
    if (raw.length === 0) {
      continue
    }
    if (raw === '..' || raw === '.' || raw.includes('\\') || raw.includes(':')) {
      return { ok: false }
    }
    segments.push(raw)
  }
  const suffix = segments.length > 0 ? `/${segments.join('/')}` : ''
  return { ok: true, path: `${root.replace(/\/+$/, '')}${suffix}` }
}

function toSmbEntry(entry: SmbHostFsEntry): InstantVmSmbFsEntry {
  return {
    name: entry.name,
    isDir: entry.kind === 'folder',
    size: Math.max(0, entry.byteSize),
    mtimeMs: entry.updatedAt,
    ctimeMs: entry.createdAt,
  }
}

/** 写零填充的步长（setEof 扩展 / write 空洞填充）。 */
const SMB_ZERO_FILL_CHUNK = 1024 * 1024

async function zeroFill(fs: SmbHostFs, path: string, from: number, to: number): Promise<void> {
  let cursor = from
  while (cursor < to) {
    const length = Math.min(SMB_ZERO_FILL_CHUNK, to - cursor)
    await fs.writeBytesRange(path, cursor, new Uint8Array(length))
    cursor += length
  }
}

export function createSmbFsHandler(
  getRoot: () => string | undefined,
  fs: SmbHostFs,
): (request: InstantVmSmbFsRequestMessage) => Promise<SmbHostResult> {
  return async (request) => {
    const root = getRoot()
    if (!root) {
      return fail('denied')
    }
    const target = smbTargetPath(root, request.path)
    if (!target.ok) {
      return fail('invalid')
    }
    const path = target.path
    try {
      switch (request.op) {
        case 'stat': {
          const entry = await fs.stat(path)
          return { ok: true, entry: entry ? toSmbEntry(entry) : null }
        }
        case 'list': {
          const entries = await fs.list(path)
          // 挂载卷的列举是懒条目（byteSize/updatedAt 为 0）：SMB 的目录枚举
          // 直接展示大小，补一次 stat 拿真值（与 webdav-host 的 listDetailed 同理）。
          const missing = entries.filter(
            (entry) => entry.kind === 'file' && (entry.byteSize === 0 || entry.updatedAt === 0),
          )
          if (missing.length === 0) {
            return { ok: true, entries: entries.map(toSmbEntry) }
          }
          const enriched = await Promise.all(
            missing.map(async (entry) => (await fs.stat(entry.path)) ?? entry),
          )
          const byPath = new Map(enriched.map((entry) => [entry.path, entry]))
          return {
            ok: true,
            entries: entries.map((entry) => toSmbEntry(byPath.get(entry.path) ?? entry)),
          }
        }
        case 'read': {
          const entry = await fs.stat(path)
          if (!entry) {
            return fail('not-found')
          }
          if (entry.kind === 'folder') {
            return fail('not-dir')
          }
          const offset = request.offset ?? 0
          const length = Math.max(0, Math.min(request.length ?? 0, Math.max(0, entry.byteSize - offset)))
          if (length === 0) {
            return { ok: true, data: new ArrayBuffer(0) }
          }
          const blob = await fs.readBlobRange(path, offset, length)
          return { ok: true, data: (await blob.arrayBuffer()) as ArrayBuffer }
        }
        case 'write': {
          const bytes = request.data
          const offset = request.offset
          if (!bytes || offset === undefined) {
            return fail('invalid')
          }
          const entry = await fs.stat(path)
          if (!entry) {
            return fail('not-found')
          }
          if (entry.kind === 'folder') {
            return fail('not-dir')
          }
          // VFS 不支持空洞扩展（offset ≤ EOF）：先补零再写。
          if (offset > entry.byteSize) {
            await zeroFill(fs, path, entry.byteSize, offset)
          }
          if (bytes.byteLength > 0) {
            await fs.writeBytesRange(path, offset, bytes)
          }
          return { ok: true }
        }
        case 'create': {
          if (await fs.stat(path)) {
            return fail('exists')
          }
          const parent = path.slice(0, path.lastIndexOf('/'))
          if (parent && (await fs.stat(parent))?.kind !== 'folder') {
            return fail('not-found')
          }
          await fs.createBinary(path, new ArrayBuffer(0))
          return { ok: true }
        }
        case 'truncate': {
          const entry = await fs.stat(path)
          if (!entry) {
            return fail('not-found')
          }
          if (entry.kind === 'folder') {
            return fail('not-dir')
          }
          await fs.writeBinary(path, new ArrayBuffer(0))
          return { ok: true }
        }
        case 'mkdir': {
          if (await fs.stat(path)) {
            return fail('exists')
          }
          const parent = path.slice(0, path.lastIndexOf('/'))
          if (parent && (await fs.stat(parent))?.kind !== 'folder') {
            return fail('not-found')
          }
          await fs.mkdir(path)
          return { ok: true }
        }
        case 'remove': {
          const entry = await fs.stat(path)
          if (!entry) {
            return fail('not-found')
          }
          if (entry.kind === 'folder') {
            const children = await fs.list(path)
            if (children.length > 0) {
              return fail('not-empty')
            }
          }
          await fs.remove(path)
          return { ok: true }
        }
        case 'rename': {
          const newName = request.path2
          if (!newName || newName.includes('/') || newName.includes('\\') || newName === '..' || newName === '.') {
            return fail('invalid')
          }
          if (!(await fs.stat(path))) {
            return fail('not-found')
          }
          await fs.rename(path, newName)
          return { ok: true }
        }
        case 'move': {
          const destRel = request.path2
          if (destRel === undefined) {
            return fail('invalid')
          }
          const dest = smbTargetPath(root, destRel)
          if (!dest.ok) {
            return fail('invalid')
          }
          if (!(await fs.stat(path))) {
            return fail('not-found')
          }
          if ((await fs.stat(dest.path))?.kind !== 'folder') {
            return fail('not-dir')
          }
          await fs.move(path, dest.path)
          return { ok: true }
        }
        case 'setEof': {
          const length = request.length
          if (length === undefined || !Number.isFinite(length) || length < 0) {
            return fail('invalid')
          }
          const entry = await fs.stat(path)
          if (!entry) {
            return fail('not-found')
          }
          if (entry.kind === 'folder') {
            return fail('not-dir')
          }
          if (length < entry.byteSize) {
            // 截断：VFS 无 truncate 原语，读前缀整体覆写。
            const blob = await fs.readBlobRange(path, 0, length)
            await fs.writeBinary(path, (await blob.arrayBuffer()) as ArrayBuffer)
          } else if (length > entry.byteSize) {
            // 扩展按写零处理（VFS 稀疏语义不保证，写零最稳）。
            await zeroFill(fs, path, entry.byteSize, length)
          }
          return { ok: true }
        }
        default:
          return fail('invalid')
      }
    } catch (error) {
      console.warn('[vm-smb-host] op failed', request.op, request.path, error)
      return fail('other')
    }
  }
}

// ---------------------------------------------------------------------------
// 监听器薄壳
// ---------------------------------------------------------------------------

const realFs: SmbHostFs = {
  stat: filesStat,
  list: filesList,
  readBlobRange: filesReadBlobRange,
  writeBytesRange: filesWriteBytesRange,
  writeBinary: filesWriteBinary,
  createBinary: filesCreateBinary,
  mkdir: filesMkdir,
  remove: filesRemove,
  rename: filesRename,
  move: filesMove,
}

let sharedRoot: string | undefined
let listenerInstalled = false

const handler = createSmbFsHandler(() => sharedRoot, realFs)

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

function formatSmbLogLine(
  request: InstantVmSmbFsRequestMessage,
  result: SmbHostResult,
  durationMs: number,
): string {
  const at = new Date()
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  const stamp = `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`
  const status = result.ok ? 'ok' : `err:${result.error ?? 'other'}`
  const bytes = result.data ? ` ${result.data.byteLength}B` : request.data ? ` req=${request.data.byteLength}B` : ''
  return `[vm-smb] ${stamp} ${request.op} ${request.path || '/'} ${status} ${durationMs}ms${bytes}`
}

function onSmbMessage(event: MessageEvent): void {
  if (!isInstantVmSmbFsRequestMessage(event.data)) {
    return
  }
  if (!isRuntimeOrigin(event.origin)) {
    console.warn('[vm-smb-host] 忽略来自非运行时源的 SMB 请求', event.origin)
    return
  }
  const target = isSourcePostable(event.source)
  if (!target) {
    return
  }
  const request = event.data
  const origin = event.origin
  void (async () => {
    const startedAt = Date.now()
    const outcome = await handler(request)
    const result: InstantVmSmbFsResultMessage = {
      type: INSTANT_VM_MESSAGE_TYPE.smbFsResult,
      requestId: request.requestId,
      ok: outcome.ok,
      ...(outcome.error ? { error: outcome.error } : {}),
      ...(outcome.entry !== undefined ? { entry: outcome.entry } : {}),
      ...(outcome.entries ? { entries: outcome.entries } : {}),
      ...(outcome.data ? { data: outcome.data } : {}),
    }
    console.info(formatSmbLogLine(request, outcome, Date.now() - startedAt))
    postSource(target, result, origin, outcome.data ? [outcome.data] : [])
  })()
}

/** 更新共享根路径（可随时切换；undefined = 关闭，请求一律回 denied）。 */
export function setSmbSharedRoot(root: string | undefined): void {
  sharedRoot = root
  if (!listenerInstalled) {
    listenerInstalled = true
    window.addEventListener('message', onSmbMessage)
  }
}

export function getSmbSharedRoot(): string | undefined {
  return sharedRoot
}
