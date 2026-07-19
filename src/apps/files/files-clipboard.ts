import type { FilesNodeKind } from './files-types.ts'

export type FilesClipboardEntry = {
  nodeId: string
  name: string
  kind: FilesNodeKind
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
