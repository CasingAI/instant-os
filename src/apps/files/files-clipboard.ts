import type { FilesNodeKind } from './files-types.ts'

export type FilesClipboardEntryItem = {
  nodeId: string
  name: string
  kind: FilesNodeKind
}

export type FilesClipboardMode = 'copy' | 'cut'

/** 来自虚拟机剪贴板的文件引用（XP 里复制后由 VM 应用写入；粘贴时流式拉取）。 */
export type VmClipboardFile = {
  /** 展示名（XP 路径末段）。 */
  name: string
  /** XP 绝对路径（拉取时回传给桥）。 */
  path: string
  size: number
}

/**
 * 剪贴板内容：
 * - nodes：文件APP内部复制/剪切（nodeId 引用，粘贴走节点拷贝）
 * - vm-files：虚拟机待导入文件（路径引用，粘贴走信箱流式拉取）
 */
export type FilesClipboardEntry =
  | { kind: 'nodes'; entries: FilesClipboardEntryItem[]; mode: FilesClipboardMode }
  | { kind: 'vm-files'; files: VmClipboardFile[] }

let clipboard: FilesClipboardEntry | undefined

type FilesClipboardListener = () => void

const listeners = new Set<FilesClipboardListener>()

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

/** VM 应用等外部写入者更新剪贴板后，文件APP靠订阅刷新「粘贴」可用态。 */
export function subscribeFilesClipboard(listener: FilesClipboardListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setFilesClipboard(entry: FilesClipboardEntry): void {
  clipboard = entry
  notify()
}

export function getFilesClipboard(): FilesClipboardEntry | undefined {
  return clipboard
}

export function clearFilesClipboard(): void {
  clipboard = undefined
  notify()
}
