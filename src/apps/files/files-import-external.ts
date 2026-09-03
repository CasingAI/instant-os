/**
 * 从系统外部（Finder / 资源管理器）导入文件：
 * - 拖放：`dataTransfer.files` + `webkitGetAsEntry` 遍历目录树
 * - 选择器：`<input type="file" multiple>` 的 FileList
 *
 * 剪贴板路径不可用：Chromium 对 OS 文件剪贴板（public.file-url）的
 * `navigator.clipboard.read()` 暴露 `types = []`，拿不到文件内容
 * （实测 Chromium 146 行为），故外部导入只走拖放 / 选择器。
 */

import { recordSystemDebugTimeline } from '../../os/system-debug-log.ts'
import { filesOpenStreamWrite } from './files-api.ts'
import {
  filesConflictAllowsReplace,
  type FilesConflictChoice,
  type FilesConflictInfo,
} from './files-conflict.ts'
import { filesLocationPathRoot, joinFilesAbsolutePath } from './files-path.ts'
import {
  estimateFilesOpDurationMs,
  filesWorkloadUnits,
} from './files-op-progress-policy.ts'
import {
  FilesOpCancelledError,
  runFilesOpWithProgress,
  type FilesOpProgressUiState,
} from './files-run-with-op-progress.ts'
import { assertAdditionalBytesAvailable } from './files-storage.ts'
import {
  isFilesNodeWritable,
  isMountLocationId,
  type FilesLocationId,
} from './files-types.ts'
import {
  emitNodeCreatedImmediately,
  findSiblingNode,
  getNodeOrThrow,
  mkdir,
  resolveFilesAbsolutePath,
  runWithFilesVfsChangeBatch,
  uniqueNodeName,
} from './files-vfs.ts'
import {
  registerFilesWriteProgress,
  removeFilesWriteProgress,
  updateFilesWriteProgress,
} from './files-write-progress.ts'

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

export type ExternalImportResult = {
  fileCount: number
  byteCount: number
}

/** 子树字节总量（folder 递归、file 取 File.size），给顶层目标文件夹的圆饼定标 */
function subtreeByteSize(node: ExternalImportNode): number {
  if (node.kind === 'file') return node.file?.size ?? 0
  return (node.children ?? []).reduce((sum, child) => sum + subtreeByteSize(child), 0)
}

/**
 * 把外部导入树写入 VFS 指定位置：深度优先建目录 + 流式写入，带进度。
 * 供文件 APP 与「打开文件」对话框共用；错误向上抛，由调用方提示。
 */
