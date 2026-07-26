import { fileNameFromPath, monacoLanguageFromFileName } from '../../monaco/monaco-language.ts'
import { parseFilesAbsolutePath } from '../files/files-path.ts'
import {
  FILES_TEXT_MIME,
  defaultFilesNodeAttributes,
  type FilesNode,
} from '../files/files-types.ts'

export type VscodeTab = {
  id: string
  path: string
  name: string
  text: string
  savedText: string
  writable: boolean
  language: string
  node: FilesNode
  /** 磁盘上已不存在；保存时将按路径重新创建 */
  deleted: boolean
  /**
   * 未解决的磁盘冲突：编辑器显示草稿，diskText 为当前磁盘内容。
   * baseline 为产生冲突时的原稿基准，供热退出后再检测。
   */
  conflict: { diskText: string; baseline: string } | undefined
  /**
   * 二进制 / 不受支持编码：先在标签内询问，确认前不挂载 Monaco。
   */
  binaryPrompt: true | undefined
}

let tabSeq = 0

export function createVscodeTabId(): string {
  tabSeq += 1
  return `vscode-tab-${tabSeq}`
}

export function isVscodeTabDirty(tab: VscodeTab): boolean {
  if (tab.binaryPrompt) return false
  return tab.deleted || tab.conflict !== undefined || tab.text !== tab.savedText
}

export function isPreviewableTab(tab: VscodeTab): boolean {
  return tab.language === 'markdown'
}

function stubNodeForDeletedPath(path: string): FilesNode {
  const name = fileNameFromPath(path)
  const parsed = parseFilesAbsolutePath(path)
  const locationId = parsed?.locationId ?? 'local'
  const now = Date.now()
  return {
    id: `vscode-deleted:${path}`,
    locationId,
    parentId: undefined,
    name,
    kind: 'file',
    mimeType: FILES_TEXT_MIME,
    byteSize: 0,
    createdAt: now,
    updatedAt: now,
    attributes: defaultFilesNodeAttributes(locationId),
  }
}

export function buildVscodeTab(options: {
  path: string
  /** 编辑器当前正文（可为未保存草稿） */
  text: string
  node: FilesNode
  writable: boolean
  /** 磁盘基准；缺省与 text 相同（干净打开） */
  savedText?: string
  deleted?: boolean
  conflict?: { diskText: string; baseline: string }
  binaryPrompt?: true
}): VscodeTab {
  const name = options.node.name || fileNameFromPath(options.path)
  const savedText = options.savedText ?? options.text
  return {
    id: createVscodeTabId(),
    path: options.path,
    name,
    text: options.text,
    savedText,
    writable: options.writable,
    language: monacoLanguageFromFileName(name),
    node: options.node,
    deleted: options.deleted === true,
    conflict: options.conflict,
    binaryPrompt: options.binaryPrompt === true ? true : undefined,
  }
}

/** 磁盘文件已不存在时的恢复标签 */
export function buildDeletedVscodeTab(path: string, text: string): VscodeTab {
  const node = stubNodeForDeletedPath(path)
  return buildVscodeTab({
    path,
    text,
    savedText: '',
    node,
    writable: true,
    deleted: true,
  })
}

/** Virtual Studio Code Desktop 默认打开关联的源码后缀（不含 txt / html 族） */
export const VSCODE_OPEN_EXTENSIONS = [
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'mts',
  'cts',
  'tsx',
  'json',
  'jsonc',
  'md',
  'markdown',
  'mdx',
  'css',
  'scss',
  'less',
  'py',
  'pyw',
  'go',
  'rs',
  'java',
  'c',
  'h',
  'cpp',
  'cc',
  'cxx',
  'hpp',
  'hh',
  'cs',
  'php',
  'rb',
  'swift',
  'kt',
  'kts',
  'dart',
  'lua',
  'r',
  'sql',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'cfg',
  'env',
  'properties',
  'vue',
  'svelte',
  'graphql',
  'gql',
  'proto',
] as const

/**
 * 也可选用 Code 打开的后缀（与源码后缀一并注册）。
 * 默认仍由文本编辑 / 浏览器优先（同 rank 时按 appId 排序）；
 * 用户在「打开方式」里选「始终用 Code」后，文件图标会切到 Code 角标样式。
 */
export const VSCODE_OPTIONAL_OPEN_EXTENSIONS = ['txt', 'html', 'htm', 'xhtml'] as const
