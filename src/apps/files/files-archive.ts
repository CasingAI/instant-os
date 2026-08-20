/**
 * 文件 App 的压缩 / 解压封装：
 * - 压缩：递归收集选中节点（文件读 blob；文件夹递归列目录；跳过符号链接防环）→ Worker 打包
 * - 解压：Worker 解码（魔数自动识别 zip / tar.gz）→ 批量落盘到当前目录
 */
import { decodeArchiveInWorker, encodeArchiveInWorker } from '../../archive/archive-worker-client.ts'
import { extractZipToDirectory } from '../../archive/archive-extract.ts'
import type { FilesNode } from './files-types.ts'
import { listDirectory, readFileBlob } from './files-vfs.ts'

export type FilesArchiveFormat = 'zip' | 'gzip-tar'

export type FilesCompressResult = {
  bytes: Uint8Array
  entryCount: number
}

/** 按扩展名判断是否可解压的归档文件（不含路径） */
export function isArchiveFileName(name: string): boolean {
  return /\.(zip|tar\.gz|tgz)$/i.test(name)
}

/** 把选中节点压缩为归档：相对路径 = 选中名 + 内部路径（/ 分隔） */
export async function compressNodesToArchive(
  nodes: readonly FilesNode[],
  format: FilesArchiveFormat,
  onFile?: () => void,
): Promise<FilesCompressResult> {
  const entries: { path: string; bytes: ArrayBuffer }[] = []
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
    const { blob } = await readFileBlob(node.id)
    const bytes = await blob.arrayBuffer()
    entries.push({ path: relativePath, bytes })
    onFile?.()
  }

  for (const node of nodes) {
    await collectNode(node, node.name)
  }

  const bytes = await encodeArchiveInWorker({ entries, format })
  return { bytes, entryCount: entries.length }
}

export type FilesExtractResult = { fileCount: number; bytesWritten: number }

/** 解压归档到目标绝对路径；返回写入的文件数与字节数 */
export async function extractArchiveToDirectory(params: {
  node: FilesNode
  destRoot: string
  onProgress?: (done: number, total: number) => void
}): Promise<FilesExtractResult> {
  const { node, destRoot, onProgress } = params
  const { blob } = await readFileBlob(node.id)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const entries = await decodeArchiveInWorker({ bytes, format: 'auto', stripRoot: true })

  if (entries.size === 0) {
    return { fileCount: 0, bytesWritten: 0 }
  }

  const shared = {
    destRoot,
    zip: bytes,
    entries,
    onProgress: (progress: { done: number; total: number }) =>
      onProgress?.(progress.done, progress.total),
  }
  const result = await extractZipToDirectory(shared)
  return { fileCount: result.fileCount, bytesWritten: result.bytesWritten }
}
