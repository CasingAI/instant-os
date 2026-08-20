import { filesList, filesListSubtreeFiles, filesStat } from '../files/files-api.ts'
import { parseFilesAbsolutePath } from '../files/files-path.ts'
import { isMountLocationId } from '../files/files-types.ts'
import type { ScanNode, ScanOptions, ScanProgress } from './space-sniffer-types.ts'

const REPORT_EVERY_FILES = 24

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function assertNotAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

function rootNameFromPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '') || '/'
  if (trimmed === '/') return '/'
  const segments = trimmed.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? trimmed
}

type MutableFolder = {
  path: string
  name: string
  kind: 'folder'
  byteSize: number
  updatedAt?: number
  children: Map<string, MutableNode>
}

type MutableFile = {
  path: string
  name: string
  kind: 'file'
  byteSize: number
  updatedAt?: number
  mimeType?: string
}

type MutableNode = MutableFolder | MutableFile

function createFolder(path: string, name: string): MutableFolder {
  return {
    path,
    name,
    kind: 'folder',
    byteSize: 0,
    children: new Map(),
  }
}

function ensureFolderChain(
  root: MutableFolder,
  rootPath: string,
  relativeSegments: string[],
): MutableFolder {
  let current = root
  let currentPath = rootPath.replace(/\/+$/, '') || '/'

  for (const segment of relativeSegments) {
    currentPath = currentPath === '/' ? `/${segment}` : `${currentPath}/${segment}`
    let child = current.children.get(segment)
    if (!child || child.kind !== 'folder') {
      child = createFolder(currentPath, segment)
      current.children.set(segment, child)
    }
    current = child
  }

  return current
}

function finalizeTree(node: MutableNode): ScanNode {
  if (node.kind === 'file') {
    return {
      path: node.path,
      name: node.name,
      kind: 'file',
      byteSize: node.byteSize,
      updatedAt: node.updatedAt,
      mimeType: node.mimeType,
    }
  }

  const children = [...node.children.values()]
    .map((child) => finalizeTree(child))
    .sort((left, right) => right.byteSize - left.byteSize)

  const byteSize = children.reduce((sum, child) => sum + child.byteSize, 0)
  let updatedAt = node.updatedAt
  for (const child of children) {
    if (child.updatedAt !== undefined) {
      updatedAt = Math.max(updatedAt ?? 0, child.updatedAt)
    }
  }

  return {
    path: node.path,
    name: node.name,
    kind: 'folder',
    byteSize,
    updatedAt,
    children,
  }
}

function countNodes(root: ScanNode): { fileCount: number; folderCount: number } {
  let fileCount = 0
  let folderCount = 0
  const stack: ScanNode[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    if (node.kind === 'file') {
      fileCount += 1
    } else {
      folderCount += 1
      if (node.children) {
        stack.push(...node.children)
      }
    }
  }
  return { fileCount, folderCount }
}

function emitProgress(
  root: MutableFolder,
  options: ScanOptions,
  done: boolean,
  error?: string,
): ScanProgress {
  const finalized = finalizeTree(root)
  const counts = countNodes(finalized)
  const progress: ScanProgress = {
    root: finalized,
    fileCount: counts.fileCount,
    folderCount: counts.folderCount,
    done,
    error,
  }
  options.onProgress?.(progress)
  return progress
}

function isLocalIndexedDbVolume(rootPath: string): boolean {
  const parsed = parseFilesAbsolutePath(rootPath.replace(/\/+$/, '') || '/')
  if (!parsed) return false
  if (isMountLocationId(parsed.locationId)) return false
  return parsed.locationId === 'local' || parsed.locationId === 'dev'
}

