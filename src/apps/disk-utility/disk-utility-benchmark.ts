/**
 * 磁盘工具 — 简单吞吐量测速
 *
 * 在目标卷根创建临时文件，顺序写 / 顺序读 / 随机读，完成后删除。
 * 挂载卷走浏览器 FSA，内部卷走 IndexedDB，镜像卷走其文件系统。
 */
import { osNowMs } from '../../os/os-clock.ts'
import { formatStorageSize } from '../../os/format-storage-size.ts'
import { filesOpenStreamWrite, filesReadBlob, filesReadBlobRange, filesRemove, filesStat } from '../files/files-api.ts'

export type BenchmarkPhase = 'write' | 'read' | 'random-read'

export type BenchmarkProgress = {
  phase: BenchmarkPhase
  bytesDone: number
  bytesTotal: number
}

export type BenchmarkResult = {
  writeBytesPerSecond: number
  readBytesPerSecond: number
  randomReadBytesPerSecond: number
  randomReadIops: number
  testFileSizeBytes: number
}

export type BenchmarkOptions = {
  /** 目标卷的根路径，如 /user、/mount/xxx、/media/xxx */
  rootPath: string
  /** 期望写入字节数，默认 8 MiB */
  targetBytes?: number
  /** 每次写入块大小，默认 256 KiB */
  writeChunkBytes?: number
  /** 随机读块大小，默认 64 KiB */
  randomReadChunkBytes?: number
  /** 随机读次数，默认 32 */
  randomReadCount?: number
  /** 进度回调 */
  onProgress?: (progress: BenchmarkProgress) => void
  /** 中止信号 */
  signal?: AbortSignal
}

const DEFAULT_TARGET_BYTES = 8 * 1024 * 1024
const DEFAULT_WRITE_CHUNK_BYTES = 256 * 1024
const DEFAULT_RANDOM_READ_CHUNK_BYTES = 64 * 1024
const DEFAULT_RANDOM_READ_COUNT = 32
const MIN_TARGET_BYTES = 512 * 1024

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error('aborted')
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function benchmarkFilePath(rootPath: string): string {
  const ts = osNowMs()
  const random = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0')
  const dir = rootPath.replace(/\/+$/, '')
  return `${dir}/.disk-benchmark-${ts}-${random}.bin`
}

export async function runDiskBenchmark(options: BenchmarkOptions): Promise<BenchmarkResult> {
  const {
    rootPath,
    targetBytes = DEFAULT_TARGET_BYTES,
    writeChunkBytes = DEFAULT_WRITE_CHUNK_BYTES,
    randomReadChunkBytes = DEFAULT_RANDOM_READ_CHUNK_BYTES,
    randomReadCount = DEFAULT_RANDOM_READ_COUNT,
    onProgress,
    signal,
  } = options

  const safeTargetBytes = Math.max(MIN_TARGET_BYTES, targetBytes)
  const writeChunk = writeChunkBytes
  const randomChunk = randomReadChunkBytes
  const randomCount = Math.max(1, randomReadCount)

  const testPath = benchmarkFilePath(rootPath)
  const writeBuffer = new Uint8Array(writeChunk)
  // 用简单伪随机填充，避免全 0 被存储层过度压缩导致不真实
  for (let i = 0; i < writeBuffer.length; i += 1) {
    writeBuffer[i] = (i * 7 + 0x41) & 0xff
  }

  let remainingWriteBytes = safeTargetBytes
  const writer = await filesOpenStreamWrite(testPath)
  try {
    assertNotAborted(signal)
    const writeStartedAt = nowMs()
    while (remainingWriteBytes > 0) {
      assertNotAborted(signal)
      const chunkSize = Math.min(writeChunk, remainingWriteBytes)
      const chunk = chunkSize === writeChunk ? writeBuffer : writeBuffer.subarray(0, chunkSize)
      await writer.write(chunk)
      remainingWriteBytes -= chunkSize
      onProgress?.({ phase: 'write', bytesDone: safeTargetBytes - remainingWriteBytes, bytesTotal: safeTargetBytes })
    }
    await writer.close()
    const writeElapsedMs = Math.max(1, nowMs() - writeStartedAt)

    assertNotAborted(signal)
    const stat = await filesStat(testPath)
    if (!stat) {
      throw new Error('测速临时文件丢失')
    }
    const actualFileSize = stat.byteSize

    const readStartedAt = nowMs()
    const readBlob = await filesReadBlob(testPath)
    const readBytes = readBlob.size
    const readElapsedMs = Math.max(1, nowMs() - readStartedAt)
    onProgress?.({ phase: 'read', bytesDone: readBytes, bytesTotal: readBytes })

    assertNotAborted(signal)
    const randomMaxOffset = Math.max(1, actualFileSize - randomChunk)
    const randomOffsets: number[] = []
    for (let i = 0; i < randomCount; i += 1) {
      randomOffsets.push(Math.floor(Math.random() * randomMaxOffset))
    }
    const randomReadStartedAt = nowMs()
    let randomReadBytes = 0
    for (let i = 0; i < randomOffsets.length; i += 1) {
      assertNotAborted(signal)
      const offset = randomOffsets[i]!
      const length = Math.min(randomChunk, actualFileSize - offset)
      const blob = await filesReadBlobRange(testPath, offset, length)
      randomReadBytes += blob.size
      onProgress?.({
        phase: 'random-read',
        bytesDone: i + 1,
        bytesTotal: randomOffsets.length,
      })
    }
    const randomReadElapsedMs = Math.max(1, nowMs() - randomReadStartedAt)

    return {
      writeBytesPerSecond: (safeTargetBytes / writeElapsedMs) * 1000,
      readBytesPerSecond: (readBytes / readElapsedMs) * 1000,
      randomReadBytesPerSecond: (randomReadBytes / randomReadElapsedMs) * 1000,
      randomReadIops: (randomOffsets.length / randomReadElapsedMs) * 1000,
      testFileSizeBytes: actualFileSize,
    }
  } catch (error) {
    await writer.abort().catch(() => undefined)
    throw error
  } finally {
    await filesRemove(testPath).catch(() => undefined)
  }
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatStorageSize(bytesPerSecond)}/s`
}

export function formatIops(iops: number): string {
  return `${Math.round(iops).toLocaleString()} IOPS`
}
