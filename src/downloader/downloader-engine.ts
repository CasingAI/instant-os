import { proxiedFetch } from '../os/proxy-server-api.ts'
import {
  filesCreateBinary,
  filesReadBlobRange,
  filesStat,
  filesWriteBinary,
  filesWriteBytesRange,
} from '../apps/files/files-api.ts'
import { osNowMs } from '../os/os-clock.ts'
import type {
  ByteRange,
  DownloadEngineOptions,
  DownloadEnginePiece,
  DownloadManifest,
  DownloadProgress,
  DownloadTask,
  HashInfo,
  PieceInfo,
} from './downloader-types.ts'
import {
  addCompletedRange,
  DOWNLOAD_HEADER_CAPACITY_BYTES,
  type InstantDownloadHeader,
  readDownloadHeader,
  serializeDownloadHeader,
  subtractByteRanges,
} from './download-header.ts'
import { md5Hex } from './md5.ts'

const DEFAULT_CONCURRENCY = 3
const DEFAULT_RETRY_COUNT = 3
const DEFAULT_PIECE_SIZE = 4 * 1024 * 1024
const ZERO_FILL_CHUNK_SIZE = 1024 * 1024

function asArrayBuffer(buffer: ArrayBuffer | SharedArrayBuffer): ArrayBuffer {
  if (buffer instanceof ArrayBuffer) return buffer
  return (buffer as unknown as ArrayBuffer).slice(0) as ArrayBuffer
}

export type DownloaderEngineDeps = {
  fetch?: typeof proxiedFetch
  writeFileBytesRange?: typeof filesWriteBytesRange
  readFileBlobRange?: typeof filesReadBlobRange
  createBinaryFile?: typeof filesCreateBinary
  writeBinaryFile?: typeof filesWriteBinary
  writeBinary?: typeof filesWriteBinary
  statFile?: typeof filesStat
  nowMs?: () => number
}

export class DownloadEngineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DownloadEngineError'
  }
}

