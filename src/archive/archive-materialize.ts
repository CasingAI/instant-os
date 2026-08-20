import {
  filesMkdir,
  filesStat,
  filesUpsertBatch,
  type FilesUpsertBatchItem,
} from '../apps/files/files-api.ts'
import { joinFilesAbsolutePath } from '../apps/files/files-path.ts'
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

function toUpsertItem(absolutePath: string, bytes: Uint8Array): FilesUpsertBatchItem {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return { path: absolutePath, bytes: copy.buffer }
}

/** 解压前先建好顶层文件夹并触发 VFS 通知，让文件管理器立刻能看见目标。 */
async function ensureTopLevelFolders(
  destRoot: string,
  entries: readonly ArchiveMaterializeEntry[],
): Promise<void> {
  const folderNames = new Set<string>()
  for (const entry of entries) {
    const parts = entry.relativePath.split('/').filter(Boolean)
    if (parts.length >= 2) folderNames.add(parts[0]!)
  }
  for (const name of [...folderNames].sort()) {
    const folderPath = joinFilesAbsolutePath(destRoot, name)
    const existing = await filesStat(folderPath)
    if (existing?.kind === 'folder') continue
    if (existing) continue
    await filesMkdir(folderPath)
  }
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
  await ensureTopLevelFolders(destRoot, entries)

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
      onProgress?.({
        done,
        total,
        bytesWritten,
        currentPath: row.relativePath,
      })
    }
  }

  return { fileCount: done, bytesWritten }
}
