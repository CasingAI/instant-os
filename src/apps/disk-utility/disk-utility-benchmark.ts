/**
 * 磁盘工具 — 分项存储路径测速
 *
 * 在目标卷根创建临时文件，按真实存储路径逐项测试：
 * - 小文件顺序写/读（走 IndexedDB 分块 / FSA / FAT）
 * - 小文件分块局部修改（IDB chunk 拆合）
 * - 大文件顺序写/读（触发 OPFS 溢出）
 * - 大文件范围写（OPFS seek+write / FSA seek+write）
 * - 随机读取 4K
 * - 小文件溢出到大文件（spillIdbRangeWriteToOpfs）
 * - 镜像小改开销（镜像卷路径/元数据/版本号/索引/广播）
 *
 * 每项独立计时，通过 onItemUpdate 回调逐行刷新。
 */
import { osNowMs } from '../../os/os-clock.ts'
import { formatStorageSize } from '../../os/format-storage-size.ts'
import {
  filesOpenStreamWrite,
  filesReadBlob,
  filesReadBlobRange,
  filesRemove,
  filesStat,
  filesWriteBytesRange,
} from '../files/files-api.ts'

export type BenchmarkItemId =
  | 'seq-write-small'
  | 'seq-read-small'
  | 'range-write-small'
  | 'seq-write-large'
  | 'seq-read-large'
  | 'range-write-large'
  | 'random-read-4k'
  | 'spill-idb-to-opfs'
  | 'image-small-overhead'

export type BenchmarkItemState =
  | { status: 'pending' }
  | { status: 'running'; note: string }
  | { status: 'done'; value: string }
  | { status: 'failed'; message: string }

export function benchmarkResultText(items: Record<BenchmarkItemId, BenchmarkItemState>): string {
  const labelWidth = Math.max(...BENCHMARK_ITEMS.map((item) => item.label.length))
  const lines: string[] = []
  for (const item of BENCHMARK_ITEMS) {
    const state = items[item.id]
    const padded = item.label.padEnd(labelWidth, ' ')
    if (state.status === 'pending') {
      lines.push(`${padded} 待测速`)
    } else if (state.status === 'running') {
      lines.push(`${padded} ${state.note}`)
    } else if (state.status === 'done') {
      lines.push(`${padded} ${state.value}`)
    } else {
      lines.push(`${padded} 失败：${state.message}`)
    }
  }
  return lines.join('\n')
}

export type BenchmarkItemDef = {
  id: BenchmarkItemId
  label: string
  hint: string
}

export const BENCHMARK_ITEMS: BenchmarkItemDef[] = [
  {
    id: 'seq-write-small',
    label: '顺序写入 · 小文件',
    hint: '约 4 MiB 流式写入，命中 IndexedDB 分块 / FSA / FAT',
  },
  {
    id: 'seq-read-small',
    label: '顺序读取 · 小文件',
    hint: '整读上一步产物',
  },
  {
    id: 'range-write-small',
    label: '局部修改 · 小文件',
    hint: '16 次 4 KiB 随机偏移覆盖，命中 IDB chunk 拆分/合并',
  },
  {
    id: 'seq-write-large',
    label: '顺序写入 · 大文件',
    hint: '约 32 MiB 流式写入，触发 OPFS 溢出',
  },
  {
    id: 'seq-read-large',
    label: '顺序读取 · 大文件',
    hint: '整读上一步产物，命中 OPFS / FSA / FAT 读',
  },
  {
    id: 'range-write-large',
    label: '局部修改 · 大文件',
    hint: '8 次 256 KiB 随机覆盖，命中 OPFS 范围写 / FSA seek+write',
  },
  {
    id: 'random-read-4k',
    label: '随机读取 · 4K',
    hint: '64 次 4 KiB 范围读',
  },
  {
    id: 'spill-idb-to-opfs',
    label: '小文件溢出到大文件',
    hint: '4 MiB → 32 MiB 扩展，触发 spillIdbRangeWriteToOpfs 整份迁移',
  },
  {
    id: 'image-small-overhead',
    label: '镜像小改开销',
    hint: '4 MiB 文件覆盖 4 KiB，测路径/元数据/版本号/索引/广播固定开销',
  },
]