export async function runDownloadTask(
  task: DownloadTask,
  options: DownloadEngineOptions = {},
  deps: DownloaderEngineDeps = {},
): Promise<void> {
  const fetcher = deps.fetch ?? proxiedFetch
  const writeRange = deps.writeFileBytesRange ?? filesWriteBytesRange
  const readRange = deps.readFileBlobRange ?? filesReadBlobRange
  const createBinary = deps.createBinaryFile ?? filesCreateBinary
  const writeBinary = deps.writeBinaryFile ?? filesWriteBinary
  const statFile = deps.statFile ?? filesStat
  const nowMs = deps.nowMs ?? osNowMs

  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)
  const retryCount = Math.max(0, options.retryCount ?? DEFAULT_RETRY_COUNT)
  const pieceSize = Math.max(1, options.pieceSize ?? DEFAULT_PIECE_SIZE)
  const signal = options.signal

  const totalSize = resolveTotalSize(task.manifest)
  const { header, payloadOffset } = await loadOrCreateHeader(
    task,
    totalSize,
    readRange,
    createBinary,
    nowMs,
  )
  // 把旧版/外部写入的非定长 header 规范化到固定容量（在分块启动前，无并发）
  let currentPayloadOffset = await persistHeader(
    header,
    payloadOffset,
    task.targetPath,
    writeRange,
    readRange,
    writeBinary,
  )

  if (totalSize !== undefined) {
    await ensureFileSize(task.targetPath, currentPayloadOffset + totalSize, writeRange, statFile)
  }

  // 速度按相邻两次进度上报的增量计算（滑动窗口），
  // 避免用「总字节 ÷ 含暂停的总耗时」导致暂停后速度越显示越低。
  let lastSampleBytes = sumRanges(header.completedRanges)
  let lastSampleTime = nowMs()
  let lastSpeed = 0

  const reportProgress = (completedBytes: number): void => {
    header.stats.bytesDownloaded = completedBytes
    header.stats.updatedAt = nowMs()
    const now = nowMs()
    const deltaMs = now - lastSampleTime
    if (deltaMs > 0) {
      lastSpeed = ((completedBytes - lastSampleBytes) * 1000) / deltaMs
      lastSampleBytes = completedBytes
      lastSampleTime = now
    }
    const progress: DownloadProgress = {
      totalBytes: header.totalSize,
      downloadedBytes: completedBytes,
      completedRanges: header.completedRanges,
      bytesPerSecond: Math.max(0, lastSpeed),
    }
    options.onProgress?.(progress)
  }

  if (totalSize === undefined) {
    await downloadUnknownSize(
      task,
      header,
      currentPayloadOffset,
      fetcher,
      writeRange,
      readRange,
      writeBinary,
      statFile,
      retryCount,
      signal,
      reportProgress,
      nowMs,
    )
    return
  }

  const pieces = buildWorkPieces(task.manifest, totalSize, header.completedRanges, pieceSize)
  if (pieces.length === 0) {
    await finalizeDownload(task.targetPath, header, currentPayloadOffset, readRange, writeBinary, statFile)
    reportProgress(sumRanges(header.completedRanges))
    return
  }

  let activeCount = 0
  let nextIndex = 0
  let hasError: Error | undefined
  let finishedCount = 0

  // 分块中止时已写入的字节是真实落盘的数据，记入 completedRanges，
  // 续传时只需补剩余区间，不必重下整个分块。
  const recordPartialRange = (start: number, end: number): void => {
    if (end <= start) return
    header.completedRanges = addCompletedRange(header.completedRanges, start, end)
    header.stats.updatedAt = nowMs()
  }

  // 多个分块并发完成时 persistHeader 必须串行：
  // header 变长会整文件重写，并发执行会让 currentPayloadOffset 与实际文件错位。
  let persistQueue: Promise<void> = Promise.resolve()
  const enqueuePersistHeader = (): Promise<void> => {
    const run = persistQueue.then(async () => {
      currentPayloadOffset = await persistHeader(
        header,
        currentPayloadOffset,
        task.targetPath,
        writeRange,
        readRange,
        writeBinary,
      )
    })
    persistQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const tryFinish = (): void => {
        if (hasError) {
          // 中止时等在途分块收尾，让它们的已写入字节先记入 completedRanges
          if (signal?.aborted && activeCount > 0) return
          reject(hasError)
          return
        }
        if (finishedCount === pieces.length) {
          resolve()
        }
      }

      const tryStartNext = (): void => {
        if (hasError) {
          tryFinish()
          return
        }
        if (signal?.aborted) {
          hasError = makeAbortError(signal)
          tryFinish()
          return
        }
        while (activeCount < concurrency && nextIndex < pieces.length) {
          const piece = pieces[nextIndex]!
          nextIndex += 1
          activeCount += 1
          runPieceWithFailover(
            piece,
            task.targetPath,
            currentPayloadOffset,
            fetcher,
            writeRange,
            readRange,
            retryCount,
            signal,
            recordPartialRange,
          )
            .then(async (completedPiece) => {
              activeCount -= 1
              finishedCount += 1
              header.completedRanges = addCompletedRange(
                header.completedRanges,
                completedPiece.offset,
                completedPiece.offset + completedPiece.size,
              )
              header.stats.updatedAt = nowMs()
              if (!hasError) {
                try {
                  await enqueuePersistHeader()
                } catch (error) {
                  hasError = error instanceof Error ? error : new Error(String(error))
                }
                reportProgress(sumRanges(header.completedRanges))
              }
              tryStartNext()
            })
            .catch((error: unknown) => {
              activeCount -= 1
              if (!hasError) {
                hasError = error instanceof Error ? error : new Error(String(error))
              }
              tryFinish()
            })
        }
        tryFinish()
      }

      tryStartNext()
    })
  } catch (error) {
    if (signal?.aborted) {
      try {
        await enqueuePersistHeader()
      } catch {
        // 中止后的进度落盘是尽力而为，失败不影响中止语义
      }
    }
    throw error
  }

  await finalizeDownload(task.targetPath, header, currentPayloadOffset, readRange, writeBinary, statFile)
  reportProgress(sumRanges(header.completedRanges))
}

