/**
 * `/tmp` 卷：session 级临时目录路径、ensure、按启动时间清理。
 * 长期缓存；不随终端 rebuild/撤销自动删除。ChangeSet journal 不记录此卷写入。
 */
import { osNowMs } from '../../os/os-clock.ts'
import {
  filesLocationPathRoot,
  joinFilesAbsolutePath,
  normalizeFilesNodeName,
  parseFilesAbsolutePath,
} from './files-path.ts'
import {
  collectSubtreeIds,
  createFolderNode,
  deleteSubtree,
  estimateNodeMetaBytes,
  listChildNodes,
  newFilesNodeId,
} from './files-storage.ts'
import type { FilesNode, FilesNodeAttributes } from './files-types.ts'
import { emitSystemVfsChange } from './files-system-vfs.ts'
import {
  invalidateFilesVfsPathCaches,
  resolveFilesAbsolutePath,
  resolveNodeByAbsolutePath,
} from './files-vfs.ts'

const TMP_ROOT = filesLocationPathRoot('tmp')

export const TMP_TERMINAL_PREFIX = joinFilesAbsolutePath(TMP_ROOT, 'Terminal')
export const TMP_NPM_PREFIX = joinFilesAbsolutePath(TMP_ROOT, 'Npm')

export const TMP_FOLDER_ATTRIBUTES: FilesNodeAttributes = {
  readable: true,
  writable: true,
}

/** 终端 REPL / Agent 的 session 级 tmpdir */
export function terminalTmpDir(sessionId: string): string {
  const id = normalizeFilesNodeName(sessionId.trim())
  return joinFilesAbsolutePath(TMP_TERMINAL_PREFIX, id)
}

/** 无绑定终端时 npm/npx 独立 run 的 tmpdir */
export function npmRunTmpDir(runId: string): string {
  const id = normalizeFilesNodeName(runId.trim())
  return joinFilesAbsolutePath(TMP_NPM_PREFIX, id)
}

/** 路径是否落在 `/tmp` 卷下（含卷根本身） */
export function isUnderTmpPath(absolutePath: string): boolean {
  const normalized = absolutePath.trim().replace(/\/+$/, '') || '/'
  if (normalized === TMP_ROOT || normalized.startsWith(`${TMP_ROOT}/`)) {
    return true
  }
  const parsed = parseFilesAbsolutePath(normalized)
  return parsed?.locationId === 'tmp'
}

/**
 * 解析实例应使用的 tmpdir。
 * terminalSessionId 优先；否则 npmRunId；皆无则回落卷根 `/tmp`（通常不可作为写沙箱）。
 */
export function resolveSessionTmpDir(options: {
  terminalSessionId?: string
  npmRunId?: string
}): string {
  const terminalId = options.terminalSessionId?.trim()
  if (terminalId) return terminalTmpDir(terminalId)
  const npmId = options.npmRunId?.trim()
  if (npmId) return npmRunTmpDir(npmId)
  return TMP_ROOT
}

/** 确保 tmp 卷下文件夹链存在（可写）。 */
export async function ensureTmpFolder(absolutePath: string): Promise<FilesNode> {
  const parsed = parseFilesAbsolutePath(absolutePath)
  if (!parsed || parsed.locationId !== 'tmp') {
    throw new Error(`无效的临时路径：${absolutePath}`)
  }
  if (parsed.segments.length === 0) {
    throw new Error(`不能 ensure 卷根：${absolutePath}`)
  }

  const parentSegments = parsed.segments.slice(0, -1)
  const name = parsed.segments[parsed.segments.length - 1]
  if (!name) throw new Error(`无效的临时路径：${absolutePath}`)

  let parentId: string | undefined
  if (parentSegments.length > 0) {
    const parentPath = joinFilesAbsolutePath(TMP_ROOT, ...parentSegments)
    const parent = await ensureTmpFolder(parentPath)
    parentId = parent.id
  }

  invalidateFilesVfsPathCaches()
  const byPath = await resolveNodeByAbsolutePath(absolutePath)
  if (byPath) {
    if (byPath.kind !== 'folder') {
      throw new Error(`路径冲突：${absolutePath} 不是文件夹`)
    }
    return byPath
  }

  const siblings = await listChildNodes('tmp', parentId)
  const byName = siblings.find((child) => child.name === name)
  if (byName) {
    if (byName.kind !== 'folder') {
      throw new Error(`路径冲突：${absolutePath} 不是文件夹`)
    }
    return byName
  }

  const now = osNowMs()
  const node: FilesNode = {
    id: newFilesNodeId(),
    locationId: 'tmp',
    parentId,
    name,
    kind: 'folder',
    mimeType: undefined,
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes: TMP_FOLDER_ATTRIBUTES,
  }
  await createFolderNode({ node, metaBytes: estimateNodeMetaBytes(node) })
  emitSystemVfsChange(absolutePath, 'created')
  return node
}

/** 确保终端 / npm session 的 tmpdir 目录存在。 */
export async function ensureTmpSessionDir(absolutePath: string): Promise<FilesNode> {
  return ensureTmpFolder(absolutePath)
}

export type ClearTmpCreatedBeforeResult = {
  deletedRoots: number
  reclaimBytes: number
}

/**
 * 删除 tmp 卷下 `createdAt < beforeMs` 的顶层 session/run 目录（及其子树）。
 * 保留本次启动之后创建的目录，避免影响正在运行的终端。
 */
export async function clearTmpCreatedBefore(beforeMs: number): Promise<ClearTmpCreatedBeforeResult> {
  let deletedRoots = 0
  let reclaimBytes = 0

  for (const prefix of [TMP_TERMINAL_PREFIX, TMP_NPM_PREFIX] as const) {
    const prefixNode = await resolveNodeByAbsolutePath(prefix)
    if (!prefixNode || prefixNode.kind !== 'folder') continue

    const children = await listChildNodes('tmp', prefixNode.id)
    for (const child of children) {
      if (child.createdAt >= beforeMs) continue
      const childPath = await resolveFilesAbsolutePath(child)
      const subtree = await collectSubtreeIds(child.id)
      reclaimBytes += subtree.reclaimBytes
      await deleteSubtree(subtree)
      emitSystemVfsChange(childPath, 'deleted')
      deletedRoots += 1
    }
  }

  return { deletedRoots, reclaimBytes }
}