export type BenchmarkSuiteOptions = {
  /** 目标卷根路径，如 /user、/mount/xxx、/media/xxx */
  rootPath: string
  /** 中止信号 */
  signal?: AbortSignal
  /** 每项状态更新回调 */
  onItemUpdate: (id: BenchmarkItemId, state: BenchmarkItemState) => void
}

const SMALL_FILE_BYTES = 4 * 1024 * 1024
const LARGE_FILE_BYTES = 32 * 1024 * 1024
const WRITE_CHUNK_BYTES = 256 * 1024
const RANDOM_READ_4K_COUNT = 64
const RANGE_WRITE_SMALL_COUNT = 16
const RANGE_WRITE_SMALL_BYTES = 4 * 1024
const RANGE_WRITE_LARGE_COUNT = 8
const RANGE_WRITE_LARGE_BYTES = 256 * 1024
const IMAGE_OVERHEAD_WRITE_BYTES = 4 * 1024

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error('aborted')
  }
}

function fillPseudoRandom(buffer: Uint8Array): void {
  for (let i = 0; i < buffer.length; i += 1) {
    buffer[i] = (i * 7 + 0x41) & 0xff
  }
}

export function benchmarkFilePath(rootPath: string): string {
  const ts = osNowMs()
  const random = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0')
  const dir = rootPath.replace(/\/+$/, '')
  return `${dir}/.disk-benchmark-${ts}-${random}.bin`
}

function formatSpeed(bytesPerSecond: number): string {
  return `${formatStorageSize(bytesPerSecond)}/s`
}

function formatIops(iops: number): string {
  return `${Math.round(iops).toLocaleString()} IOPS`
}

function elapsedMs(startedAt: number): number {
  return Math.max(1, nowMs() - startedAt)
}

export function initialBenchmarkItems(): Record<BenchmarkItemId, BenchmarkItemState> {
  const record = {} as Record<BenchmarkItemId, BenchmarkItemState>
  for (const item of BENCHMARK_ITEMS) {
    record[item.id] = { status: 'pending' }
  }
  return record
}

export async function runDiskBenchmarkSuite(options: BenchmarkSuiteOptions): Promise<void> {
  const { rootPath, signal, onItemUpdate } = options
  const paths: string[] = []

  const setRunning = (id: BenchmarkItemId, note: string) => {
    onItemUpdate(id, { status: 'running', note })
  }

  const setDone = (id: BenchmarkItemId, value: string) => {
    onItemUpdate(id, { status: 'done', value })
  }

  const setFailed = (id: BenchmarkItemId, message: string) => {
    onItemUpdate(id, { status: 'failed', message })
  }

  const cleanup = async () => {
    for (const path of paths) {
      await filesRemove(path).catch(() => undefined)
    }
  }

  try {
    const smallPath = await runSeqWriteSmall(rootPath, signal, setRunning, setDone, setFailed)
    if (smallPath) paths.push(smallPath)

    await runSeqReadSmall(smallPath, signal, setRunning, setDone, setFailed)
    await runRangeWriteSmall(smallPath, signal, setRunning, setDone, setFailed)

    const largePath = await runSeqWriteLarge(rootPath, signal, setRunning, setDone, setFailed)
    if (largePath) paths.push(largePath)

    await runSeqReadLarge(largePath, signal, setRunning, setDone, setFailed)
    await runRangeWriteLarge(largePath, signal, setRunning, setDone, setFailed)
    await runRandomRead4k(largePath, signal, setRunning, setDone, setFailed)

    const spillPath = await runSpillIdbToOpfs(rootPath, smallPath, signal, setRunning, setDone, setFailed)
    if (spillPath) paths.push(spillPath)

    const overheadPath = await runImageSmallOverhead(rootPath, signal, setRunning, setDone, setFailed)
    if (overheadPath) paths.push(overheadPath)
  } catch (error) {
    if (error instanceof Error && error.message === 'aborted') {
      throw error
    }
  } finally {
    await cleanup()
  }
}

