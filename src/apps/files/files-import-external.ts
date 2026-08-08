/**
 * 从系统外部（Finder / 资源管理器）导入文件：
 * - 拖放：`dataTransfer.files` + `webkitGetAsEntry` 遍历目录树
 * - 选择器：`<input type="file" multiple>` 的 FileList
 *
 * 剪贴板路径不可用：Chromium 对 OS 文件剪贴板（public.file-url）的
 * `navigator.clipboard.read()` 暴露 `types = []`，拿不到文件内容
 * （实测 Chromium 146 行为），故外部导入只走拖放 / 选择器。
 */

export type ExternalImportNode = {
  name: string
  kind: 'file' | 'folder'
  /** kind=file 时的内容（拖放 / 选择器均可读） */
  file?: File
  /** kind=folder 时的子节点 */
  children?: ExternalImportNode[]
}

export type ExternalImportPlanStep =
  | { op: 'mkdir'; name: string }
  | { op: 'write'; name: string; file: File; byteSize: number }

const SYSTEM_NAME_FORBIDDEN = /[/\\:\u0000-\u001f\u007f]/g
const MAX_SYSTEM_NAME_LENGTH = 255

/**
 * 净化系统文件名：替换路径非法字符与控制字符，截断超长名。
 * 与 VFS 的 normalizeFilesNodeName 不同：这里容错净化而非抛错（外部文件名不可控）。
 */
export function sanitizeSystemFileName(raw: string): string {
  let name = raw
    .trim()
    .replace(SYSTEM_NAME_FORBIDDEN, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!name || name === '.' || name === '..') name = '未命名'
  if (name.length > MAX_SYSTEM_NAME_LENGTH) {
    name = name.slice(0, MAX_SYSTEM_NAME_LENGTH).replace(/-+$/g, '') || '未命名'
  }
  return name
}

/**
 * 把导入树拍平为深度优先操作序列（文件夹先建目录，再递归子项）。
 * 纯函数，可单测。
 */
export function planExternalImport(nodes: readonly ExternalImportNode[]): ExternalImportPlanStep[] {
  const steps: ExternalImportPlanStep[] = []
  const walk = (node: ExternalImportNode): void => {
    if (node.kind === 'folder') {
      steps.push({ op: 'mkdir', name: sanitizeSystemFileName(node.name) })
      for (const child of node.children ?? []) {
        walk(child)
      }
      return
    }
    if (!node.file) return
    steps.push({
      op: 'write',
      name: sanitizeSystemFileName(node.name),
      file: node.file,
      byteSize: node.file.size,
    })
  }
  for (const node of nodes) walk(node)
  return steps
}

/** 从 DataTransfer 构建导入树（webkitGetAsEntry 支持时含目录；否则仅文件） */
export async function collectDataTransferEntries(
  dt: DataTransfer,
): Promise<ExternalImportNode[]> {
  const nodes: ExternalImportNode[] = []
  const items = [...(dt.items ?? [])]
  const anyEntry = items.some((item) => typeof item.webkitGetAsEntry === 'function')

  if (!anyEntry || items.length === 0) {
    // fallback：仅有文件（不包含目录结构）
    for (const file of dt.files) {
      nodes.push({ name: file.name, kind: 'file', file })
    }
    return nodes
  }

  const readEntry = async (entry: FileSystemEntry): Promise<ExternalImportNode | undefined> => {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry
      const file = await new Promise<File | undefined>((resolve) => {
        fileEntry.file(resolve, () => resolve(undefined))
      })
      if (!file) return undefined
      return { name: entry.name, kind: 'file', file }
    }
    if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry
      const children = await new Promise<ExternalImportNode[]>((resolve) => {
        const reader = dirEntry.createReader()
        const all: FileSystemEntry[] = []
        const readBatch = () => {
          reader.readEntries(async (batch) => {
            if (batch.length === 0) {
              const resolved = await Promise.all(all.map((child) => readEntry(child)))
              resolve(resolved.filter((node): node is ExternalImportNode => node !== undefined))
              return
            }
            all.push(...batch)
            readBatch()
          }, () => resolve([]))
        }
        readBatch()
      })
      return { name: entry.name, kind: 'folder', children }
    }
    return undefined
  }

  for (const item of items) {
    const entry = item.webkitGetAsEntry?.()
    if (!entry) continue
    const node = await readEntry(entry)
    if (node) nodes.push(node)
  }
  return nodes
}

/** 是否支持从系统文件选择器导入（input[type=file] 全浏览器可用，恒为 true 时仍走 input） */
export function canUseSystemFilePicker(): boolean {
  return typeof document !== 'undefined' && typeof HTMLInputElement !== 'undefined'
}
