import { recordSystemDebugHot } from '../os/system-debug-log.ts'
import { gunzipSync } from 'fflate'
import {
  materializeArchiveEntries,
  type ArchiveMaterializeProgress,
} from './archive-materialize.ts'
import { untarBytes } from './archive-untar.ts'
import { unzipBytes } from './archive-unzip.ts'

export type ArchiveExtractProgress = ArchiveMaterializeProgress

export type ArchiveExtractResult = {
  fileCount: number
  bytesWritten: number
  entries: Map<string, Uint8Array>
}

function entriesFromRecord(record: Record<string, Uint8Array>): Map<string, Uint8Array> {
  return new Map(Object.entries(record))
}

/** gunzip（失败则当裸 tar）→ untar；不落盘。 */
export function decodeGzipTar(tarball: Uint8Array): Map<string, Uint8Array> {
  // gunzipSync + untarBytes 全同步：在本线程调用时大包会长时间占用（埋点用于确认它在主线程被调到）
  const startAt = performance.now()
  let tarBytes: Uint8Array
  try {
    tarBytes = gunzipSync(tarball)
  } catch {
    tarBytes = tarball
  }
  const entries = entriesFromRecord(untarBytes(tarBytes))
  recordSystemDebugHot({
    layer: 'files',
    op: 'gzip-tar-decode-sync',
    detail: `${tarball.byteLength}B → ${entries.size} entries`,
    durationMs: performance.now() - startAt,
  })
  return entries
}

/** 解压 gzip+tar（或裸 tar）到目录。 */
export async function extractGzipTarToDirectory(params: {
  destRoot: string
  tarball: Uint8Array
  /** 若提供则跳过解码，直接用该条目表（调用方已剥根/过滤） */
  entries?: ReadonlyMap<string, Uint8Array>
  signal?: AbortSignal
  maxBatchFiles?: number
  maxBatchBytes?: number
  onProgress?: (progress: ArchiveExtractProgress) => void
}): Promise<ArchiveExtractResult> {
  const map = params.entries ? new Map(params.entries) : decodeGzipTar(params.tarball)
  const entryList = [...map.entries()].map(([relativePath, bytes]) => ({
    relativePath,
    bytes,
  }))
  const written = await materializeArchiveEntries({
    destRoot: params.destRoot,
    entries: entryList,
    signal: params.signal,
    maxBatchFiles: params.maxBatchFiles,
    maxBatchBytes: params.maxBatchBytes,
    onProgress: params.onProgress,
  })
  return { ...written, entries: map }
}

/** 解压 zip 到目录；默认自动剥公共根，传 stripRoot: false 保留归档内路径。 */
export async function extractZipToDirectory(params: {
  destRoot: string
  zip: Uint8Array
  /** 若提供则跳过解码 */
  entries?: ReadonlyMap<string, Uint8Array>
  stripRoot?: boolean
  signal?: AbortSignal
  maxBatchFiles?: number
  maxBatchBytes?: number
  onProgress?: (progress: ArchiveExtractProgress) => void
}): Promise<ArchiveExtractResult> {
  const map = params.entries
    ? new Map(params.entries)
    : unzipBytes(params.zip, { stripRoot: params.stripRoot })
  const entryList = [...map.entries()].map(([relativePath, bytes]) => ({
    relativePath,
    bytes,
  }))
  const written = await materializeArchiveEntries({
    destRoot: params.destRoot,
    entries: entryList,
    signal: params.signal,
    maxBatchFiles: params.maxBatchFiles,
    maxBatchBytes: params.maxBatchBytes,
    onProgress: params.onProgress,
  })
  return { ...written, entries: map }
}