async function openStreamWriteWithExpected(
  path: string,
  expectedSize: number,
): Promise<{ write(chunk: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }> {
  const writer = await filesOpenStreamWrite(path, { expectedSize })
  return {
    write: async (chunk: Uint8Array) => {
      await writer.write(chunk)
    },
    close: async () => {
      await writer.close()
    },
    abort: async () => {
      await writer.abort()
    },
  }
}

async function writeChunks(
  writer: { write(chunk: Uint8Array): Promise<void> },
  totalBytes: number,
  chunkBytes: number,
  signal: AbortSignal | undefined,
  onChunk: (done: number, total: number) => void,
): Promise<void> {
  const chunkBuffer = new Uint8Array(chunkBytes)
  fillPseudoRandom(chunkBuffer)
  let remaining = totalBytes
  while (remaining > 0) {
    assertNotAborted(signal)
    const size = Math.min(chunkBytes, remaining)
    const chunk = size === chunkBytes ? chunkBuffer : chunkBuffer.subarray(0, size)
    await writer.write(chunk)
    remaining -= size
    onChunk(totalBytes - remaining, totalBytes)
  }
}

async function runSeqWriteSmall(
  rootPath: string,
  signal: AbortSignal | undefined,
  setRunning: (id: BenchmarkItemId, note: string) => void,
  setDone: (id: BenchmarkItemId, value: string) => void,
  setFailed: (id: BenchmarkItemId, message: string) => void,
): Promise<string | undefined> {
  const id: BenchmarkItemId = 'seq-write-small'
  const path = benchmarkFilePath(rootPath)
  let writer: { write(chunk: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> } | undefined
  try {
    assertNotAborted(signal)
    setRunning(id, '正在创建临时文件…')
    writer = await openStreamWriteWithExpected(path, SMALL_FILE_BYTES)
    setRunning(id, `正在写入 0 / ${formatStorageSize(SMALL_FILE_BYTES)}`)
    const startedAt = nowMs()
    await writeChunks(writer, SMALL_FILE_BYTES, WRITE_CHUNK_BYTES, signal, (done, total) => {
      setRunning(id, `正在写入 ${formatStorageSize(done)} / ${formatStorageSize(total)}`)
    })
    setRunning(id, '正在定稿…')
    await writer.close()
    const bps = (SMALL_FILE_BYTES / elapsedMs(startedAt)) * 1000
    setDone(id, formatSpeed(bps))
    return path
  } catch (error) {
    await writer?.abort().catch(() => undefined)
    setFailed(id, error instanceof Error ? error.message : String(error))
    if (error instanceof Error && error.message === 'aborted') throw error
    return undefined
  }
}

async function runSeqReadSmall(
  path: string | undefined,
  signal: AbortSignal | undefined,
  setRunning: (id: BenchmarkItemId, note: string) => void,
  setDone: (id: BenchmarkItemId, value: string) => void,
  setFailed: (id: BenchmarkItemId, message: string) => void,
): Promise<void> {
  const id: BenchmarkItemId = 'seq-read-small'
  if (!path) {
    setFailed(id, '前置测试未生成文件')
    return
  }
  try {
    assertNotAborted(signal)
    setRunning(id, '正在读取…')
    const startedAt = nowMs()
    const blob = await filesReadBlob(path)
    const bps = (blob.size / elapsedMs(startedAt)) * 1000
    setDone(id, formatSpeed(bps))
  } catch (error) {
    setFailed(id, error instanceof Error ? error.message : String(error))
    if (error instanceof Error && error.message === 'aborted') throw error
  }
}

async function runRangeWriteSmall(
  path: string | undefined,
  signal: AbortSignal | undefined,
  setRunning: (id: BenchmarkItemId, note: string) => void,
  setDone: (id: BenchmarkItemId, value: string) => void,
  setFailed: (id: BenchmarkItemId, message: string) => void,
): Promise<void> {
  const id: BenchmarkItemId = 'range-write-small'
  if (!path) {
    setFailed(id, '前置测试未生成文件')
    return
  }
  try {
    assertNotAborted(signal)
    const stat = await filesStat(path)
    if (!stat) throw new Error('临时文件丢失')
    const fileSize = stat.byteSize
    const payload = new Uint8Array(RANGE_WRITE_SMALL_BYTES)
    fillPseudoRandom(payload)
    const maxOffset = Math.max(1, fileSize - RANGE_WRITE_SMALL_BYTES)
    const startedAt = nowMs()
    let written = 0
    for (let i = 0; i < RANGE_WRITE_SMALL_COUNT; i += 1) {
      assertNotAborted(signal)
      const offset = Math.floor(Math.random() * maxOffset)
      await filesWriteBytesRange(path, offset, payload)
      written += payload.byteLength
      setRunning(id, `正在写入第 ${i + 1} / ${RANGE_WRITE_SMALL_COUNT} 块`)
    }
    const bps = (written / elapsedMs(startedAt)) * 1000
    setDone(id, formatSpeed(bps))
  } catch (error) {
    setFailed(id, error instanceof Error ? error.message : String(error))
    if (error instanceof Error && error.message === 'aborted') throw error
  }
}

async function runSeqWriteLarge(
  rootPath: string,
  signal: AbortSignal | undefined,
  setRunning: (id: BenchmarkItemId, note: string) => void,
  setDone: (id: BenchmarkItemId, value: string) => void,
  setFailed: (id: BenchmarkItemId, message: string) => void,
): Promise<string | undefined> {
  const id: BenchmarkItemId = 'seq-write-large'
  const path = benchmarkFilePath(rootPath)
  let writer: { write(chunk: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> } | undefined
  try {
    assertNotAborted(signal)
    setRunning(id, '正在创建临时文件…')
    writer = await openStreamWriteWithExpected(path, LARGE_FILE_BYTES)
    setRunning(id, `正在写入 0 / ${formatStorageSize(LARGE_FILE_BYTES)}`)
    const startedAt = nowMs()
    await writeChunks(writer, LARGE_FILE_BYTES, WRITE_CHUNK_BYTES, signal, (done, total) => {
      setRunning(id, `正在写入 ${formatStorageSize(done)} / ${formatStorageSize(total)}`)
    })
    setRunning(id, '正在定稿…')
    await writer.close()
    const bps = (LARGE_FILE_BYTES / elapsedMs(startedAt)) * 1000
    setDone(id, formatSpeed(bps))
    return path
  } catch (error) {
    await writer?.abort().catch(() => undefined)
    setFailed(id, error instanceof Error ? error.message : String(error))
    if (error instanceof Error && error.message === 'aborted') throw error
    return undefined
  }
}

async function runSeqReadLarge(
  path: string | undefined,
  signal: AbortSignal | undefined,
  setRunning: (id: BenchmarkItemId, note: string) => void,
  setDone: (id: BenchmarkItemId, value: string) => void,
  setFailed: (id: BenchmarkItemId, message: string) => void,
): Promise<void> {
  const id: BenchmarkItemId = 'seq-read-large'
  if (!path) {
    setFailed(id, '前置测试未生成文件')
    return
  }
  try {
    assertNotAborted(signal)
    setRunning(id, '正在读取…')
    const startedAt = nowMs()
    const blob = await filesReadBlob(path)
    const bps = (blob.size / elapsedMs(startedAt)) * 1000
    setDone(id, formatSpeed(bps))
  } catch (error) {
    setFailed(id, error instanceof Error ? error.message : String(error))
    if (error instanceof Error && error.message === 'aborted') throw error
  }
}

async function runRangeWriteLarge(
  path: string | undefined,
  signal: AbortSignal | undefined,
  setRunning: (id: BenchmarkItemId, note: string) => void,
  setDone: (id: BenchmarkItemId, value: string) => void,
  setFailed: (id: BenchmarkItemId, message: string) => void,
): Promise<void> {
  const id: BenchmarkItemId = 'range-write-large'
  if (!path) {
    setFailed(id, '前置测试未生成文件')
    return
  }
  try {
    assertNotAborted(signal)
    const stat = await filesStat(path)
    if (!stat) throw new Error('临时文件丢失')
    const fileSize = stat.byteSize
    const payload = new Uint8Array(RANGE_WRITE_LARGE_BYTES)
    fillPseudoRandom(payload)
    const maxOffset = Math.max(1, fileSize - RANGE_WRITE_LARGE_BYTES)
    const startedAt = nowMs()
    let written = 0
    for (let i = 0; i < RANGE_WRITE_LARGE_COUNT; i += 1) {
      assertNotAborted(signal)
      const offset = Math.floor(Math.random() * maxOffset)
      await filesWriteBytesRange(path, offset, payload)
      written += payload.byteLength
      setRunning(id, `正在写入第 ${i + 1} / ${RANGE_WRITE_LARGE_COUNT} 块`)
    }
    const bps = (written / elapsedMs(startedAt)) * 1000
    setDone(id, formatSpeed(bps))
  } catch (error) {
    setFailed(id, error instanceof Error ? error.message : String(error))
    if (error instanceof Error && error.message === 'aborted') throw error
  }
}

async function runRandomRead4k(
  path: string | undefined,
  signal: AbortSignal | undefined,
  setRunning: (id: BenchmarkItemId, note: string) => void,
  setDone: (id: BenchmarkItemId, value: string) => void,
  setFailed: (id: BenchmarkItemId, message: string) => void,
): Promise<void> {
  const id: BenchmarkItemId = 'random-read-4k'
  if (!path) {
    setFailed(id, '前置测试未生成文件')
    return
  }
  try {
    assertNotAborted(signal)
    const stat = await filesStat(path)
    if (!stat) throw new Error('临时文件丢失')
    const fileSize = stat.byteSize
    const chunkBytes = 4096
    const maxOffset = Math.max(1, fileSize - chunkBytes)
    const offsets: number[] = []
    for (let i = 0; i < RANDOM_READ_4K_COUNT; i += 1) {
      offsets.push(Math.floor(Math.random() * maxOffset))
    }
    setRunning(id, '正在随机读取…')
    const startedAt = nowMs()
    let totalBytes = 0
    for (let i = 0; i < offsets.length; i += 1) {
      assertNotAborted(signal)
      const offset = offsets[i]!
      const length = Math.min(chunkBytes, fileSize - offset)
      const blob = await filesReadBlobRange(path, offset, length)
      totalBytes += blob.size
      setRunning(id, `正在读取第 ${i + 1} / ${RANDOM_READ_4K_COUNT} 块`)
    }
    const elapsed = elapsedMs(startedAt)
    const bps = (totalBytes / elapsed) * 1000
    const iops = (RANDOM_READ_4K_COUNT / elapsed) * 1000
    setDone(id, `${formatSpeed(bps)} · ${formatIops(iops)}`)
  } catch (error) {
    setFailed(id, error instanceof Error ? error.message : String(error))
    if (error instanceof Error && error.message === 'aborted') throw error
  }
}

async function runSpillIdbToOpfs(
  rootPath: string,
  smallFilePath: string | undefined,
  signal: AbortSignal | undefined,
  setRunning: (id: BenchmarkItemId, note: string) => void,
  setDone: (id: BenchmarkItemId, value: string) => void,
  setFailed: (id: BenchmarkItemId, message: string) => void,
): Promise<string | undefined> {
  const id: BenchmarkItemId = 'spill-idb-to-opfs'
  let path = smallFilePath
  try {
    assertNotAborted(signal)

    // 如果前置小文件测试失败，在这里自己新建一个 4 MiB 文件作为起点。
    if (!path) {
      path = benchmarkFilePath(rootPath)
      const writer = await openStreamWriteWithExpected(path, SMALL_FILE_BYTES)
      try {
        await writeChunks(writer, SMALL_FILE_BYTES, WRITE_CHUNK_BYTES, signal, () => undefined)
        await writer.close()
      } catch (error) {
        await writer.abort().catch(() => undefined)
        throw error
      }
    }

    const stat = await filesStat(path)
    if (!stat) throw new Error('临时文件丢失')

    // 扩展写入使总大小达到 LARGE_FILE_BYTES，必然触发 spillIdbRangeWriteToOpfs。
    const payloadSize = LARGE_FILE_BYTES - stat.byteSize
    if (payloadSize <= 0) throw new Error('临时文件大小异常')

    const payload = new Uint8Array(WRITE_CHUNK_BYTES)
    fillPseudoRandom(payload)
    const startedAt = nowMs()
    let written = 0
    let offset = stat.byteSize
    while (written < payloadSize) {
      assertNotAborted(signal)
      const size = Math.min(WRITE_CHUNK_BYTES, payloadSize - written)
      const chunk = size === WRITE_CHUNK_BYTES ? payload : payload.subarray(0, size)
      await filesWriteBytesRange(path, offset, chunk)
      written += size
      offset += size
      setRunning(id, `正在扩展 ${formatStorageSize(stat.byteSize + written)} / ${formatStorageSize(LARGE_FILE_BYTES)}`)
    }
    const bps = (written / elapsedMs(startedAt)) * 1000
    setDone(id, formatSpeed(bps))
    return path
  } catch (error) {
    setFailed(id, error instanceof Error ? error.message : String(error))
    if (error instanceof Error && error.message === 'aborted') throw error
    return undefined
  }
}

async function runImageSmallOverhead(
  rootPath: string,
  signal: AbortSignal | undefined,
  setRunning: (id: BenchmarkItemId, note: string) => void,
  setDone: (id: BenchmarkItemId, value: string) => void,
  setFailed: (id: BenchmarkItemId, message: string) => void,
): Promise<string | undefined> {
  const id: BenchmarkItemId = 'image-small-overhead'
  const path = benchmarkFilePath(rootPath)
  let writer: { write(chunk: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> } | undefined
  try {
    assertNotAborted(signal)
    setRunning(id, '正在创建 4 MiB 临时文件…')
    writer = await openStreamWriteWithExpected(path, SMALL_FILE_BYTES)
    await writeChunks(writer, SMALL_FILE_BYTES, WRITE_CHUNK_BYTES, signal, () => undefined)
    await writer.close()
    writer = undefined

    const payload = new Uint8Array(IMAGE_OVERHEAD_WRITE_BYTES)
    fillPseudoRandom(payload)
    const maxOffset = Math.max(1, SMALL_FILE_BYTES - IMAGE_OVERHEAD_WRITE_BYTES)
    const offset = Math.floor(Math.random() * maxOffset)

    setRunning(id, `正在覆盖 ${formatStorageSize(IMAGE_OVERHEAD_WRITE_BYTES)}…`)
    const startedAt = nowMs()
    await filesWriteBytesRange(path, offset, payload)
    const elapsed = elapsedMs(startedAt)
    const bps = (IMAGE_OVERHEAD_WRITE_BYTES / elapsed) * 1000
    const latencyPerOp = elapsed // 只有 1 次覆盖，latency 约等于总耗时
    setDone(id, `${formatSpeed(bps)} · ${Math.round(latencyPerOp)} ms/次`)
    return path
  } catch (error) {
    await writer?.abort().catch(() => undefined)
    setFailed(id, error instanceof Error ? error.message : String(error))
    if (error instanceof Error && error.message === 'aborted') throw error
    return undefined
  }
}
