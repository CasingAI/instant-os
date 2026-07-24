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
  let tarBytes: Uint8Array
  try {
    tarBytes = gunzipSync(tarball)
  } catch {
    tarBytes = tarball
  }
  return entriesFromRecord(untarBytes(tarBytes))
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

/** 解压 zip 到目录（自动剥公共根）。 */
export async function extractZipToDirectory(params: {
  destRoot: string
  zip: Uint8Array
  /** 若提供则跳过解码 */
  entries?: ReadonlyMap<string, Uint8Array>
  signal?: AbortSignal
  maxBatchFiles?: number
  maxBatchBytes?: number
  onProgress?: (progress: ArchiveExtractProgress) => void
}): Promise<ArchiveExtractResult> {
  const map = params.entries ? new Map(params.entries) : unzipBytes(params.zip)
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
