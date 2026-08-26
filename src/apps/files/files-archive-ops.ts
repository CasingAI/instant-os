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
} from './files-archive.ts'
import {
  estimateFilesOpDurationMs,
  filesWorkloadUnits,
} from './files-op-progress-policy.ts'
import { runFilesOpWithProgress, type FilesOpProgressUiState } from './files-run-with-op-progress.ts'
import { createBinaryFile } from './files-vfs.ts'
import type { FilesLocationId, FilesNode } from './files-types.ts'

export type FilesArchiveOpsContext = {
  locationId: FilesLocationId
  folderId: string | undefined
  /** 解压目标目录（当前目录）绝对路径 */
  destRoot: string
  canCreateHere: boolean
  setOpProgressUi: (state: FilesOpProgressUiState | undefined) => void
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
    const { entries, fileCount, byteCount } = await planCompressNodesToArchive(nodes)
    const totalWork = filesWorkloadUnits(fileCount, byteCount)

    const result = await runFilesOpWithProgress({
      kind: 'compress',
      totalWork,
      estimatedTotalMs: estimateFilesOpDurationMs(totalWork),
      onUiChange: context.setOpProgressUi,
      task: async (report) =>
        compressEntriesToArchive(entries, format, ({ doneBytes }) => {
          report({ done: filesWorkloadUnits(fileCount, doneBytes), total: totalWork })
        }),
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
    const result = await runFilesOpWithProgress({
      kind: 'extract',
      totalWork: 1,
      estimatedTotalMs: estimateFilesOpDurationMs(1),
      onUiChange: context.setOpProgressUi,
      task: async (report) =>
        extractArchiveToDirectory({
          node,
          destRoot: context.destRoot,
          onProgress: (done, total) => report({ done, total }),
        }),
    })
    context.showToast(result.fileCount > 0 ? `已解压 ${result.fileCount} 个文件` : '归档为空')
    await context.refresh()
  } catch (error) {
    await context.alertError('无法解压', error)
  }
}
