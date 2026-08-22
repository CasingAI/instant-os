import type { ByteRange, DownloadManifest } from './downloader-types.ts'

export type InstantDownloadHeader = {
  magic: 'INSTANT-DL'
  version: 1
  taskId: string
  manifest: DownloadManifest
  totalSize: number
  completedRanges: ByteRange[]
  stats: {
    bytesDownloaded: number
    startedAt: number
    updatedAt: number
  }
}

export const INSTANT_DOWNLOAD_MAGIC = 'INSTANT-DL'
export const INSTANT_DOWNLOAD_VERSION = 1

const HEADER_LENGTH_BYTES = 8

/** 判断一段字节是否包含 Instant Download header。 */
export function hasDownloadHeader(bytes: Uint8Array): boolean {
  if (bytes.byteLength < HEADER_LENGTH_BYTES + INSTANT_DOWNLOAD_MAGIC.length) {
    return false
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const headerLength = Number(view.getBigUint64(0, false))
  const jsonStart = HEADER_LENGTH_BYTES
  const jsonEnd = jsonStart + headerLength
  if (jsonEnd > bytes.byteLength || headerLength === 0) return false
  const jsonBytes = bytes.subarray(jsonStart, jsonEnd)
  let jsonText: string
  try {
    jsonText = new TextDecoder().decode(jsonBytes)
  } catch {
    return false
  }
  return jsonText.includes(`"magic":"${INSTANT_DOWNLOAD_MAGIC}"`)
}

/** 序列化 header 为可写入文件开头的字节块。 */
export function serializeDownloadHeader(header: InstantDownloadHeader): Uint8Array {
  const json = JSON.stringify(header) + '\n'
  const jsonBytes = new TextEncoder().encode(json)
  const totalLength = HEADER_LENGTH_BYTES + jsonBytes.byteLength
  const result = new Uint8Array(totalLength)
  const view = new DataView(result.buffer)
  view.setBigUint64(0, BigInt(jsonBytes.byteLength), false)
  result.set(jsonBytes, HEADER_LENGTH_BYTES)
  return result
}

export type ParsedDownloadHeader = {
  header: InstantDownloadHeader
  /** 文件实际内容（payload）开始的字节偏移 */
  payloadOffset: number
}

/** 从 Uint8Array 读取 header；若无有效 header 返回 undefined。 */
export function readDownloadHeader(bytes: Uint8Array): ParsedDownloadHeader | undefined {
  if (bytes.byteLength < HEADER_LENGTH_BYTES + INSTANT_DOWNLOAD_MAGIC.length + 1) {
    return undefined
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const headerLength = Number(view.getBigUint64(0, false))
  const jsonStart = HEADER_LENGTH_BYTES
  const jsonEnd = jsonStart + headerLength
  if (jsonEnd > bytes.byteLength || headerLength === 0) return undefined
  const jsonBytes = bytes.subarray(jsonStart, jsonEnd)
  let jsonText: string
  try {
    jsonText = new TextDecoder().decode(jsonBytes)
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return undefined
  }
  if (!isDownloadHeader(parsed)) return undefined
  return {
    header: parsed,
    payloadOffset: jsonEnd,
  }
}

function isDownloadHeader(value: unknown): value is InstantDownloadHeader {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v.magic !== INSTANT_DOWNLOAD_MAGIC) return false
  if (v.version !== INSTANT_DOWNLOAD_VERSION) return false
  if (typeof v.taskId !== 'string') return false
  if (typeof v.totalSize !== 'number' || !Number.isFinite(v.totalSize)) return false
  if (!Array.isArray(v.completedRanges)) return false
  if (typeof v.stats !== 'object' || v.stats === null) return false
  const stats = v.stats as Record<string, unknown>
  if (typeof stats.bytesDownloaded !== 'number') return false
  if (typeof stats.startedAt !== 'number') return false
  if (typeof stats.updatedAt !== 'number') return false
  if (typeof v.manifest !== 'object' || v.manifest === null) return false
  return true
}

/** 合并并规范化区间列表（已假设按 start 排序）。 */
export function mergeByteRanges(ranges: ByteRange[]): ByteRange[] {
  if (ranges.length === 0) return []
  const sorted = ranges
    .filter((r) => r.start < r.end && Number.isFinite(r.start) && Number.isFinite(r.end))
    .sort((a, b) => a.start - b.start)
  const merged: ByteRange[] = []
  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (!last || range.start > last.end) {
      merged.push({ ...range })
    } else if (range.end > last.end) {
      last.end = range.end
    }
  }
  return merged
}

/** 从 [0, totalSize) 中减去已完成的 ranges，返回缺失区间。 */
export function subtractByteRanges(totalSize: number, completedRanges: ByteRange[]): ByteRange[] {
  if (totalSize <= 0) return []
  const merged = mergeByteRanges(completedRanges)
  const missing: ByteRange[] = []
  let cursor = 0
  for (const range of merged) {
    if (range.start > cursor) {
      missing.push({ start: cursor, end: Math.min(range.start, totalSize) })
    }
    cursor = Math.max(cursor, range.end)
    if (cursor >= totalSize) break
  }
  if (cursor < totalSize) {
    missing.push({ start: cursor, end: totalSize })
  }
  return missing
}

/** 把下载引擎产生的字节区间累加到 completed ranges。 */
export function addCompletedRange(
  ranges: ByteRange[],
  start: number,
  end: number,
): ByteRange[] {
  return mergeByteRanges([...ranges, { start, end }])
}