async function loadOrCreateHeader(
  task: DownloadTask,
  totalSize: number | undefined,
  readRange: typeof filesReadBlobRange,
  createBinary: typeof filesCreateBinary,
  nowMs: () => number,
): Promise<{ header: InstantDownloadHeader; payloadOffset: number }> {
  const existing = await readExistingHeader(task.targetPath, readRange)
  if (existing) {
    const nextHeader = { ...existing.header }
    if (totalSize !== undefined && nextHeader.totalSize !== totalSize) {
      nextHeader.totalSize = totalSize
    }
    return { header: nextHeader, payloadOffset: existing.payloadOffset }
  }

  const header: InstantDownloadHeader = {
    magic: 'INSTANT-DL',
    version: 1,
    taskId: task.id,
    manifest: task.manifest,
    totalSize: totalSize ?? 0,
    completedRanges: [],
    stats: {
      bytesDownloaded: 0,
      startedAt: nowMs(),
      updatedAt: nowMs(),
    },
  }
  const serialized = serializeDownloadHeader(header, headerJsonCapacity())
  await createBinary(task.targetPath, asArrayBuffer(serialized.buffer))
  return { header, payloadOffset: serialized.byteLength }
}

/** header JSON 填充到的固定长度（不含 8 字节长度前缀）。 */
function headerJsonCapacity(): number {
  return DOWNLOAD_HEADER_CAPACITY_BYTES - 8
}

async function readExistingHeader(
  targetPath: string,
  readRange: typeof filesReadBlobRange,
): Promise<{ header: InstantDownloadHeader; payloadOffset: number } | undefined> {
  try {
    const blob = await readRange(targetPath, 0, DOWNLOAD_HEADER_CAPACITY_BYTES)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const parsed = readDownloadHeader(bytes)
    if (!parsed) return undefined
    return { header: parsed.header, payloadOffset: parsed.payloadOffset }
  } catch {
    return undefined
  }
}

async function persistHeader(
  header: InstantDownloadHeader,
  currentPayloadOffset: number,
  targetPath: string,
  writeRange: typeof filesWriteBytesRange,
  readRange: typeof filesReadBlobRange,
  writeBinary: typeof filesWriteBinary,
): Promise<number> {
  const serialized = serializeDownloadHeader(header, headerJsonCapacity())
  if (serialized.byteLength <= currentPayloadOffset) {
    await writeRange(targetPath, 0, serialized)
    return currentPayloadOffset
  }

  const blob = await readRange(targetPath, currentPayloadOffset, Number.MAX_SAFE_INTEGER)
  const payload = new Uint8Array(await blob.arrayBuffer())
  const combined = new Uint8Array(serialized.byteLength + payload.byteLength)
  combined.set(serialized, 0)
  combined.set(payload, serialized.byteLength)
  await writeBinary(targetPath, combined.buffer)
  return serialized.byteLength
}

async function ensureFileSize(
  targetPath: string,
  targetSize: number,
  writeRange: typeof filesWriteBytesRange,
  statFile: typeof filesStat,
): Promise<void> {
  const entry = await statFile(targetPath)
  let currentSize = entry?.byteSize ?? 0
  if (currentSize >= targetSize) return

  const zeros = new Uint8Array(ZERO_FILL_CHUNK_SIZE)
  while (currentSize < targetSize) {
    const writeLength = Math.min(ZERO_FILL_CHUNK_SIZE, targetSize - currentSize)
    await writeRange(
      targetPath,
      currentSize,
      writeLength === ZERO_FILL_CHUNK_SIZE ? zeros : zeros.subarray(0, writeLength),
    )
    currentSize += writeLength
  }
}