async function scanLocalVolume(rootPath: string, options: ScanOptions): Promise<ScanProgress> {
  const absoluteRoot = rootPath.replace(/\/+$/, '') || '/'
  const root = createFolder(absoluteRoot, rootNameFromPath(absoluteRoot))

  const files = await filesListSubtreeFiles(absoluteRoot)
  assertNotAborted(options.signal)

  let processed = 0
  for (const file of files) {
    assertNotAborted(options.signal)

    const relative = file.path
    const segments = relative.split('/').filter(Boolean)
    if (segments.length === 0) continue

    const fileName = segments[segments.length - 1] ?? file.path
    const parentSegments = segments.slice(0, -1)
    const parent = ensureFolderChain(root, absoluteRoot, parentSegments)
    const filePath =
      absoluteRoot === '/'
        ? `/${segments.join('/')}`
        : `${absoluteRoot}/${segments.join('/')}`

    parent.children.set(fileName, {
      path: filePath,
      name: fileName,
      kind: 'file',
      byteSize: file.byteSize,
      updatedAt: file.updatedAt,
    })

    processed += 1
    if (processed % REPORT_EVERY_FILES === 0) {
      emitProgress(root, options, false)
      await yieldEventLoop()
    }
  }

  return emitProgress(root, options, true)
}

async function scanByWalking(rootPath: string, options: ScanOptions): Promise<ScanProgress> {
  const absoluteRoot = rootPath.replace(/\/+$/, '') || '/'
  const root = createFolder(absoluteRoot, rootNameFromPath(absoluteRoot))
  let processed = 0

  async function walk(dirPath: string, folder: MutableFolder): Promise<void> {
    assertNotAborted(options.signal)

    let entries
    try {
      entries = await filesList(dirPath)
    } catch {
      return
    }

    for (const entry of entries) {
      assertNotAborted(options.signal)

      if (entry.kind === 'symlink') {
        continue
      }

      if (entry.kind === 'folder') {
        const childFolder = createFolder(entry.path, entry.name)
        folder.children.set(entry.name, childFolder)
        await walk(entry.path, childFolder)
        continue
      }

      folder.children.set(entry.name, {
        path: entry.path,
        name: entry.name,
        kind: 'file',
        byteSize: entry.byteSize,
        updatedAt: entry.updatedAt,
        mimeType: entry.mimeType,
      })

      processed += 1
      if (processed % REPORT_EVERY_FILES === 0) {
        emitProgress(root, options, false)
        await yieldEventLoop()
      }
    }
  }

  await walk(absoluteRoot, root)
  return emitProgress(root, options, true)
}

export async function scanPath(rootPath: string, options: ScanOptions = {}): Promise<ScanProgress> {
  const absoluteRoot = rootPath.trim().replace(/\/+$/, '') || '/'

  try {
    assertNotAborted(options.signal)

    if (absoluteRoot === '/') {
      throw new Error('请选择具体的卷或文件夹，不能扫描命名空间根')
    }

    const stat = await filesStat(absoluteRoot)
    if (!stat) {
      throw new Error(`路径不存在：${absoluteRoot}`)
    }
    if (stat.kind !== 'folder') {
      throw new Error('只能扫描文件夹或卷')
    }

    if (isLocalIndexedDbVolume(absoluteRoot)) {
      return await scanLocalVolume(absoluteRoot, options)
    }

    return await scanByWalking(absoluteRoot, options)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      const empty = createFolder(absoluteRoot, rootNameFromPath(absoluteRoot))
      return emitProgress(empty, options, true, '已取消')
    }

    const message = error instanceof Error && error.message ? error.message : '扫描失败'
    const empty = createFolder(absoluteRoot, rootNameFromPath(absoluteRoot))
    return emitProgress(empty, options, true, message)
  }
}

export function findNodeByPath(root: ScanNode, path: string): ScanNode | undefined {
  if (root.path === path) {
    return root
  }
  const queue: ScanNode[] = [root]
  while (queue.length > 0) {
    const node = queue.shift()
    if (!node) continue
    if (node.path === path) return node
    if (node.children) {
      queue.push(...node.children)
    }
  }
  return undefined
}
