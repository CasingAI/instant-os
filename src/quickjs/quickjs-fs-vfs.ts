import {
  filesCreateBinary,
  filesCreateText,
  filesList,
  filesMkdir,
  filesReadBlob,
  filesReadText,
  filesRemove,
  filesRename,
  filesStat,
  filesWriteBinary,
  filesWriteText,
  filesMove,
  type FilesApiEntry,
} from '../apps/files/files-api.ts'
import { createPosixPathApi } from './quickjs-path.ts'
import { QuickJsFsError, toQuickJsFsError } from './quickjs-fs-errors.ts'

const pathUtil = createPosixPathApi(() => '/')
const pathDirname = (p: string) => pathUtil.dirname(p)
const pathBasename = (p: string) => pathUtil.basename(p)
import {
  assertFsPermission,
  assertMaxFileBytes,
  resolveGuestFsPath,
} from './quickjs-fs-path.ts'
import type { QuickJsHostPermissions } from './quickjs-instance-types.ts'

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
}

function entryToStats(entry: FilesApiEntry): QuickJsFsStats {
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
    isSymbolicLink: false,
    isBlockDevice: false,
    isCharacterDevice: false,
    isFIFO: false,
    isSocket: false,
    mode: isDirectory ? 0o40755 : 0o100644,
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

export async function fsHostStat(ops: QuickJsFsHostOps, rawPath: unknown): Promise<QuickJsFsStats> {
  const absolute = await resolvePath(ops, rawPath, 'read', 'stat')
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
}

export async function fsHostAccess(ops: QuickJsFsHostOps, rawPath: unknown): Promise<void> {
  const absolute = await resolvePath(ops, rawPath, 'read', 'access')
  assertAlive(ops)
  const entry = await filesStat(absolute)
  assertAlive(ops)
  if (entry === undefined) {
    throw new QuickJsFsError('ENOENT', `ENOENT: no such file or directory, access '${absolute}'`, {
      path: absolute,
      syscall: 'access',
    })
  }
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
  const absolute = await resolvePath(ops, rawPath, 'read', 'readFile')
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
}

export async function fsHostWriteFile(
  ops: QuickJsFsHostOps,
  rawPath: unknown,
  data: string | Uint8Array,
): Promise<void> {
  const absolute = await resolvePath(ops, rawPath, 'write', 'writeFile')
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
}

export async function fsHostAppendFile(
  ops: QuickJsFsHostOps,
  rawPath: unknown,
  data: string | Uint8Array,
): Promise<void> {
  const absolute = await resolvePath(ops, rawPath, 'write', 'appendFile')
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
}

export async function fsHostMkdir(
  ops: QuickJsFsHostOps,
  rawPath: unknown,
  options?: { recursive?: boolean },
): Promise<string | undefined> {
  const absolute = await resolvePath(ops, rawPath, 'write', 'mkdir')
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
      await filesMkdir(absolute)
      assertAlive(ops)
      return absolute
    }

    // 逐段创建
    const parts = absolute.split('/').filter(Boolean)
    let current = ''
    let firstCreated: string | undefined
    for (const part of parts) {
      current = `${current}/${part}`
      const entry = await filesStat(current)
      assertAlive(ops)
      if (entry === undefined) {
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
}

export async function fsHostReaddir(ops: QuickJsFsHostOps, rawPath: unknown): Promise<string[]> {
  const absolute = await resolvePath(ops, rawPath, 'read', 'readdir')
  assertAlive(ops)
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
    return children.map((child) => child.name)
  } catch (error) {
    throw toQuickJsFsError(error, 'readdir')
  }
}

export async function fsHostRename(
  ops: QuickJsFsHostOps,
  rawOldPath: unknown,
  rawNewPath: unknown,
): Promise<void> {
  const oldPath = await resolvePath(ops, rawOldPath, 'write', 'rename')
  const newPath = await resolvePath(ops, rawNewPath, 'write', 'rename')
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

    const oldDir = pathDirname(oldPath)
    const newDir = pathDirname(newPath)
    const newName = pathBasename(newPath)

    if (oldDir === newDir) {
      await filesRename(oldPath, newName)
    } else {
      // 先移到目标目录（保留旧名），再改名
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
}

export async function fsHostUnlink(ops: QuickJsFsHostOps, rawPath: unknown): Promise<void> {
  const absolute = await resolvePath(ops, rawPath, 'write', 'unlink')
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
    await filesRemove(absolute)
    assertAlive(ops)
  } catch (error) {
    throw toQuickJsFsError(error, 'unlink')
  }
}

export async function fsHostRm(
  ops: QuickJsFsHostOps,
  rawPath: unknown,
  options?: { recursive?: boolean; force?: boolean },
): Promise<void> {
  const absolute = await resolvePath(ops, rawPath, 'write', 'rm')
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
    await filesRemove(absolute)
    assertAlive(ops)
  } catch (error) {
    throw toQuickJsFsError(error, 'rm')
  }
}

export async function fsHostRmdir(ops: QuickJsFsHostOps, rawPath: unknown): Promise<void> {
  const absolute = await resolvePath(ops, rawPath, 'write', 'rmdir')
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
    await filesRemove(absolute)
    assertAlive(ops)
  } catch (error) {
    throw toQuickJsFsError(error, 'rmdir')
  }
}