async function downloadUnknownSize(
  task: DownloadTask,
  header: InstantDownloadHeader,
  payloadOffset: number,
  fetcher: typeof proxiedFetch,
  writeRange: typeof filesWriteBytesRange,
  readRange: typeof filesReadBlobRange,
  writeBinary: typeof filesWriteBinary,
  statFile: typeof filesStat,
  retryCount: number,
  signal: AbortSignal | undefined,
  reportProgress: (completedBytes: number) => void,
  nowMs: () => number,
): Promise<void> {
  const manifest = task.manifest
  const url = manifest.kind === 'single' ? manifest.url : manifest.pieces[0]?.urls[0]
  if (!url) {
    throw new DownloadEngineError('没有可下载的 URL')
  }

  let lastError: Error | undefined
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    throwIfAborted(signal)
    try {
      const response = await fetcher(url, { signal })
      if (!response.ok) {
        throw new DownloadEngineError(`HTTP ${response.status}`)
      }
      let offset = 0
      for await (const chunk of readResponseChunks(response, signal)) {
        throwIfAborted(signal)
        if (chunk.byteLength === 0) continue
        await writeRange(task.targetPath, payloadOffset + offset, chunk)
        offset += chunk.byteLength
        throwIfAborted(signal)
      }
      header.totalSize = offset
      header.completedRanges = [{ start: 0, end: offset }]
      header.stats.bytesDownloaded = offset
      header.stats.updatedAt = nowMs()
      const nextPayloadOffset = await persistHeader(header, payloadOffset, task.targetPath, writeRange, readRange, writeBinary)
      await finalizeDownload(task.targetPath, header, nextPayloadOffset, readRange, writeBinary, statFile)
      reportProgress(offset)
      return
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (signal?.aborted) throw lastError
    }
  }
  throw lastError ?? new DownloadEngineError('下载失败')
}

async function runPieceWithFailover(
  piece: DownloadEnginePiece,
  targetPath: string,
  payloadOffset: number,
  fetcher: typeof proxiedFetch,
  writeRange: typeof filesWriteBytesRange,
  readRange: typeof filesReadBlobRange,
  retryCount: number,
  signal: AbortSignal | undefined,
  onPartialRange?: (start: number, end: number) => void,
): Promise<DownloadEnginePiece> {
  let lastError: Error | undefined
  for (const url of piece.urls) {
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      throwIfAborted(signal)
      let written = 0
      try {
        const response = await fetcher(url, {
          headers:
            piece.size > 0
              ? { Range: `bytes=${piece.offset}-${piece.offset + piece.size - 1}` }
              : undefined,
          signal,
        })
        if (!response.ok && response.status !== 206) {
          throw new DownloadEngineError(`HTTP ${response.status}`)
        }
        for await (const chunk of readResponseChunks(response, signal)) {
          throwIfAborted(signal)
          if (chunk.byteLength === 0) continue
          await writeRange(targetPath, payloadOffset + piece.offset + written, chunk)
          written += chunk.byteLength
        }
        if (piece.hash) {
          const pieceBytes = await readFileBytes(
            targetPath,
            payloadOffset + piece.offset,
            piece.size,
            readRange,
          )
          await verifyHash(pieceBytes, piece.hash)
        }
        return piece
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        if (signal?.aborted) {
          if (written > 0) {
            onPartialRange?.(piece.offset, piece.offset + written)
          }
          throw lastError
        }
      }
    }
  }
  throw lastError ?? new DownloadEngineError(`piece ${piece.index} 所有 URL 均下载失败`)
}

async function finalizeDownload(
  targetPath: string,
  header: InstantDownloadHeader,
  payloadOffset: number,
  readRange: typeof filesReadBlobRange,
  writeBinary: typeof filesWriteBinary,
  statFile: typeof filesStat,
): Promise<void> {
  const payloadSize = await readPayloadSize(targetPath, payloadOffset, statFile)
  if (payloadSize !== header.totalSize) {
    throw new DownloadEngineError(
      `文件大小不匹配: 期望 ${header.totalSize}, 实际 ${payloadSize}`,
    )
  }

  const manifest = header.manifest
  if (manifest.kind === 'single' && manifest.hash) {
    const bytes = await readFileBytes(targetPath, payloadOffset, payloadSize, readRange)
    await verifyHash(bytes, manifest.hash)
  } else if (manifest.kind === 'metalink') {
    for (const piece of manifest.pieces) {
      if (!piece.hash) continue
      const pieceBytes = await readFileBytes(
        targetPath,
        payloadOffset + piece.offset,
        piece.size,
        readRange,
      )
      await verifyHash(pieceBytes, piece.hash)
    }
  }

  await stripDownloadHeader(targetPath, payloadOffset, readRange, writeBinary)
}

async function stripDownloadHeader(
  targetPath: string,
  payloadOffset: number,
  readRange: typeof filesReadBlobRange,
  writeBinary: typeof filesWriteBinary,
): Promise<void> {
  const payload = await readFileBytes(targetPath, payloadOffset, Number.MAX_SAFE_INTEGER, readRange)
  await writeBinary(targetPath, asArrayBuffer(payload.buffer))
}

