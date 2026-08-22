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
  type InstantDownloadHeader,
  readDownloadHeader,
  serializeDownloadHeader,
  subtractByteRanges,
} from './download-header.ts'

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
  const signal = options.signal

  const totalSize = resolveTotalSize(task.manifest)
  const { header, payloadOffset } = await loadOrCreateHeader(
    task,
    totalSize,
    readRange,
    createBinary,
    nowMs,
  )
  let currentPayloadOffset = payloadOffset

  if (totalSize !== undefined) {
    await ensureFileSize(task.targetPath, currentPayloadOffset + totalSize, writeRange, statFile)
  }

  const reportProgress = (completedBytes: number): void => {
    header.stats.bytesDownloaded = completedBytes
    header.stats.updatedAt = nowMs()
    const elapsedMs = Math.max(1, nowMs() - header.stats.startedAt)
    const progress: DownloadProgress = {
      totalBytes: header.totalSize,
      downloadedBytes: completedBytes,
      completedRanges: header.completedRanges,
      bytesPerSecond: (completedBytes * 1000) / elapsedMs,
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

  const pieces = buildWorkPieces(task.manifest, totalSize, header.completedRanges)
  if (pieces.length === 0) {
    await finalizeDownload(task.targetPath, header, currentPayloadOffset, readRange, writeBinary, statFile)
    reportProgress(sumRanges(header.completedRanges))
    return
  }

  let activeCount = 0
  let nextIndex = 0
  let hasError: Error | undefined
  let finishedCount = 0

  await new Promise<void>((resolve, reject) => {
    const tryStartNext = (): void => {
      if (hasError) return
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
            currentPayloadOffset = await persistHeader(
              header,
              currentPayloadOffset,
              task.targetPath,
              writeRange,
              readRange,
              writeBinary,
            )
            reportProgress(sumRanges(header.completedRanges))
            tryStartNext()
          })
          .catch((error: unknown) => {
            activeCount -= 1
            hasError = error instanceof Error ? error : new Error(String(error))
            tryFinish()
          })
      }
      tryFinish()
    }

    const tryFinish = (): void => {
      if (hasError) {
        reject(hasError)
        return
      }
      if (finishedCount === pieces.length) {
        resolve()
      }
    }

    tryStartNext()
  })

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
  const serialized = serializeDownloadHeader(header)
  await createBinary(task.targetPath, asArrayBuffer(serialized.buffer))
  return { header, payloadOffset: serialized.byteLength }
}

async function readExistingHeader(
  targetPath: string,
  readRange: typeof filesReadBlobRange,
): Promise<{ header: InstantDownloadHeader; payloadOffset: number } | undefined> {
  try {
    const blob = await readRange(targetPath, 0, 64 * 1024)
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
  const serialized = serializeDownloadHeader(header)
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
): Promise<DownloadEnginePiece> {
  let lastError: Error | undefined
  for (const url of piece.urls) {
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      throwIfAborted(signal)
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
        let written = 0
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
        if (signal?.aborted) throw lastError
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
  const digest = await crypto.subtle.digest(algorithm, asArrayBuffer(bytes.buffer))
  const actual = bufferToHex(digest)
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
      const size = Math.min(DEFAULT_PIECE_SIZE, range.end - offset)
      pieces.push({
        index,
        offset,
        size,
        urls: [manifest.url],
        hash: manifest.hash,
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
      result.push({
        index: piece.index,
        offset: start,
        size: end - start,
        urls: piece.urls,
        hash: piece.hash,
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
