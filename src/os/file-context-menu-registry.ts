/**
 * 系统文件右键菜单贡献注册表（对齐 file-open-registry 模式）。
 * 各能力模块（如压缩包实用工具）在模块顶层注册自己的一级菜单项 + 二级菜单内容，
 * Files 应用渲染右键菜单时按当前节点查询并合并进菜单。
 */
import type { FilesNode } from '../apps/files/files-types.ts'

/** 贡献项二级菜单中的操作项 */
export type FilesContextMenuOpItem = {
  label: string
  disabled?: boolean
  onClick: () => void
}

/** Files 应用暴露给贡献项的通用操作能力 */
export type FilesContextMenuOps = {
  canCreateHere: boolean
  /** 压缩选中节点为 ZIP，写入当前目录 */
  compressAsZip: (nodes: readonly FilesNode[]) => void
  /** 压缩选中节点为 tar.gz，写入当前目录 */
  compressAsTarGz: (nodes: readonly FilesNode[]) => void
  /** 压缩选中节点为 ISO 数据镜像，写入当前目录 */
  compressAsIso: (nodes: readonly FilesNode[]) => void
  /** 解压归档到当前目录 */
  extractHere: (node: FilesNode) => void
  /** 按扩展名判断是否可解压的归档文件 */
  isArchiveFileName: (name: string) => boolean
}

export type FilesContextMenuContribution = {
  id: string
  /** 一级菜单项文案 */
  label: string
  /** 判定该贡献项是否适用于给定节点（含当前目录是否可写） */
  matches: (params: { node: FilesNode; canCreateHere: boolean }) => boolean
  /** 构建二级菜单项；返回空数组则不显示该一级菜单 */
  buildItems: (params: {
    node: FilesNode
    targetNodes: readonly FilesNode[]
    ops: FilesContextMenuOps
  }) => FilesContextMenuOpItem[]
}

const contributions: FilesContextMenuContribution[] = []

export function registerFilesContextMenuContribution(contribution: FilesContextMenuContribution): void {
  const existing = contributions.find((item) => item.id === contribution.id)
  if (existing) {
    contributions[contributions.indexOf(existing)] = contribution
    return
  }
  contributions.push(contribution)
}

export function listFilesContextMenuContributions(params: {
  node: FilesNode
  canCreateHere: boolean
}): FilesContextMenuContribution[] {
  return contributions.filter((contribution) => contribution.matches(params))
}
