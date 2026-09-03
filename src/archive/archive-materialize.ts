import {
  filesMkdir,
  filesStat,
  filesUpsertBatch,
  type FilesUpsertBatchItem,
} from '../apps/files/files-api.ts'
import { joinFilesAbsolutePath } from '../apps/files/files-path.ts'
import {
  registerFilesWriteProgress,
  removeFilesWriteProgress,
  updateFilesWriteProgress,
} from '../apps/files/files-write-progress.ts'
import { resolveNodeByAbsolutePath } from '../apps/files/files-vfs.ts'
import {
  resolveArchiveBatchLimits,
  splitByBatchBudget,
} from './archive-batch.ts'

export type ArchiveMaterializeProgress = {
  done: number
  total: number
  bytesWritten: number
  currentPath?: string
}

export type ArchiveMaterializeEntry = {
  relativePath: string
  bytes: Uint8Array
}

/** 顶层目标文件夹的圆饼登记：落盘期间图标叠饼，整批结束撤掉 */
type TopLevelFolderFill = {
  /** 顶层名（条目相对路径首段） */
  name: string
  nodeId: string
  written: number
  total: number
}

function toUpsertItem(absolutePath: string, bytes: Uint8Array): FilesUpsertBatchItem {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return { path: absolutePath, bytes: copy.buffer }
}

/**
 * 解压前先建好顶层文件夹并触发 VFS 通知，让文件管理器立刻能看见目标。
 * 同时登记写入进度（总量=该顶层子树字节）：文件夹图标上叠圆饼表示「已占位、未就绪」。
 */
async function ensureTopLevelFolders(
  destRoot: string,
  entries: readonly ArchiveMaterializeEntry[],
): Promise<TopLevelFolderFill[]> {
  const totals = new Map<string, number>()
  for (const entry of entries) {
    const parts = entry.relativePath.split('/').filter(Boolean)
    if (parts.length < 2) continue
    totals.set(parts[0]!, (totals.get(parts[0]!) ?? 0) + entry.bytes.byteLength)
  }
  const fills: TopLevelFolderFill[] = []
  for (const [name, total] of [...totals].sort()) {
    const folderPath = joinFilesAbsolutePath(destRoot, name)
    const existing = await filesStat(folderPath)
    if (!existing) await filesMkdir(folderPath)
    const node = await resolveNodeByAbsolutePath(folderPath, { follow: false })
    if (!node || total <= 0) continue
    registerFilesWriteProgress(node.id, total)
    fills.push({ name, nodeId: node.id, written: 0, total })
  }
  return fills
}

/**
 * 将已解码的归档条目批量写入目标目录（自动建父目录）。
 * 按条数 + 字节预算分批提交，避免单次 IndexedDB 事务过大。
 */
export async function materializeArchiveEntries(params: {
  destRoot: string
  entries: readonly ArchiveMaterializeEntry[]
  signal?: AbortSignal
  maxBatchFiles?: number
  maxBatchBytes?: number
  onProgress?: (progress: ArchiveMaterializeProgress) => void
}): Promise<{ fileCount: number; bytesWritten: number }> {
  const { destRoot, entries, signal, onProgress } = params
  const total = entries.length
  if (total === 0) {
    onProgress?.({ done: 0, total: 0, bytesWritten: 0 })
    return { fileCount: 0, bytesWritten: 0 }
  }

  signal?.throwIfAborted?.()
  if (signal?.aborted) throw new Error('aborted')
  const topLevelFills = await ensureTopLevelFolders(destRoot, entries)
  const fillByTopName = new Map(topLevelFills.map((fill) => [fill.name, fill]))

  try {
    const limits = resolveArchiveBatchLimits({
      maxBatchFiles: params.maxBatchFiles,
      maxBatchBytes: params.maxBatchBytes,
    })

    const prepared = entries.map((entry) => {
      const segments = entry.relativePath.split('/').filter(Boolean)
      const absolutePath =
        segments.length === 0 ? destRoot : joinFilesAbsolutePath(destRoot, ...segments)
      return {
        relativePath: entry.relativePath,
        absolutePath,
        item: toUpsertItem(absolutePath, entry.bytes),
        byteLength: entry.bytes.byteLength,
      }
    })

    const batches = splitByBatchBudget(prepared, limits, (row) => row.byteLength)

    let done = 0
    let bytesWritten = 0

    // 每批落盘后立刻通知；列表侧已有 80ms/300ms debounce。
    for (const batch of batches) {
      signal?.throwIfAborted?.()
      if (signal?.aborted) throw new Error('aborted')

      await filesUpsertBatch(
        batch.map((row) => row.item),
        {
          batchSize: limits.maxBatchFiles,
          maxBatchBytes: limits.maxBatchBytes,
        },
      )

      for (const row of batch) {
        done += 1
        bytesWritten += row.byteLength
        const topName = row.relativePath.split('/').filter(Boolean)[0]
        const fill = topName ? fillByTopName.get(topName) : undefined
        if (fill) {
          fill.written += row.byteLength
          updateFilesWriteProgress(fill.nodeId, fill.written)
        }
        onProgress?.({
          done,
          total,
          bytesWritten,
          currentPath: row.relativePath,
        })
      }
    }

    return { fileCount: done, bytesWritten }
  } finally {
    for (const fill of topLevelFills) {
      removeFilesWriteProgress(fill.nodeId)
    }
  }
}
