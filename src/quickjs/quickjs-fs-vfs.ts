import {
  filesCreateBinary,
  filesCreateText,
  filesList,
  filesLstat,
  filesMkdir,
  filesReadBlob,
  filesReadText,
  filesReadlink,
  filesRemove,
  filesRename,
  filesStat,
  filesSymlink,
  filesWriteBinary,
  filesWriteText,
  filesMove,
  type FilesApiEntry,
} from '../apps/files/files-api.ts'
import { createPosixPathApi } from './quickjs-path.ts'
import { QuickJsFsError, toQuickJsFsError } from './quickjs-fs-errors.ts'
import {
  assertFsPermission,
  assertMaxFileBytes,
  resolveGuestFsPath,
} from './quickjs-fs-path.ts'
import type { QuickJsHostPermissions } from './quickjs-instance-types.ts'
import { beginFsHostTrace } from '../os/system-debug-log.ts'
import type { TerminalFsJournal } from '../terminal/terminal-changeset-journal.ts'
import { isUnderTmpPath } from '../apps/files/files-tmp.ts'

const REALPATH_MAX_SYMLINKS = 40

export type QuickJsFsDirent = {
  name: string
  isFile: boolean
  isDirectory: boolean
  isSymbolicLink: boolean
}

const pathUtil = createPosixPathApi(() => '/')
const pathDirname = (p: string) => pathUtil.dirname(p)
const pathBasename = (p: string) => pathUtil.basename(p)

/** 按墙钟让出宏任务：次数阈值在「单次极快」时反而制造过多调度开销 */
const FS_HOST_YIELD_INTERVAL_MS = 16
let lastFsHostYieldAt = 0