export async function importExternalNodes(params: {
  nodes: readonly ExternalImportNode[]
  dest: { destLocationId: FilesLocationId; destParentId: string | undefined }
  onUiChange?: (state: FilesOpProgressUiState | undefined) => void
  /** 取消信号：切片写入循环在检查点检查并抛 FilesOpCancelledError */
  signal?: AbortSignal
  /** ✕ 取消回调（通常 abort 调用方自己的 AbortController） */
  cancel?: () => void
  /**
   * 可选的重名冲突询问回调（文件 APP 拖入传弹窗决策器；不传维持静默自动改名惯例）。
   * 返回 undefined 表示用户取消整个导入。仅询问文件步骤；文件夹撞名始终自动改名。
   */
  resolveFileConflict?: (
    conflict: FilesConflictInfo,
  ) => Promise<FilesConflictChoice | undefined>
}): Promise<ExternalImportResult> {
  const { nodes, dest, onUiChange, signal, cancel } = params
  if (nodes.length === 0) return { fileCount: 0, byteCount: 0 }
  const steps = planExternalImport(nodes)
  if (steps.length === 0) return { fileCount: 0, byteCount: 0 }
  const totalBytes = steps.reduce(
    (sum, step) => sum + (step.op === 'write' ? step.byteSize : 0),
    0,
  )
  const isLocalTarget = !isMountLocationId(dest.destLocationId)
  const units = filesWorkloadUnits(steps.length, totalBytes)
  if (isLocalTarget) {
    await assertAdditionalBytesAvailable(totalBytes)
  }
  recordSystemDebugTimeline({
    layer: 'files',
    op: 'external-import-planned',
    detail: `${steps.length} steps ${totalBytes}B`,
  })
  return await runFilesOpWithProgress({
    kind: 'paste',
    totalWork: Math.max(1, totalBytes),
    estimatedTotalMs: estimateFilesOpDurationMs(units),
    onUiChange,
    signal,
    cancel,
    task: async (report, taskSignal) => {
      // 一次导入 = 一次 VFS 批量：变更合并到结束才广播，列表不逐文件抖动，
      // 镜像卷上目录重读也不必与写入操作反复排队
      return runWithFilesVfsChangeBatch(async () => {
        const aborted = () => {
          if (taskSignal?.aborted) throw new FilesOpCancelledError()
        }
        let written = 0
        let stepsDone = 0
        const stepTotal = steps.length
        // 顶层目标文件夹（当前目录下新建的那层）先出现并叠饼：created 绕过批量
        // 立即广播，饼按该子树字节定标随写入推进；子树走完（DFS 不回头）撤掉
        const topFolderTotals: number[] = []
        for (const node of nodes) {
          if (node.kind === 'folder') topFolderTotals.push(subtreeByteSize(node))
        }
        let activeFill: { id: string; written: number; total: number } | undefined
        const finalizeActiveFill = () => {
          if (!activeFill) return
          if (activeFill.total > 0) removeFilesWriteProgress(activeFill.id)
          activeFill = undefined
        }
        // 目标目录绝对路径（文件夹 id → 路径；卷根 → 卷前缀）
        let dirPath = filesLocationPathRoot(dest.destLocationId)
        if (dest.destParentId !== undefined) {
          const parentNode = await getNodeOrThrow(dest.destParentId)
          dirPath = await resolveFilesAbsolutePath(parentNode)
        }
        // plan 已按深度优先拍平；用路径栈跟踪当前目录（含实际创建出的 id 与路径，
        // mkdir 因冲突改名后以实际名为准，避免后续文件写进旧目录或再造同名结构）
        const dirStack: { path: string; id: string | undefined }[] = [
          { path: dirPath, id: dest.destParentId },
        ]
        let fileCount = 0
        try {
          for (const step of steps) {
            // activeFill 只属于 dirStack[1] 那层顶层子树；离开子树（顶层 write 或
            // 开下一个顶层 mkdir）即视为该文件夹就绪，撤掉圆饼
            const topId = dirStack.length >= 2 ? dirStack[1]!.id : undefined
            if (activeFill && activeFill.id !== topId) finalizeActiveFill()
            const current = dirStack[dirStack.length - 1]!
            if (step.op === 'mkdir') {
              aborted()
              const isTopLevel = dirStack.length === 1
              const created = await mkdir({
                locationId: dest.destLocationId,
                parentId: current.id,
                name: step.name,
              })
              const actualPath = await resolveFilesAbsolutePath(created)
              dirStack.push({ path: actualPath, id: created.id })
              if (isTopLevel) {
                const total = topFolderTotals.shift() ?? 0
                if (total > 0) registerFilesWriteProgress(created.id, total)
                activeFill = { id: created.id, written: 0, total }
                await emitNodeCreatedImmediately(created)
              }
              stepsDone += 1
              continue
            }
            // 冲突预检：提供询问回调时，撞名先问「替换 / 保留两者 / 跳过」，
            // 关闭对话框视为取消整个导入。文件夹步骤不询问（无合并语义）。
            let overwrite = false
            if (params.resolveFileConflict) {
              const existing = await findSiblingNode(dest.destLocationId, current.id, step.name)
              if (existing) {
                const conflict: FilesConflictInfo = {
                  name: step.name,
                  kind: 'file',
                  existingKind: existing.kind,
                  existingWritable: isFilesNodeWritable(existing),
                }
                const choice = await params.resolveFileConflict(conflict)
                if (!choice) throw new FilesOpCancelledError()
                if (choice === 'skip') {
                  stepsDone += 1
                  continue
                }
                // 双重校验：即使回调误答「替换」（目标不可替换/类型不符），也退回自动改名
                if (choice === 'replace' && filesConflictAllowsReplace(conflict)) overwrite = true
              }
            }
            // 内部卷：直接按计划名打开，写入事务内查重加后缀（不依赖会过期的目录缓存）；
            // 挂载卷无唯一索引与事务内取名，仍预先算不冲突名（FSA 自身保证无同名）。
            // 「替换」按原名精确打开：已存在即覆盖写，未存在则新建。
            let filePath: string
            if (overwrite || !isMountLocationId(dest.destLocationId)) {
              filePath = joinFilesAbsolutePath(current.path, step.name)
            } else {
              const name = await uniqueNodeName(dest.destLocationId, current.id, step.name)
              filePath = joinFilesAbsolutePath(current.path, name)
            }
            const writer = await filesOpenStreamWrite(
              filePath,
              overwrite
                ? { expectedSize: step.file.size }
                : isMountLocationId(dest.destLocationId)
                  ? undefined
                  : { nameMode: 'unique-suffix', expectedSize: step.file.size },
            )
            // 拖入的大 File 用 slice 按块读并立刻落库：默认要攒到 5MB 才写盘，
            // 前几兆只在内存里，下一次落库若卡住文件就一直是空的。
            const sliceSize = 1024 * 1024
            try {
              for (let offset = 0; offset < step.file.size; ) {
                aborted()
                const end = Math.min(offset + sliceSize, step.file.size)
                const buf = await step.file.slice(offset, end).arrayBuffer()
                const bytes = new Uint8Array(buf)
                await writer.write(bytes)
                written += bytes.byteLength
                if (activeFill && activeFill.total > 0) {
                  activeFill.written += bytes.byteLength
                  updateFilesWriteProgress(activeFill.id, activeFill.written)
                }
                report({
                  done: written,
                  total: Math.max(1, totalBytes),
                  items: { done: stepsDone, total: stepTotal },
                  bytes: { done: written, total: totalBytes },
                })
                offset = end
              }
              await writer.close()
              fileCount += 1
            } catch (error) {
              await writer.abort().catch(() => undefined)
              throw error
            }
            stepsDone += 1
          }
          return { fileCount, byteCount: written }
        } finally {
          finalizeActiveFill()
        }
      })
    },
  })
}
