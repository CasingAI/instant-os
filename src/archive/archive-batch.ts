import {
  FILES_BATCH_DEFAULT_MAX_BYTES,
  FILES_BATCH_DEFAULT_SIZE,
} from '../apps/files/files-storage.ts'

/** 单次归档落盘批写入内容字节上限（与条数上限同时生效） */
export const ARCHIVE_BATCH_DEFAULT_MAX_BYTES = FILES_BATCH_DEFAULT_MAX_BYTES

export type ArchiveBatchLimits = {
  maxBatchFiles: number
  maxBatchBytes: number
}

export function resolveArchiveBatchLimits(options?: {
  maxBatchFiles?: number
  maxBatchBytes?: number
}): ArchiveBatchLimits {
  return {
    maxBatchFiles: Math.max(1, options?.maxBatchFiles ?? FILES_BATCH_DEFAULT_SIZE),
    maxBatchBytes: Math.max(1, options?.maxBatchBytes ?? ARCHIVE_BATCH_DEFAULT_MAX_BYTES),
  }
}

/**
 * 按条数与字节预算切分；单条超预算时单独成批。
 * `sizeOf` 返回该条目计入预算的内容字节数。
 */
export function splitByBatchBudget<T>(
  items: readonly T[],
  limits: ArchiveBatchLimits,
  sizeOf: (item: T) => number,
): T[][] {
  if (items.length === 0) return []
  const batches: T[][] = []
  let current: T[] = []
  let currentBytes = 0

  const flush = () => {
    if (current.length === 0) return
    batches.push(current)
    current = []
    currentBytes = 0
  }

  for (const item of items) {
    const size = Math.max(0, sizeOf(item))
    const wouldExceedCount = current.length >= limits.maxBatchFiles
    const wouldExceedBytes =
      current.length > 0 && currentBytes + size > limits.maxBatchBytes
    if (wouldExceedCount || wouldExceedBytes) {
      flush()
    }
    current.push(item)
    currentBytes += size
    // 单条已达/超预算：立刻成批，避免与后续条目混装
    if (currentBytes >= limits.maxBatchBytes || current.length >= limits.maxBatchFiles) {
      flush()
    }
  }
  flush()
  return batches
}
