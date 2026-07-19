import { fileNameFromPath, monacoLanguageFromFileName } from '../../monaco/monaco-language.ts'
import type { FilesNode } from '../files/files-types.ts'

export type VscodeTab = {
  id: string
  path: string
  name: string
  text: string
  savedText: string
  writable: boolean
  language: string
  node: FilesNode
}

let tabSeq = 0

export function createVscodeTabId(): string {
  tabSeq += 1
  return `vscode-tab-${tabSeq}`
}

export function isVscodeTabDirty(tab: VscodeTab): boolean {
  return tab.text !== tab.savedText
}

export function buildVscodeTab(options: {
  path: string
  text: string
  node: FilesNode
  writable: boolean
}): VscodeTab {
  const name = options.node.name || fileNameFromPath(options.path)
  return {
    id: createVscodeTabId(),
    path: options.path,
    name,
    text: options.text,
    savedText: options.text,
    writable: options.writable,
    language: monacoLanguageFromFileName(name),
    node: options.node,
  }
}

/** Virtual Studio Code 默认打开关联的源码后缀（不含 txt / html 族） */
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