async function readPayloadSize(
  targetPath: string,
  payloadOffset: number,
  statFile: typeof filesStat,
): Promise<number> {
  const entry = await statFile(targetPath)
  return Math.max(0, (entry?.byteSize ?? 0) - payloadOffset)
}

async function readFileBytes(
  targetPath: string,
  offset: number,
  length: number,
  readRange: typeof filesReadBlobRange,
): Promise<Uint8Array> {
  const blob = await readRange(targetPath, offset, length)
  return new Uint8Array(await blob.arrayBuffer())
}

async function verifyHash(bytes: Uint8Array, hash: HashInfo): Promise<void> {
  const algorithm =
    hash.algorithm === 'sha-1' ? 'SHA-1' : hash.algorithm === 'md5' ? 'MD5' : 'SHA-256'
  let actual: string
  if (hash.algorithm === 'md5') {
    // Web Crypto 不支持 MD5，用内置实现
    actual = md5Hex(bytes)
  } else {
    const digest = await crypto.subtle.digest(algorithm, asArrayBuffer(bytes.buffer))
    actual = bufferToHex(digest)
  }
  const expected = hash.value.toLowerCase()
  if (actual !== expected) {
    throw new DownloadEngineError(
      `hash 校验失败: ${algorithm} 期望 ${expected} 实际 ${actual}`,
    )
  }
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function buildWorkPieces(
  manifest: DownloadManifest,
  totalSize: number,
  completedRanges: ByteRange[],
  pieceSize: number,
): DownloadEnginePiece[] {
  const missing = subtractByteRanges(totalSize, completedRanges)
  if (missing.length === 0) return []

  if (manifest.kind === 'metalink') {
    return manifest.pieces.flatMap((piece) => intersectPieceWithMissing(piece, missing))
  }

  const pieces: DownloadEnginePiece[] = []
  let index = 0
  for (const range of missing) {
    let offset = range.start
    while (offset < range.end) {
      const size = Math.min(pieceSize, range.end - offset)
      pieces.push({
        index,
        offset,
        size,
        urls: [manifest.url],
        // manifest.hash 是整个文件的哈希，只有分块覆盖全文件时才能逐块校验；
        // 其余情况由 finalizeDownload 对完整文件统一校验。
        hash:
          manifest.hash && offset === 0 && size === totalSize ? manifest.hash : undefined,
      })
      offset += size
      index += 1
    }
  }
  return pieces
}

function intersectPieceWithMissing(
  piece: PieceInfo,
  missing: ByteRange[],
): DownloadEnginePiece[] {
  const result: DownloadEnginePiece[] = []
  for (const range of missing) {
    const start = Math.max(piece.offset, range.start)
    const end = Math.min(piece.offset + piece.size, range.end)
    if (start < end) {
      // piece.hash 是整个 piece 的哈希，续传切出的子区间不能用它校验；
      // 子区间的正确性由 finalizeDownload 对完整 piece 统一校验兜底。
      const coversWholePiece = start === piece.offset && end === piece.offset + piece.size
      result.push({
        index: piece.index,
        offset: start,
        size: end - start,
        urls: piece.urls,
        hash: coversWholePiece ? piece.hash : undefined,
      })
    }
  }
  return result
}

function resolveTotalSize(manifest: DownloadManifest): number | undefined {
  if (manifest.kind === 'single') return manifest.totalSize
  return manifest.totalSize
}

async function* readResponseChunks(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const body = response.body
  if (!body) {
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.byteLength > 0) yield buffer
    return
  }
  const reader = body.getReader()
  try {
    while (true) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      if (value && value.byteLength > 0) yield value
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // ignore
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (typeof signal.throwIfAborted === 'function') {
    signal.throwIfAborted()
  }
  throw Object.assign(new Error('aborted'), { name: 'AbortError' })
}

function makeAbortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  return Object.assign(new Error('aborted'), { name: 'AbortError' })
}

function sumRanges(ranges: ByteRange[]): number {
  return ranges.reduce((sum, r) => sum + (r.end - r.start), 0)
}
