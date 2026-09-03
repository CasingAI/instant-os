/**
 * 文件压缩 / 解压操作封装（依赖注入版）。
 * Files 应用与右键菜单贡献方共用：进度弹窗 + 写文件 + 提示的错误处理在此收敛，
 * 组件内部只负责传入当前目录上下文与 UI 回调。
 */
import {
  compressEntriesToArchive,
  planCompressNodesToArchive,
  extractArchiveToDirectory,
  isArchiveFileName,
  type FilesArchiveFormat,
  type FilesCompressPlanEntry,
} from './files-archive.ts'
import {
  estimateFilesOpDurationMs,
  filesWorkloadUnits,
} from './files-op-progress-policy.ts'
import {
  isFilesOpCancelledError,
  runFilesOpWithProgress,
} from './files-run-with-op-progress.ts'
import { createBinaryFile } from './files-vfs.ts'
import type { FilesLocationId, FilesNode } from './files-types.ts'

export type FilesArchiveOpsContext = {
  locationId: FilesLocationId
  folderId: string | undefined
  /** 解压目标目录（当前目录）绝对路径 */
  destRoot: string
  canCreateHere: boolean
  refresh: (options?: { quiet?: boolean }) => Promise<void>
  showToast: (message: string) => void
  alertError: (title: string, error: unknown) => Promise<void>
}

/** 压缩选中节点为 zip / tar.gz / iso，写入当前目录 */
export async function compressNodesToArchiveOp(
  nodes: readonly FilesNode[],
  format: FilesArchiveFormat,
  context: FilesArchiveOpsContext,
): Promise<void> {
  if (nodes.length === 0 || !context.canCreateHere) return
  try {
    let entries: FilesCompressPlanEntry[] = []
    let fileCount = 0
    let byteCount = 0
    let totalWork = 1
    const controller = new AbortController()

    const result = await runFilesOpWithProgress({
      kind: 'compress',
      estimate: async () => {
        const planned = await planCompressNodesToArchive(nodes)
        entries = planned.entries
        fileCount = planned.fileCount
        byteCount = planned.byteCount
        totalWork = filesWorkloadUnits(fileCount, byteCount)
        return totalWork
      },
      signal: controller.signal,
      cancel: () => controller.abort(),
      task: async (report, signal) =>
        compressEntriesToArchive(
          entries,
          format,
          ({ doneFiles, totalFiles, doneBytes }) => {
            report({
              done: filesWorkloadUnits(fileCount, doneBytes),
              total: totalWork,
              detailLabel: `${doneFiles} / ${totalFiles} 个文件`,
            })
          },
          signal,
        ),
    })

    const baseName = nodes.length === 1 ? nodes[0]!.name : '归档'
    const extension = format === 'zip' ? '.zip' : format === 'iso' ? '.iso' : '.tar.gz'
    const name = `${baseName}${extension}`
    const bytes = result.bytes.buffer.slice(
      result.bytes.byteOffset,
      result.bytes.byteOffset + result.bytes.byteLength,
    ) as ArrayBuffer
    await createBinaryFile({
      locationId: context.locationId,
      parentId: context.folderId,
      name,
      bytes,
      mimeType:
        format === 'zip'
          ? 'application/zip'
          : format === 'iso'
            ? 'application/x-iso9660-image'
            : 'application/gzip',
    })
    context.showToast(`已压缩 ${result.entryCount} 个文件`)
    await context.refresh({ quiet: true })
  } catch (error) {
    if (isFilesOpCancelledError(error)) {
      context.showToast('已取消')
      return
    }
    await context.alertError('无法压缩', error)
  }
}

/** 解压归档到当前目录 */
export async function extractArchiveToDirectoryOp(
  node: FilesNode,
  context: FilesArchiveOpsContext,
): Promise<void> {
  if (!context.canCreateHere || !isArchiveFileName(node.name)) return
  try {
    const controller = new AbortController()
    const result = await runFilesOpWithProgress({
      kind: 'extract',
      totalWork: 1,
      estimatedTotalMs: estimateFilesOpDurationMs(1),
      signal: controller.signal,
      cancel: () => controller.abort(),
      task: async (report, signal) =>
        extractArchiveToDirectory({
          node,
          destRoot: context.destRoot,
          signal,
          onProgress: (done, total) =>
            report({ done, total, detailLabel: `${done} / ${total} 项` }),
        }),
    })
    const targetSuffix = result.destinationName ? `到「${result.destinationName}」` : ''
    context.showToast(
      result.fileCount > 0 ? `已解压 ${result.fileCount} 个文件${targetSuffix}` : '归档为空',
    )
    await context.refresh()
  } catch (error) {
    if (isFilesOpCancelledError(error)) {
      context.showToast('已取消')
      return
    }
    await context.alertError('无法解压', error)
  }
}
