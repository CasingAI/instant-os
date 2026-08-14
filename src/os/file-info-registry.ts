/**
 * file-info 信息分节贡献注册表（对齐 file-open-registry 的扩展名 + rank 模式）。
 * 各能力模块（如图片预览）在模块顶层注册自己的信息分节，
 * file-info 渲染单项目面板时按当前节点的扩展名查询并渲染为卡片。
 */
import type { ComponentType } from 'preact'
import type { FilesNode } from '../apps/files/files-types.ts'
import { fileNameExtension, normalizeFileExtension } from './file-open-registry.ts'

export type FileInfoSectionProps = {
  node: FilesNode
  /** documentId 协议里的绝对路径 */
  path: string
  /** 懒加载文件正文 blob，仅匹配后按需调用 */
  readBlob: () => Promise<Blob>
}

export type FileInfoSectionContribution = {
  id: string
  /** 卡片标题，如「图片」 */
  title: string
  /** 命中判定的扩展名列表（自动 normalize 小写去点） */
  extensions: readonly string[]
  /** 多插件命中时的排序，缺省 100 */
  rank?: number
  component: ComponentType<FileInfoSectionProps>
}

type NormalizedContribution = {
  id: string
  title: string
  extensions: Set<string>
  /** 原始扩展名列表，返回给调用方 */
  rawExtensions: readonly string[]
  rank: number
  component: ComponentType<FileInfoSectionProps>
}

const contributions: NormalizedContribution[] = []

export function registerFileInfoSection(contribution: FileInfoSectionContribution): void {
  const normalized: NormalizedContribution = {
    id: contribution.id,
    title: contribution.title,
    extensions: new Set(
      contribution.extensions.map(normalizeFileExtension).filter((ext) => ext.length > 0),
    ),
    rawExtensions: contribution.extensions,
    rank: contribution.rank ?? 100,
    component: contribution.component,
  }
  if (normalized.extensions.size === 0) {
    return
  }

  const existing = contributions.find((item) => item.id === contribution.id)
  if (existing) {
    contributions[contributions.indexOf(existing)] = normalized
    return
  }
  contributions.push(normalized)
}

/** 按节点文件名扩展名筛选命中的信息分节，按 rank 升序 */
export function listFileInfoSections(node: FilesNode): FileInfoSectionContribution[] {
  const extension = fileNameExtension(node.name)
  if (!extension) {
    return []
  }
  return contributions
    .filter((contribution) => contribution.extensions.has(extension))
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
    .map(({ id, title, rawExtensions, rank, component }) => ({
      id,
      title,
      extensions: rawExtensions,
      rank,
      component,
    }))
}
