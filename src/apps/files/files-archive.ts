/**
 * 文件 App 的压缩 / 解压封装：
 * - 压缩：递归收集选中节点（文件读 blob；文件夹递归列目录；跳过符号链接防环）→ Worker 打包
 * - 解压：Worker 解码（魔数自动识别；裸 .gz 走单文件分支）→ macOS 式布局
 *   （单顶层直接解出该条目，多顶层套同名文件夹）→ 冲突加「 2」后缀不覆盖 → 批量落盘
 */
import { recordSystemDebugTimeline } from '../../os/system-debug-log.ts'
import { decodeArchiveInWorker, encodeArchiveInWorker } from '../../archive/archive-worker-client.ts'
import { extractZipToDirectory } from '../../archive/archive-extract.ts'
import { materializeArchiveEntries } from '../../archive/archive-materialize.ts'
import {
  allocateUniqueFileName,
  remapEntriesAwayFromExisting,
  uniqueSiblingName,
} from '../archive-utility/archive-utility-conflict.ts'
import { stripArchiveExtension } from '../archive-utility/archive-utility-format.ts'
import { isBareGzipFileName, topLevelNames, wrapEntriesInFolder } from './files-extract-layout.ts'
import type { FilesNode } from './files-types.ts'
import { filesList } from './files-api.ts'
import { listDirectory, readFileBlob } from './files-vfs.ts'

export type FilesArchiveFormat = 'zip' | 'gzip-tar' | 'iso'

export type FilesCompressResult = {
  bytes: Uint8Array
  entryCount: number
}

/**
 * 按扩展名判断是否可解压的归档文件（不含路径）。
 * 与压缩包实用工具 resolveArchiveUtilityFormat 同口径：zip / tar / tar.gz / tgz / gz / iso。
 */
export function isArchiveFileName(name: string): boolean {
  return /\.(zip|tar|tar\.gz|tgz|gz|iso)$/i.test(name)
}

export type FilesCompressPlanEntry = { path: string; node: FilesNode }

/**
 * 扫描阶段：只遍历目录结构、收集文件节点，不读取 blob。
 * 返回文件数与字节总数，供调用方在进度策略里折算工作量。
 */
export async function planCompressNodesToArchive(nodes: readonly FilesNode[]): Promise<{
  entries: FilesCompressPlanEntry[]
  fileCount: number
  byteCount: number
}> {
  const entries: FilesCompressPlanEntry[] = []
  const visitedFolders = new Set<string>()
  const visitedFiles = new Set<string>()

  const collectNode = async (node: FilesNode, relativePath: string): Promise<void> => {
    if (node.kind === 'symlink') return
    if (node.kind === 'folder') {
      if (visitedFolders.has(node.id)) return
      visitedFolders.add(node.id)
      const children = await listDirectory(node.locationId, node.id)
      for (const child of children) {
        await collectNode(child, `${relativePath}/${child.name}`)
      }
      return
    }
    if (visitedFiles.has(node.id)) return
    visitedFiles.add(node.id)
    entries.push({ path: relativePath, node })
  }

  for (const node of nodes) {
    await collectNode(node, node.name)
  }

  const fileCount = entries.length
  const byteCount = entries.reduce((sum, entry) => sum + entry.node.byteSize, 0)
  return { entries, fileCount, byteCount }
}

export type FilesCompressProgress = {
  doneFiles: number
  totalFiles: number
  doneBytes: number
  totalBytes: number
}

/**
 * 读取 + 编码阶段：按扫描结果读取 blob 并交给 Worker 打包。
 * onProgress 回调返回文件数与字节数，方便调用方映射为统一工作量单位。
 * signal 每文件检查一次；Worker 编码阶段透传给 worker client（terminate 取消）。
 */
export async function compressEntriesToArchive(
  entries: readonly FilesCompressPlanEntry[],
  format: FilesArchiveFormat,
  onProgress?: (progress: FilesCompressProgress) => void,
  signal?: AbortSignal,
): Promise<FilesCompressResult> {
  const codecEntries: { path: string; bytes: ArrayBuffer }[] = []
  const totalBytes = entries.reduce((sum, entry) => sum + entry.node.byteSize, 0)
  let doneFiles = 0
  let doneBytes = 0

  for (const { path, node } of entries) {
    signal?.throwIfAborted?.()
    const { blob } = await readFileBlob(node.id)
    const bytes = await blob.arrayBuffer()
    codecEntries.push({ path, bytes })
    doneFiles += 1
    doneBytes += bytes.byteLength
    onProgress?.({ doneFiles, totalFiles: entries.length, doneBytes, totalBytes })
  }

  const bytes = await encodeArchiveInWorker({ entries: codecEntries, format, signal })
  return { bytes, entryCount: codecEntries.length }
}

