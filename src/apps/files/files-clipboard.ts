import type { FilesNodeKind } from './files-types.ts'

export type FilesClipboardEntryItem = {
  nodeId: string
  name: string
  kind: FilesNodeKind
}

export type FilesClipboardMode = 'copy' | 'cut'

export type FilesClipboardEntry = {
  /** 剪贴板内容（多选时可含多项） */
  entries: FilesClipboardEntryItem[]
  /** cut：粘贴成功后删除源（移动）；copy：保留源可多次粘贴 */
  mode: FilesClipboardMode
}

let clipboard: FilesClipboardEntry | undefined

export function setFilesClipboard(entry: FilesClipboardEntry): void {
  clipboard = entry
}

export function getFilesClipboard(): FilesClipboardEntry | undefined {
  return clipboard
}

export function clearFilesClipboard(): void {
  clipboard = undefined
}