async function maybeYieldFsHostToBrowser(): Promise<void> {
  const now = performance.now()
  if (now - lastFsHostYieldAt < FS_HOST_YIELD_INTERVAL_MS) {
    return
  }
  lastFsHostYieldAt = now
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

export type QuickJsFsStats = {
  size: number
  mtimeMs: number
  mtime: Date
  ctimeMs: number
  ctime: Date
  birthtimeMs: number
  birthtime: Date
  atimeMs: number
  atime: Date
  isFile: boolean
  isDirectory: boolean
  isSymbolicLink: boolean
  isBlockDevice: boolean
  isCharacterDevice: boolean
  isFIFO: boolean
  isSocket: boolean
  mode: number
  uid: number
  gid: number
  ino: number
  dev: number
  nlink: number
  blocks: number
  blksize: number
}

export type QuickJsFsHostOps = {
  getCwd: () => string
  permissions: QuickJsHostPermissions
  maxFileBytes: number
  isDestroyed: () => boolean
  /** 受控模式 journal；普通/只读为 undefined */
  getJournal?: () => TerminalFsJournal | undefined
}

function entryToStats(entry: FilesApiEntry): QuickJsFsStats {
  const isSymbolicLink = entry.kind === 'symlink'
  const isFile = entry.kind === 'file'
  const isDirectory = entry.kind === 'folder'
  const mtimeMs = entry.updatedAt
  const birthtimeMs = entry.createdAt
  return {
    size: entry.byteSize,
    mtimeMs,
    mtime: new Date(mtimeMs),
    ctimeMs: mtimeMs,
    ctime: new Date(mtimeMs),
    birthtimeMs,
    birthtime: new Date(birthtimeMs),
    atimeMs: mtimeMs,
    atime: new Date(mtimeMs),
    isFile,
    isDirectory,
    isSymbolicLink,
    isBlockDevice: false,
    isCharacterDevice: false,
    isFIFO: false,
    isSocket: false,
    mode: isSymbolicLink ? 0o120777 : isDirectory ? 0o40755 : 0o100644,
    uid: 0,
    gid: 0,
    ino: 0,
    dev: 0,
    nlink: 1,
    blocks: Math.ceil(entry.byteSize / 512) || 0,
    blksize: 4096,
  }
}

function assertAlive(ops: QuickJsFsHostOps): void {
  if (ops.isDestroyed()) {
    throw new QuickJsFsError('EPERM', 'QuickJS instance destroyed during fs operation')
  }
}

function getJournal(ops: QuickJsFsHostOps): TerminalFsJournal | undefined {
  return ops.getJournal?.()
}

/** ChangeSet 不记录 `/tmp` 卷写入（长期缓存，撤销不回滚） */
async function noteJournal(
  ops: QuickJsFsHostOps,
  absolute: string,
  note: (journal: TerminalFsJournal) => Promise<void>,
): Promise<void> {
  if (isUnderTmpPath(absolute)) return
  const journal = getJournal(ops)
  if (!journal) return
  await note(journal)
}

async function resolvePath(
  ops: QuickJsFsHostOps,
  rawPath: unknown,
  mode: 'read' | 'write',
  syscall: string,
): Promise<string> {
  const absolute = resolveGuestFsPath(rawPath, ops.getCwd)
  assertFsPermission(absolute, mode, ops.permissions, syscall)
  return absolute
}

async function withFsHostTrace<T>(
  syscall: string,
  work: (trackPath: (path: string) => void) => Promise<T>,
): Promise<T> {
  await maybeYieldFsHostToBrowser()
  const trace = beginFsHostTrace(syscall)
  let trackedPath: string | undefined
  const trackPath = (path: string) => {
    trackedPath = path
  }
  try {
    return await work(trackPath)
  } finally {
    trace.end(trackedPath)
  }
}

export async function fsHostStat(ops: QuickJsFsHostOps, rawPath: unknown): Promise<QuickJsFsStats> {
  return withFsHostTrace('stat', async (trackPath) => {
    const absolute = await resolvePath(ops, rawPath, 'read', 'stat')
    trackPath(absolute)
    assertAlive(ops)
    try {
      const entry = await filesStat(absolute)
      assertAlive(ops)
      if (entry === undefined) {
        throw new QuickJsFsError('ENOENT', `ENOENT: no such file or directory, stat '${absolute}'`, {
          path: absolute,
          syscall: 'stat',
        })
      }
      return entryToStats(entry)
    } catch (error) {
      throw toQuickJsFsError(error, 'stat')
    }
  })
}

export async function fsHostLstat(ops: QuickJsFsHostOps, rawPath: unknown): Promise<QuickJsFsStats> {
  return withFsHostTrace('lstat', async (trackPath) => {
    const absolute = await resolvePath(ops, rawPath, 'read', 'lstat')
    trackPath(absolute)
    assertAlive(ops)
    try {
      const entry = await filesLstat(absolute)
      assertAlive(ops)
      if (entry === undefined) {
        throw new QuickJsFsError('ENOENT', `ENOENT: no such file or directory, lstat '${absolute}'`, {
          path: absolute,
          syscall: 'lstat',
        })
      }
      return entryToStats(entry)
    } catch (error) {
      throw toQuickJsFsError(error, 'lstat')
    }
  })
}

export async function fsHostSymlink(
  ops: QuickJsFsHostOps,
  target: unknown,
  linkPath: unknown,
): Promise<void> {
  return withFsHostTrace('symlink', async (trackPath) => {
    const absolute = await resolvePath(ops, linkPath, 'write', 'symlink')
    trackPath(absolute)
    assertAlive(ops)
    const targetStr = typeof target === 'string' ? target : String(target ?? '')
    try {
      await filesSymlink(targetStr, absolute)
      assertAlive(ops)
    } catch (error) {
      throw toQuickJsFsError(error, 'symlink')
    }
  })
}

export async function fsHostReadlink(ops: QuickJsFsHostOps, rawPath: unknown): Promise<string> {
  return withFsHostTrace('readlink', async (trackPath) => {
    const absolute = await resolvePath(ops, rawPath, 'read', 'readlink')
    trackPath(absolute)
    assertAlive(ops)
    try {
      const target = await filesReadlink(absolute)
      assertAlive(ops)
      return target
    } catch (error) {
      throw toQuickJsFsError(error, 'readlink')
    }
  })
}

export async function fsHostAccess(ops: QuickJsFsHostOps, rawPath: unknown): Promise<void> {
  return withFsHostTrace('access', async (trackPath) => {
    const absolute = await resolvePath(ops, rawPath, 'read', 'access')
    trackPath(absolute)
    assertAlive(ops)
    const entry = await filesStat(absolute)
    assertAlive(ops)
    if (entry === undefined) {
      throw new QuickJsFsError('ENOENT', `ENOENT: no such file or directory, access '${absolute}'`, {
        path: absolute,
        syscall: 'access',
      })
    }
  })
}

export async function fsHostExists(ops: QuickJsFsHostOps, rawPath: unknown): Promise<boolean> {
  try {
    await fsHostAccess(ops, rawPath)
    return true
  } catch (error) {
    if (error instanceof QuickJsFsError && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

export async function fsHostReadFile(
  ops: QuickJsFsHostOps,
  rawPath: unknown,
  encoding: 'utf8' | 'buffer' = 'buffer',
): Promise<string | Uint8Array> {
  return withFsHostTrace('readFile', async (trackPath) => {
    const absolute = await resolvePath(ops, rawPath, 'read', 'readFile')
    trackPath(absolute)
    assertAlive(ops)
    try {
      const entry = await filesStat(absolute)
      assertAlive(ops)
      if (entry === undefined) {
        throw new QuickJsFsError('ENOENT', `ENOENT: no such file or directory, open '${absolute}'`, {
          path: absolute,
          syscall: 'open',
        })
      }
      if (entry.kind === 'folder') {
        throw new QuickJsFsError('EISDIR', `EISDIR: illegal operation on a directory, read '${absolute}'`, {
          path: absolute,
          syscall: 'read',
        })
      }
      assertMaxFileBytes(entry.byteSize, ops.maxFileBytes, absolute, 'readFile')

      if (encoding === 'utf8') {
        const text = await filesReadText(absolute)
        assertAlive(ops)
        const bytes = new TextEncoder().encode(text)
        assertMaxFileBytes(bytes.byteLength, ops.maxFileBytes, absolute, 'readFile')
        return text
      }

      const blob = await filesReadBlob(absolute)
      assertAlive(ops)
      const buffer = await blob.arrayBuffer()
      assertMaxFileBytes(buffer.byteLength, ops.maxFileBytes, absolute, 'readFile')
      return new Uint8Array(buffer)
    } catch (error) {
      throw toQuickJsFsError(error, 'readFile')
    }
  })
}

/**
 * 为流式读准备：整文件读入（仍受 maxFileBytes），由调用方按 offset 切片推送。
 */
export async function fsHostReadFileForStream(
  ops: QuickJsFsHostOps,
  rawPath: unknown,
): Promise<{ absolute: string; bytes: Uint8Array }> {
  const bytes = (await fsHostReadFile(ops, rawPath, 'buffer')) as Uint8Array
  const absolute = resolveGuestFsPath(rawPath, ops.getCwd)
  return { absolute, bytes }
}

export async function fsHostWriteFile(
  ops: QuickJsFsHostOps,
  rawPath: unknown,
  data: string | Uint8Array,
): Promise<void> {
  return withFsHostTrace('writeFile', async (trackPath) => {
    const absolute = await resolvePath(ops, rawPath, 'write', 'writeFile')
    trackPath(absolute)
    assertAlive(ops)

    const byteLength =
      typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength
    assertMaxFileBytes(byteLength, ops.maxFileBytes, absolute, 'writeFile')

    try {
      const existing = await filesStat(absolute)
      assertAlive(ops)
      if (existing?.kind === 'folder') {
        throw new QuickJsFsError('EISDIR', `EISDIR: illegal operation on a directory, open '${absolute}'`, {
          path: absolute,
          syscall: 'open',
        })
      }

      await noteJournal(ops, absolute, (j) => j.noteWrite(absolute))
      assertAlive(ops)

      if (typeof data === 'string') {
        if (existing === undefined) {
          await filesCreateText(absolute, data)
        } else {
          await filesWriteText(absolute, data)
        }
      } else {
        const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
        if (existing === undefined) {
          await filesCreateBinary(absolute, ab)
        } else {
          await filesWriteBinary(absolute, ab)
        }
      }
      assertAlive(ops)
    } catch (error) {
      throw toQuickJsFsError(error, 'writeFile')
    }
  })
}

export async function fsHostAppendFile(
  ops: QuickJsFsHostOps,
  rawPath: unknown,
  data: string | Uint8Array,
): Promise<void> {
  return withFsHostTrace('appendFile', async (trackPath) => {
    const absolute = await resolvePath(ops, rawPath, 'write', 'appendFile')
    trackPath(absolute)
    assertAlive(ops)

    try {
      const existing = await filesStat(absolute)
      assertAlive(ops)
      if (existing?.kind === 'folder') {
        throw new QuickJsFsError('EISDIR', `EISDIR: illegal operation on a directory, open '${absolute}'`, {
          path: absolute,
          syscall: 'open',
        })
      }

      await noteJournal(ops, absolute, (j) => j.noteWrite(absolute))
      assertAlive(ops)

      let next: string | Uint8Array
      if (existing === undefined) {
        next = data
      } else if (typeof data === 'string') {
        const prev = await filesReadText(absolute)
        assertAlive(ops)
        next = prev + data
      } else {
        const blob = await filesReadBlob(absolute)
        assertAlive(ops)
        const prev = new Uint8Array(await blob.arrayBuffer())
        const merged = new Uint8Array(prev.byteLength + data.byteLength)
        merged.set(prev, 0)
        merged.set(data, prev.byteLength)
        next = merged
      }

      const byteLength =
        typeof next === 'string' ? new TextEncoder().encode(next).byteLength : next.byteLength
      assertMaxFileBytes(byteLength, ops.maxFileBytes, absolute, 'appendFile')

      if (existing === undefined) {
        if (typeof next === 'string') {
          await filesCreateText(absolute, next)
        } else {
          const ab = next.buffer.slice(next.byteOffset, next.byteOffset + next.byteLength) as ArrayBuffer
          await filesCreateBinary(absolute, ab)
        }
      } else if (typeof next === 'string') {
        await filesWriteText(absolute, next)
      } else {
        const ab = next.buffer.slice(next.byteOffset, next.byteOffset + next.byteLength) as ArrayBuffer
        await filesWriteBinary(absolute, ab)
      }
      assertAlive(ops)
    } catch (error) {
      throw toQuickJsFsError(error, 'appendFile')
    }
  })
}

export async function fsHostMkdir(
  ops: QuickJsFsHostOps,
  rawPath: unknown,
  options?: { recursive?: boolean },
): Promise<string | undefined> {
  return withFsHostTrace('mkdir', async (trackPath) => {
    const absolute = await resolvePath(ops, rawPath, 'write', 'mkdir')
    trackPath(absolute)
    assertAlive(ops)
    const recursive = options?.recursive === true

    try {
      const existing = await filesStat(absolute)
      assertAlive(ops)
      if (existing !== undefined) {
        if (recursive && existing.kind === 'folder') {
          return undefined
        }
        throw new QuickJsFsError('EEXIST', `EEXIST: file already exists, mkdir '${absolute}'`, {
          path: absolute,
          syscall: 'mkdir',
        })
      }

      if (!recursive) {
        await noteJournal(ops, absolute, (j) => j.noteMkdir(absolute))
        assertAlive(ops)
        await filesMkdir(absolute)
        assertAlive(ops)
        return absolute
      }

      const parts = absolute.split('/').filter(Boolean)
      let current = ''
      let firstCreated: string | undefined
      for (const part of parts) {
        current = `${current}/${part}`
        const entry = await filesStat(current)
        assertAlive(ops)
        if (entry === undefined) {
          await noteJournal(ops, current, (j) => j.noteMkdir(current))
          assertAlive(ops)
          await filesMkdir(current)
          assertAlive(ops)
          if (firstCreated === undefined) {
            firstCreated = current
          }
        } else if (entry.kind !== 'folder') {
          throw new QuickJsFsError('ENOTDIR', `ENOTDIR: not a directory, mkdir '${current}'`, {
            path: current,
            syscall: 'mkdir',
          })
        }
      }
      return firstCreated
    } catch (error) {
      throw toQuickJsFsError(error, 'mkdir')
    }
  })
}

function resolveAbsolutePath(getCwd: () => string, absolute: string): string {
  const pathApi = createPosixPathApi(getCwd)
  const resolved = pathApi.resolve(absolute)
  return resolved.startsWith('/') ? resolved : `/${resolved}`
}

export async function fsHostRealpath(ops: QuickJsFsHostOps, rawPath: unknown): Promise<string> {
  return withFsHostTrace('realpath', async (trackPath) => {
    const pathApi = createPosixPathApi(ops.getCwd)
    let current = resolveAbsolutePath(ops.getCwd, await resolvePath(ops, rawPath, 'read', 'realpath'))
    trackPath(current)

    for (let depth = 0; depth < REALPATH_MAX_SYMLINKS; depth++) {
      assertAlive(ops)
      try {
        const entry = await filesLstat(current)
        assertAlive(ops)
        if (entry === undefined) {
          throw new QuickJsFsError(
            'ENOENT',
            `ENOENT: no such file or directory, realpath '${current}'`,
            { path: current, syscall: 'realpath' },
          )
        }
        if (entry.kind !== 'symlink') {
          return current
        }
        const target = await filesReadlink(current)
        assertAlive(ops)
        current = target.startsWith('/')
          ? resolveAbsolutePath(ops.getCwd, target)
          : pathApi.resolve(pathDirname(current), target)
        trackPath(current)
      } catch (error) {
        throw toQuickJsFsError(error, 'realpath')
      }
    }

    throw new QuickJsFsError('ELOOP', `ELOOP: too many symbolic links encountered, realpath '${current}'`, {
      path: current,
      syscall: 'realpath',
    })
  })
}

export async function fsHostReaddir(
  ops: QuickJsFsHostOps,
  rawPath: unknown,
  options?: { withFileTypes?: boolean },
): Promise<string[] | QuickJsFsDirent[]> {
  return withFsHostTrace('readdir', async (trackPath) => {
    const absolute = await resolvePath(ops, rawPath, 'read', 'readdir')
    trackPath(absolute)
    assertAlive(ops)
    const withFileTypes = options?.withFileTypes === true
    try {
      const entry = await filesStat(absolute)
      assertAlive(ops)
      if (entry === undefined) {
        throw new QuickJsFsError('ENOENT', `ENOENT: no such file or directory, scandir '${absolute}'`, {
          path: absolute,
          syscall: 'scandir',
        })
      }
      if (entry.kind !== 'folder') {
        throw new QuickJsFsError('ENOTDIR', `ENOTDIR: not a directory, scandir '${absolute}'`, {
          path: absolute,
          syscall: 'scandir',
        })
      }
      const children = await filesList(absolute)
      assertAlive(ops)
      if (!withFileTypes) {
        return children.map((child) => child.name)
      }
      return children.map((child) => ({
        name: child.name,
        isFile: child.kind === 'file',
        isDirectory: child.kind === 'folder',
        isSymbolicLink: child.kind === 'symlink',
      }))
    } catch (error) {
      throw toQuickJsFsError(error, 'readdir')
    }
  })
}

export async function fsHostCopyFile(
  ops: QuickJsFsHostOps,
  rawSrc: unknown,
  rawDest: unknown,
  mode?: number,
): Promise<void> {
  return withFsHostTrace('copyFile', async (trackPath) => {
    const src = await resolvePath(ops, rawSrc, 'read', 'copyFile')
    let dest = await resolvePath(ops, rawDest, 'write', 'copyFile')
    trackPath(src)
    assertAlive(ops)
    const COPYFILE_EXCL = 1

    try {
      const srcEntry = await filesStat(src)
      assertAlive(ops)
      if (srcEntry === undefined) {
        throw new QuickJsFsError('ENOENT', `ENOENT: no such file or directory, copyfile '${src}'`, {
          path: src,
          syscall: 'copyfile',
        })
      }
      if (srcEntry.kind === 'folder') {
        throw new QuickJsFsError('EISDIR', `EISDIR: illegal operation on a directory, copyfile '${src}'`, {
          path: src,
          syscall: 'copyfile',
        })
      }

      const destEntry = await filesStat(dest)
      assertAlive(ops)
      if (destEntry?.kind === 'folder') {
        dest = `${dest === '/' ? '' : dest}/${pathBasename(src)}`
        assertFsPermission(dest, 'write', ops.permissions, 'copyFile')
      }

      const destFinal = await filesStat(dest)
      assertAlive(ops)
      if (destFinal !== undefined && mode !== undefined && (mode & COPYFILE_EXCL) !== 0) {
        throw new QuickJsFsError('EEXIST', `EEXIST: file already exists, copyfile '${dest}'`, {
          path: dest,
          syscall: 'copyfile',
        })
      }

      const data = await fsHostReadFile(ops, src, 'buffer')
      assertAlive(ops)
      await fsHostWriteFile(ops, dest, data as Uint8Array)
      assertAlive(ops)
    } catch (error) {
      throw toQuickJsFsError(error, 'copyFile')
    }
  })
}

function randomMkdtempSuffix(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]!
  }
  return out
}

export async function fsHostMkdtemp(ops: QuickJsFsHostOps, rawPrefix: unknown): Promise<string> {
  return withFsHostTrace('mkdtemp', async (trackPath) => {
    const prefix = typeof rawPrefix === 'string' ? rawPrefix : String(rawPrefix ?? '')
    if (!prefix.endsWith('XXXXXX')) {
      throw new QuickJsFsError(
        'EINVAL',
        'mkdtemp() template must end with XXXXXX',
        { syscall: 'mkdtemp' },
      )
    }
    const pathApi = createPosixPathApi(ops.getCwd)

    for (let attempt = 0; attempt < 16; attempt++) {
      const candidatePath = pathApi.resolve(`${prefix.slice(0, -6)}${randomMkdtempSuffix(6)}`)
      const absolute = resolveAbsolutePath(ops.getCwd, candidatePath)
      trackPath(absolute)
      assertAlive(ops)
      const existing = await filesStat(absolute)
      assertAlive(ops)
      if (existing !== undefined) {
        continue
      }
      await fsHostMkdir(ops, absolute, { recursive: false })
      return absolute
    }

    throw new QuickJsFsError('EEXIST', 'EEXIST: mkdtemp could not create a unique directory', {
      syscall: 'mkdtemp',
    })
  })
}

export async function fsHostTruncate(
  ops: QuickJsFsHostOps,
  rawPath: unknown,
  length = 0,
): Promise<void> {
  return withFsHostTrace('truncate', async (trackPath) => {
    const absolute = await resolvePath(ops, rawPath, 'write', 'truncate')
    trackPath(absolute)
    assertAlive(ops)
    const len = Number.isFinite(length) ? Math.max(0, Math.floor(length)) : 0

    try {
      const entry = await filesStat(absolute)
      assertAlive(ops)
      if (entry === undefined) {
        if (len === 0) {
          await fsHostWriteFile(ops, absolute, new Uint8Array(0))
          return
        }
        throw new QuickJsFsError('ENOENT', `ENOENT: no such file or directory, truncate '${absolute}'`, {
          path: absolute,
          syscall: 'truncate',
        })
      }
      if (entry.kind === 'folder') {
        throw new QuickJsFsError('EISDIR', `EISDIR: illegal operation on a directory, truncate '${absolute}'`, {
          path: absolute,
          syscall: 'truncate',
        })
      }

      const existing = (await fsHostReadFile(ops, absolute, 'buffer')) as Uint8Array
      assertAlive(ops)
      let next: Uint8Array
      if (len <= existing.byteLength) {
        next = existing.subarray(0, len)
      } else {
        next = new Uint8Array(len)
        next.set(existing)
      }
      await fsHostWriteFile(ops, absolute, next)
      assertAlive(ops)
    } catch (error) {
      throw toQuickJsFsError(error, 'truncate')
    }
  })
}

/** 卷模型无 Unix mode；仅校验路径可读/存在。 */
export async function fsHostChmod(ops: QuickJsFsHostOps, rawPath: unknown): Promise<void> {
  await fsHostAccess(ops, rawPath)
}

export async function fsHostChown(ops: QuickJsFsHostOps, rawPath: unknown): Promise<void> {
  await fsHostAccess(ops, rawPath)
}

export async function fsHostRename(
  ops: QuickJsFsHostOps,
  rawOldPath: unknown,
  rawNewPath: unknown,
): Promise<void> {
  return withFsHostTrace('rename', async (trackPath) => {
    const oldPath = await resolvePath(ops, rawOldPath, 'write', 'rename')
    const newPath = await resolvePath(ops, rawNewPath, 'write', 'rename')
    trackPath(oldPath)
    assertAlive(ops)

    try {
      const source = await filesStat(oldPath)
      assertAlive(ops)
      if (source === undefined) {
        throw new QuickJsFsError('ENOENT', `ENOENT: no such file or directory, rename '${oldPath}' -> '${newPath}'`, {
          path: oldPath,
          syscall: 'rename',
        })
      }
      const dest = await filesStat(newPath)
      assertAlive(ops)
      if (dest !== undefined) {
        throw new QuickJsFsError('EEXIST', `EEXIST: file already exists, rename '${oldPath}' -> '${newPath}'`, {
          path: newPath,
          syscall: 'rename',
        })
      }

      if (!isUnderTmpPath(oldPath) && !isUnderTmpPath(newPath)) {
        await noteJournal(ops, oldPath, (j) => j.noteRename(oldPath, newPath))
      }
      assertAlive(ops)

      const oldDir = pathDirname(oldPath)
      const newDir = pathDirname(newPath)
      const newName = pathBasename(newPath)

      if (oldDir === newDir) {
        await filesRename(oldPath, newName)
      } else {
        await filesMove(oldPath, newDir)
        const movedPath = `${newDir === '/' ? '' : newDir}/${pathBasename(oldPath)}`
        if (movedPath !== newPath) {
          await filesRename(movedPath, newName)
        }
      }
      assertAlive(ops)
    } catch (error) {
      throw toQuickJsFsError(error, 'rename')
    }
  })
}

export async function fsHostUnlink(ops: QuickJsFsHostOps, rawPath: unknown): Promise<void> {
  return withFsHostTrace('unlink', async (trackPath) => {
    const absolute = await resolvePath(ops, rawPath, 'write', 'unlink')
    trackPath(absolute)
    assertAlive(ops)
    try {
      const entry = await filesStat(absolute)
      assertAlive(ops)
      if (entry === undefined) {
        throw new QuickJsFsError('ENOENT', `ENOENT: no such file or directory, unlink '${absolute}'`, {
          path: absolute,
          syscall: 'unlink',
        })
      }
      if (entry.kind === 'folder') {
        throw new QuickJsFsError('EISDIR', `EISDIR: illegal operation on a directory, unlink '${absolute}'`, {
          path: absolute,
          syscall: 'unlink',
        })
      }
      await noteJournal(ops, absolute, (j) => j.noteUnlink(absolute))
      assertAlive(ops)
      await filesRemove(absolute)
      assertAlive(ops)
    } catch (error) {
      throw toQuickJsFsError(error, 'unlink')
    }
  })
}

export async function fsHostRm(
  ops: QuickJsFsHostOps,
  rawPath: unknown,
  options?: { recursive?: boolean; force?: boolean },
): Promise<void> {
  return withFsHostTrace('rm', async (trackPath) => {
    const absolute = await resolvePath(ops, rawPath, 'write', 'rm')
    trackPath(absolute)
    assertAlive(ops)
    const recursive = options?.recursive === true
    const force = options?.force === true

    try {
      const entry = await filesStat(absolute)
      assertAlive(ops)
      if (entry === undefined) {
        if (force) {
          return
        }
        throw new QuickJsFsError('ENOENT', `ENOENT: no such file or directory, rm '${absolute}'`, {
          path: absolute,
          syscall: 'rm',
        })
      }
      if (entry.kind === 'folder' && !recursive) {
        const children = await filesList(absolute)
        assertAlive(ops)
        if (children.length > 0) {
          throw new QuickJsFsError('ENOTEMPTY', `ENOTEMPTY: directory not empty, rm '${absolute}'`, {
            path: absolute,
            syscall: 'rm',
          })
        }
      }
      await noteJournal(ops, absolute, (j) => j.noteRmTree(absolute))
      assertAlive(ops)
      await filesRemove(absolute)
      assertAlive(ops)
    } catch (error) {
      throw toQuickJsFsError(error, 'rm')
    }
  })
}

export async function fsHostRmdir(ops: QuickJsFsHostOps, rawPath: unknown): Promise<void> {
  return withFsHostTrace('rmdir', async (trackPath) => {
    const absolute = await resolvePath(ops, rawPath, 'write', 'rmdir')
    trackPath(absolute)
    assertAlive(ops)
    try {
      const entry = await filesStat(absolute)
      assertAlive(ops)
      if (entry === undefined) {
        throw new QuickJsFsError('ENOENT', `ENOENT: no such file or directory, rmdir '${absolute}'`, {
          path: absolute,
          syscall: 'rmdir',
        })
      }
      if (entry.kind !== 'folder') {
        throw new QuickJsFsError('ENOTDIR', `ENOTDIR: not a directory, rmdir '${absolute}'`, {
          path: absolute,
          syscall: 'rmdir',
        })
      }
      const children = await filesList(absolute)
      assertAlive(ops)
      if (children.length > 0) {
        throw new QuickJsFsError('ENOTEMPTY', `ENOTEMPTY: directory not empty, rmdir '${absolute}'`, {
          path: absolute,
          syscall: 'rmdir',
        })
      }
      await noteJournal(ops, absolute, (j) => j.noteRmTree(absolute))
      assertAlive(ops)
      await filesRemove(absolute)
      assertAlive(ops)
    } catch (error) {
      throw toQuickJsFsError(error, 'rmdir')
    }
  })
}
