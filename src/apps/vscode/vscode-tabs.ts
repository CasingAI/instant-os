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
  return tab.language === 'markdown' || tab.language === 'jsonl'
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

export {
  VSCODE_OPEN_EXTENSIONS,
  VSCODE_OPTIONAL_OPEN_EXTENSIONS,
} from './vscode-open-extensions.ts'
