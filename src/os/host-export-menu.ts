/**
 * "宿主"右键菜单贡献：将选中的文件 / 文件夹导出到宿主机器（真实文件系统）。
 * 单文件直接下载原文件；多选或文件夹打包为 ZIP 后触发浏览器下载。
 */
import { compressNodesToArchive } from '../apps/files/files-archive.ts'
import { readFileBlob } from '../apps/files/files-vfs.ts'
import type { FilesNode } from '../apps/files/files-types.ts'
import { registerFilesContextMenuContribution } from './file-context-menu-registry.ts'

function triggerHostDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function hostDownloadFileName(nodes: readonly FilesNode[]): string {
  if (nodes.length === 1) {
    const node = nodes[0]!
    return node.kind === 'file' ? node.name : `${node.name}.zip`
  }
  return '导出.zip'
}

/** 把选中节点导出到宿主机器：单文件直接下载，多选 / 文件夹打包 ZIP 下载 */
export async function exportSelectionToHost(nodes: readonly FilesNode[]): Promise<void> {
  if (nodes.length === 0) {
    return
  }
  try {
    if (nodes.length === 1 && nodes[0]!.kind === 'file') {
      const { blob } = await readFileBlob(nodes[0]!.id)
      triggerHostDownload(blob, nodes[0]!.name)
      return
    }
    const result = await compressNodesToArchive(nodes, 'zip')
    const bytes = result.bytes.buffer.slice(
      result.bytes.byteOffset,
      result.bytes.byteOffset + result.bytes.byteLength,
    ) as ArrayBuffer
    const blob = new Blob([bytes], { type: 'application/zip' })
    triggerHostDownload(blob, hostDownloadFileName(nodes))
  } catch (error) {
    console.error('[host-export] 导出到宿主失败', error)
  }
}

registerFilesContextMenuContribution({
  id: 'host.export',
  label: '宿主',
  matches: () => true,
  buildItems: ({ targetNodes }) => [
    {
      label: '导出到宿主',
      onClick: () => void exportSelectionToHost(targetNodes),
    },
  ],
})