/** 把选中节点压缩为归档：相对路径 = 选中名 + 内部路径（/ 分隔） */
export async function compressNodesToArchive(
  nodes: readonly FilesNode[],
  format: FilesArchiveFormat,
  onProgress?: (progress: FilesCompressProgress) => void,
  signal?: AbortSignal,
): Promise<FilesCompressResult> {
  const { entries } = await planCompressNodesToArchive(nodes)
  return compressEntriesToArchive(entries, format, onProgress, signal)
}

export type FilesExtractResult = {
  fileCount: number
  bytesWritten: number
  /** 实际落点名（当前目录下）：多顶层时为包裹文件夹名，单顶层/裸 gz 时为解出的条目名 */
  destinationName?: string
}

/**
 * 解压归档到目标目录（macOS 归档实用工具语义，不摊平、不覆盖已有内容）：
 * - 归档内只有单个顶层条目 → 直接解出该条目本身；
 * - 多个顶层条目（散装文件）→ 套进一个与压缩包同名的文件夹；
 * - 顶层名与目标目录现有内容冲突 → 整体加「 2」「 3」后缀改名。
 * 裸 .gz（非 tar.gz/tgz）按单文件解压，输出名为去掉 .gz 的主干名。
 */
export async function extractArchiveToDirectory(params: {
  node: FilesNode
  destRoot: string
  onProgress?: (done: number, total: number) => void
  /** 取消信号：解码/落盘阶段检查（Worker 阶段 terminate 打断） */
  signal?: AbortSignal
}): Promise<FilesExtractResult> {
  const { node, destRoot, onProgress, signal } = params
  const extractStartAt = performance.now()
  const { blob } = await readFileBlob(node.id)
  const bytes = new Uint8Array(await blob.arrayBuffer())

  if (isBareGzipFileName(node.name)) {
    const decoded = await decodeArchiveInWorker({ bytes, format: 'gzip-file', signal })
    const inflated = decoded.get('data')
    if (!inflated) throw new Error('无法解压该 gzip 文件（文件可能已损坏）')
    const desiredName = stripArchiveExtension(node.name) || '解压文件'
    const outName = await allocateUniqueFileName(destRoot, desiredName)
    const written = await materializeArchiveEntries({
      destRoot,
      entries: [{ relativePath: outName, bytes: inflated }],
      signal,
      onProgress: (progress) => onProgress?.(progress.done, progress.total),
    })
    return {
      fileCount: written.fileCount,
      bytesWritten: written.bytesWritten,
      destinationName: outName,
    }
  }

  const entries = await decodeArchiveInWorker({ bytes, format: 'auto', stripRoot: false, signal })
  if (entries.size === 0) {
    return { fileCount: 0, bytesWritten: 0 }
  }

  let finalEntries = entries
  let wrapperName: string | undefined
  if (topLevelNames(entries.keys()).length > 1) {
    const listing = await filesList(destRoot)
    wrapperName = uniqueSiblingName(
      new Set(listing.map((entry) => entry.name)),
      stripArchiveExtension(node.name) || '归档',
    )
    finalEntries = wrapEntriesInFolder(entries, wrapperName)
  } else {
    finalEntries = await remapEntriesAwayFromExisting(destRoot, entries)
  }

  const shared = {
    destRoot,
    zip: bytes,
    entries: finalEntries,
    signal,
    onProgress: (progress: { done: number; total: number }) =>
      onProgress?.(progress.done, progress.total),
  }
  const result = await extractZipToDirectory(shared)
  recordSystemDebugTimeline({
    layer: 'files',
    op: 'extract-archive-done',
    detail: `${node.name} → ${wrapperName ?? '(当前目录)'} ${result.fileCount} files ${result.bytesWritten}B`,
    durationMs: Math.round(performance.now() - extractStartAt),
  })
  return {
    fileCount: result.fileCount,
    bytesWritten: result.bytesWritten,
    destinationName: topLevelNames(finalEntries.keys())[0],
  }
}
