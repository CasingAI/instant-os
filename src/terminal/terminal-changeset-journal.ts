/**
 * 受控模式写路径 journal：每 path 首次改动前存 before，回合结束产出 ChangeSet。
 */
import { osNowMs } from '../os/os-clock.ts'
import {
  filesCreateBinary,
  filesList,
  filesMkdir,
  filesRemove,
  filesStat,
  filesWriteBinary,
} from '../apps/files/files-api.ts'
import type { TerminalChangeEntry, TerminalChangeSet } from './terminal-changeset.ts'
import {
  deleteTerminalChangeSession,
  putBeforeBlobFromPath,
  readBeforeBlobBytes,
  saveTerminalChangeSession,
} from './terminal-changeset-store.ts'

export type TerminalFsJournal = {
  readonly sessionId: string
  noteWrite: (absolutePath: string) => Promise<void>
  noteMkdir: (absolutePath: string) => Promise<void>
  noteUnlink: (absolutePath: string) => Promise<void>
  noteRmTree: (absolutePath: string) => Promise<void>
  noteRename: (oldPath: string, newPath: string) => Promise<void>
  seal: () => Promise<TerminalChangeSet>
}

function newSessionId(): string {
  return `tcs-${osNowMs().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
}

function parentDir(absolutePath: string): string {
  const trimmed = absolutePath.replace(/\/+$/, '') || '/'
  const idx = trimmed.lastIndexOf('/')
  if (idx <= 0) return '/'
  return trimmed.slice(0, idx) || '/'
}

async function listDescendantFiles(absolutePath: string): Promise<string[]> {
  const entry = await filesStat(absolutePath)
  if (!entry) return []
  if (entry.kind === 'file' || entry.kind === 'symlink') {
    return [absolutePath]
  }
  if (entry.kind !== 'folder') return []

  const out: string[] = []
  const children = await filesList(absolutePath)
  for (const child of children) {
    const childPath = child.path
    if (child.kind === 'folder') {
      out.push(...(await listDescendantFiles(childPath)))
    } else {
      out.push(childPath)
    }
  }
  return out
}

export function createTerminalFsJournal(): TerminalFsJournal {
  const sessionId = newSessionId()
  const createdAt = osNowMs()
  /** path → entry；同一 path 只记首次 before */
  const byPath = new Map<string, TerminalChangeEntry>()

  const ensureEntry = async (
    absolutePath: string,
    kind: TerminalChangeEntry['kind'],
    options?: { captureBefore?: boolean; fromPath?: string; isDirectory?: boolean },
  ): Promise<void> => {
    const existing = byPath.get(absolutePath)
    if (existing) {
      // 保留首次 before；更新最终 kind。本轮新建又删则从清单移除。
      if (kind === 'deleted') {
        if (existing.kind === 'added' && !existing.beforeBlobId) {
          byPath.delete(absolutePath)
        } else {
          existing.kind = 'deleted'
        }
      } else if (kind === 'renamed' && options?.fromPath) {
        existing.kind = 'renamed'
        existing.fromPath = options.fromPath
      } else if (existing.kind !== 'deleted' && existing.kind !== 'added') {
        existing.kind = kind === 'added' ? 'modified' : kind
      }
      return
    }

    let beforeBlobId: string | undefined
    let byteSize: number | undefined
    if (options?.captureBefore !== false) {
      const before = await putBeforeBlobFromPath(absolutePath)
      if (before) {
        beforeBlobId = before.blobId
        byteSize = before.byteSize
      }
    }

    const entry: TerminalChangeEntry = {
      path: absolutePath,
      kind,
      fromPath: options?.fromPath,
      beforeBlobId,
      meta: {
        byteSize,
        isDirectory: options?.isDirectory,
      },
    }
    byPath.set(absolutePath, entry)
  }

  return {
    sessionId,
    async noteWrite(absolutePath) {
      const existing = await filesStat(absolutePath)
      if (existing === undefined) {
        await ensureEntry(absolutePath, 'added', { captureBefore: false })
        return
      }
      await ensureEntry(absolutePath, 'modified', { captureBefore: true })
    },
    async noteMkdir(absolutePath) {
      const existing = await filesStat(absolutePath)
      if (existing !== undefined) return
      await ensureEntry(absolutePath, 'added', {
        captureBefore: false,
        isDirectory: true,
      })
    },
    async noteUnlink(absolutePath) {
      await ensureEntry(absolutePath, 'deleted', { captureBefore: true })
    },
    async noteRmTree(absolutePath) {
      const entry = await filesStat(absolutePath)
      if (!entry) return
      if (entry.kind === 'folder') {
        const files = await listDescendantFiles(absolutePath)
        for (const filePath of files) {
          await ensureEntry(filePath, 'deleted', { captureBefore: true })
        }
        await ensureEntry(absolutePath, 'deleted', {
          captureBefore: false,
          isDirectory: true,
        })
        return
      }
      await ensureEntry(absolutePath, 'deleted', { captureBefore: true })
    },
    async noteRename(oldPath, newPath) {
      const source = await filesStat(oldPath)
      if (!source) return
      if (byPath.has(oldPath)) {
        const prev = byPath.get(oldPath)!
        byPath.delete(oldPath)
        byPath.set(newPath, {
          ...prev,
          path: newPath,
          kind: prev.kind === 'added' ? 'added' : 'renamed',
          fromPath: prev.kind === 'added' ? undefined : oldPath,
        })
        return
      }
      let beforeBlobId: string | undefined
      let byteSize: number | undefined
      if (source.kind === 'file') {
        const before = await putBeforeBlobFromPath(oldPath)
        if (before) {
          beforeBlobId = before.blobId
          byteSize = before.byteSize
        }
      }
      byPath.set(newPath, {
        path: newPath,
        kind: 'renamed',
        fromPath: oldPath,
        beforeBlobId,
        meta: {
          byteSize,
          isDirectory: source.kind === 'folder',
        },
      })
    },
    async seal() {
      const changeSet: TerminalChangeSet = {
        sessionId,
        createdAt,
        sealedAt: osNowMs(),
        changes: [...byPath.values()],
      }
      if (changeSet.changes.length > 0) {
        await saveTerminalChangeSession(changeSet)
      }
      return changeSet
    },
  }
}

/**
 * 按 ChangeSet 整轮回滚：删新增、还原修改/删除、逆向 rename。
 * 成功后删除对应 session 与 before blobs。
 */
export async function revertTerminalChangeSet(changeSet: TerminalChangeSet): Promise<void> {
  const changes = [...changeSet.changes]

  // 1) 撤销 added：先文件后目录（深路径优先）
  const added = changes
    .filter((c) => c.kind === 'added')
    .sort((a, b) => b.path.length - a.path.length)
  for (const entry of added) {
    try {
      await filesRemove(entry.path)
    } catch {
      // 可能已被用户改掉
    }
  }

  // 2) 撤销 renamed：把新路径移回旧路径（若新仍在）
  const renamed = changes.filter((c) => c.kind === 'renamed' && c.fromPath)
  for (const entry of renamed) {
    const fromPath = entry.fromPath!
    try {
      const atNew = await filesStat(entry.path)
      const atOld = await filesStat(fromPath)
      if (atNew && !atOld) {
        // 简单做法：若有 before 则写回 fromPath 并删 new；否则尝试依赖 rename 语义不足时跳过
        if (entry.beforeBlobId) {
          const bytes = await readBeforeBlobBytes(entry.beforeBlobId)
          if (bytes) {
            await ensureParentDirs(fromPath)
            const ab = bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer
            const existing = await filesStat(fromPath)
            if (existing) {
              await filesWriteBinary(fromPath, ab)
            } else {
              await filesCreateBinary(fromPath, ab)
            }
          }
        }
        await filesRemove(entry.path)
      }
    } catch {
      // ignore
    }
  }

  // 3) 还原 modified / deleted：写回 before
  const restore = changes.filter((c) => c.kind === 'modified' || c.kind === 'deleted')
  for (const entry of restore) {
    if (!entry.beforeBlobId) {
      if (entry.meta?.isDirectory) {
        try {
          await ensureParentDirs(entry.path)
          const st = await filesStat(entry.path)
          if (!st) await filesMkdir(entry.path)
        } catch {
          // ignore
        }
      }
      continue
    }
    const bytes = await readBeforeBlobBytes(entry.beforeBlobId)
    if (!bytes) continue
    try {
      await ensureParentDirs(entry.path)
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer
      const existing = await filesStat(entry.path)
      if (existing?.kind === 'file') {
        await filesWriteBinary(entry.path, ab)
      } else if (existing === undefined) {
        await filesCreateBinary(entry.path, ab)
      }
    } catch {
      // ignore partial failures
    }
  }

  await deleteTerminalChangeSession(changeSet.sessionId)
}

async function ensureParentDirs(absolutePath: string): Promise<void> {
  const dir = parentDir(absolutePath)
  if (dir === '/' || dir === '') return
  const segments = dir.split('/').filter(Boolean)
  let current = ''
  for (const seg of segments) {
    current = current ? `${current}/${seg}` : `/${seg}`
    const st = await filesStat(current)
    if (!st) {
      try {
        await filesMkdir(current)
      } catch {
        // race / exists
      }
    }
  }
}
