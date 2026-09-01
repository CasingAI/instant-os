import { filesReadBlobRange, filesStat } from '../files/files-api.ts'
import {
  diskImageOccupiedByVmError,
  genericDiskImageOccupiedError,
  getDiskImageOccupant,
  normalizeDiskImagePath,
} from '../files/files-disk-image-occupancy.ts'
import type { DiskPartitionInfo } from './disk-utility-data.ts'

const SECTOR = 512
const MAX_EXAMPLES = 12
const MAX_DIRECTORY_ENTRIES = 100_000
const MAX_DIRECTORY_DEPTH = 128

export type DiskScanStatus = 'clean' | 'issues' | 'unsupported' | 'failed'

export type DiskScanIssueSeverity = 'info' | 'warning' | 'error'

export type DiskScanIssue = {
  code: string
  severity: DiskScanIssueSeverity
  message: string
  count?: number
  clusterCount?: number
  byteCount?: number
  examples?: string[]
}

export type DiskScanReport = {
  path: string
  target: string
  status: DiskScanStatus
  fsType?: 'FAT12' | 'FAT16' | 'FAT32' | 'exFAT'
  partition?: DiskPartitionInfo
  totalBytes: number
  volumeBytes?: number
  bytesPerSector?: number
  sectorsPerCluster?: number
  reservedSectors?: number
  fatCount?: number
  fatSizeSectors?: number
  rootEntries?: number
  totalSectors?: number
  rootDirSectors?: number
  dataStartSector?: number
  dataSectors?: number
  rootCluster?: number
  clusterBytes?: number
  totalClusters?: number
  allocatedClusters?: number
  freeClusters?: number
  reachableClusters?: number
  orphanClusters?: number
  orphanBytes?: number
  fileCount?: number
  directoryCount?: number
  issues: DiskScanIssue[]
  durationMs: number
}

export type DiskScanItemId =
  | 'read-boot'
  | 'check-geometry'
  | 'check-fat'
  | 'walk-directory'
  | 'check-clusters'
  | 'summarize'

export type DiskScanItemState =
  | { status: 'pending' }
  | { status: 'running'; note: string }
  | { status: 'done'; value: string }
  | { status: 'failed'; message: string }

export type DiskScanOptions = {
  path: string
  partition?: DiskPartitionInfo
  signal?: AbortSignal
  onItemUpdate?: (id: DiskScanItemId, state: DiskScanItemState) => void
  /** 修复用：扫描完成时交出簇级结构化数据，普通扫描不传则零开销 */
  collect?: (collection: FatScanCollection) => void
}

export type FatEntryRecord = {
  path: string
  directory: boolean
  firstCluster: number
  size: number
  chain: number[]
  /** 目录项 32 字节的镜像绝对偏移；FAT32 根目录链等无目录项的记录缺省 */
  entryOffset?: number
}

export type FatScanCollection = {
  geometry: FatGeometry
  /** FAT 第 1 份副本的完整字节 */
  fat: Uint8Array
  allocated: number[]
  orphan: number[]
  reachable: Set<number>
  references: Map<number, string[]>
  entries: FatEntryRecord[]
}

export type FatGeometry = {
  variant: 'FAT12' | 'FAT16' | 'FAT32'
  base: number
  volumeBytes: number
  bytesPerSector: number
  sectorsPerCluster: number
  reservedSectors: number
  fatCount: number
  fatSizeSectors: number
  rootEntries: number
  totalSectors: number
  rootDirSectors: number
  dataStartSector: number
  dataSectors: number
  totalClusters: number
  clusterBytes: number
  fatBytes: number
  rootCluster: number
}

type FatIssue = DiskScanIssue

type ScanContext = {
  geometry: FatGeometry
  read: (offset: number, length: number) => Promise<Uint8Array>
  signal?: AbortSignal
  issues: FatIssue[]
  reachable: Set<number>
  references: Map<number, string[]>
  entries: FatEntryRecord[]
  entriesSeen: number
  files: number
  directories: number
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('aborted')
}

function u16(data: Uint8Array, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8)
}

function u32(data: Uint8Array, offset: number): number {
  return (
    data[offset]! |
    (data[offset + 1]! << 8) |
    (data[offset + 2]! << 16) |
    ((data[offset + 3]! << 24) >>> 0)
  )
}

function addIssue(
  issues: FatIssue[],
  code: string,
  severity: DiskScanIssueSeverity,
  message: string,
  extra?: Partial<Pick<DiskScanIssue, 'count' | 'clusterCount' | 'byteCount' | 'examples'>>,
): void {
  const existing = issues.find((issue) => issue.code === code)
  if (existing) {
    existing.count = (existing.count ?? 1) + (extra?.count ?? 1)
    if (extra?.clusterCount !== undefined) existing.clusterCount = (existing.clusterCount ?? 0) + extra.clusterCount
    if (extra?.byteCount !== undefined) existing.byteCount = (existing.byteCount ?? 0) + extra.byteCount
    if (extra?.examples) {
      existing.examples = [...new Set([...(existing.examples ?? []), ...extra.examples])].slice(0, MAX_EXAMPLES)
    }
    return
  }
  issues.push({ code, severity, message, ...extra })
}

function formatRanges(values: number[], limit = MAX_EXAMPLES): string[] {
  if (values.length === 0) return []
  const sorted = [...values].sort((a, b) => a - b)
  const result: string[] = []
  let start = sorted[0]!
  let previous = start
  for (let i = 1; i <= sorted.length; i += 1) {
    const current = sorted[i]
    if (current === previous + 1) {
      previous = current
      continue
    }
    result.push(start === previous ? String(start) : `${start}-${previous}`)
    if (result.length >= limit) break
    if (current === undefined) break
    start = current
    previous = current
  }
  return result
}

function isFatBootSector(boot: Uint8Array): boolean {
  if (boot.byteLength < SECTOR) return false
  const bytesPerSector = u16(boot, 11)
  if (![512, 1024, 2048, 4096].includes(bytesPerSector) || boot.byteLength < bytesPerSector) return false
  const signatureOffset = bytesPerSector - 2
  if (boot[signatureOffset] !== 0x55 || boot[signatureOffset + 1] !== 0xaa) return false
  const sectorsPerCluster = boot[13] ?? 0
  const reserved = u16(boot, 14)
  const fats = boot[16] ?? 0
  const total16 = u16(boot, 19)
  const total32 = u32(boot, 32)
  const fat16 = u16(boot, 22)
  const fat32 = u32(boot, 36)
  return (
    sectorsPerCluster > 0 &&
    (sectorsPerCluster & (sectorsPerCluster - 1)) === 0 &&
    sectorsPerCluster <= 128 &&
    reserved > 0 &&
    fats > 0 &&
    fats <= 8 &&
    (total16 > 0 || total32 > 0) &&
    (fat16 > 0 || fat32 > 0)
  )
}

function parseGeometry(boot: Uint8Array, base: number, volumeBytes: number): FatGeometry {
  if (!isFatBootSector(boot)) throw new Error('无法识别 FAT 引导区')
  const bytesPerSector = u16(boot, 11)
  const sectorsPerCluster = boot[13]!
  const reservedSectors = u16(boot, 14)
  const fatCount = boot[16]!
  const rootEntries = u16(boot, 17)
  const totalSectors = u16(boot, 19) || u32(boot, 32)
  const fatSizeSectors = u16(boot, 22) || u32(boot, 36)
  const preliminaryRootDirSectors = Math.ceil((rootEntries * 32) / bytesPerSector)
  const preliminaryDataStartSector = reservedSectors + fatCount * fatSizeSectors + preliminaryRootDirSectors
  const preliminaryDataSectors = totalSectors - preliminaryDataStartSector
  const preliminaryTotalClusters = Math.floor(preliminaryDataSectors / sectorsPerCluster)
  const variant = preliminaryTotalClusters < 4085 ? 'FAT12' : preliminaryTotalClusters < 65525 ? 'FAT16' : 'FAT32'
  const rootDirSectors = variant === 'FAT32' ? 0 : preliminaryRootDirSectors
  const dataStartSector = reservedSectors + fatCount * fatSizeSectors + rootDirSectors
  const dataSectors = totalSectors - dataStartSector
  const totalClusters = Math.floor(dataSectors / sectorsPerCluster)
  const clusterBytes = bytesPerSector * sectorsPerCluster
  const fatBytes = fatSizeSectors * bytesPerSector
  const rootCluster = variant === 'FAT32' ? u32(boot, 44) : 0
  return {
    variant,
    base,
    volumeBytes,
    bytesPerSector,
    sectorsPerCluster,
    reservedSectors,
    fatCount,
    fatSizeSectors,
    rootEntries,
    totalSectors,
    rootDirSectors,
    dataStartSector,
    dataSectors,
    totalClusters,
    clusterBytes,
    fatBytes,
    rootCluster,
  }
}

function clusterOffset(geometry: FatGeometry, cluster: number): number {
  return geometry.base + (geometry.dataStartSector + (cluster - 2) * geometry.sectorsPerCluster) * geometry.bytesPerSector
}

export function fatEntryFromBytes(geometry: FatGeometry, fat: Uint8Array, cluster: number): number {
  if (geometry.variant === 'FAT12') {
    const offset = Math.floor(cluster * 3 / 2)
    const pair = fat[offset]! | (fat[offset + 1]! << 8)
    return cluster % 2 === 0 ? pair & 0x0fff : pair >>> 4
  }
  if (geometry.variant === 'FAT16') return u16(fat, cluster * 2)
  return u32(fat, cluster * 4) & 0x0fffffff
}

export function isEoc(geometry: FatGeometry, value: number): boolean {
  if (geometry.variant === 'FAT12') return value >= 0xff8
  if (geometry.variant === 'FAT16') return value >= 0xfff8
  return value >= 0x0ffffff8
}

export function isBad(geometry: FatGeometry, value: number): boolean {
  if (geometry.variant === 'FAT12') return value === 0x0ff7
  if (geometry.variant === 'FAT16') return value === 0xfff7
  return value === 0x0ffffff7
}

function decodeShortName(entry: Uint8Array): string {
  const decoder = new TextDecoder('latin1')
  const base = decoder.decode(entry.subarray(0, 8)).trimEnd()
  const ext = decoder.decode(entry.subarray(8, 11)).trimEnd()
  return ext ? `${base}.${ext}` : base
}

function decodeLfnPart(entry: Uint8Array): string {
  const chars: number[] = []
  for (const [start, end] of [[1, 11], [14, 26], [28, 32]] as const) {
    for (let offset = start; offset < end; offset += 2) {
      const code = u16(entry, offset)
      if (code === 0 || code === 0xffff) continue
      chars.push(code)
    }
  }
  return String.fromCharCode(...chars)
}

function shortNameChecksum(entry: Uint8Array): number {
  let checksum = 0
  for (let i = 0; i < 11; i += 1) {
    checksum = ((checksum & 1) << 7) | (checksum >>> 1)
    checksum = (checksum + entry[i]!) & 0xff
  }
  return checksum
}

async function readFatTable(context: ScanContext): Promise<Uint8Array> {
  const { geometry, read, signal } = context
  assertNotAborted(signal)
  const first = await read(geometry.base + geometry.reservedSectors * geometry.bytesPerSector, geometry.fatBytes)
  for (let copy = 1; copy < geometry.fatCount; copy += 1) {
    assertNotAborted(signal)
    const other = await read(
      geometry.base + (geometry.reservedSectors + copy * geometry.fatSizeSectors) * geometry.bytesPerSector,
      geometry.fatBytes,
    )
    let different = false
    for (let i = 0; i < first.byteLength; i += 1) {
      if (first[i] !== other[i]) {
        different = true
        break
      }
    }
    if (different) {
      addIssue(context.issues, 'fat-copies-differ', 'error', 'FAT 副本内容不一致', { count: 1, examples: [`第 ${copy + 1} 份 FAT`] })
    }
  }
  return first
}

function walkChain(
  context: ScanContext,
  fat: Uint8Array,
  firstCluster: number,
  path: string,
  expectedClusters?: number,
): number[] {
  const { geometry, issues, reachable, references } = context
  if (firstCluster === 0) {
    if (expectedClusters && expectedClusters > 0) {
      addIssue(issues, 'missing-chain', 'error', '文件有大小但没有起始簇', { count: 1, examples: [path] })
    }
    return []
  }
  const maxCluster = geometry.totalClusters + 1
  if (firstCluster < 2 || firstCluster > maxCluster) {
    addIssue(issues, 'invalid-start-cluster', 'error', '目录项起始簇超出卷范围', {
      count: 1,
      examples: [`${path} → ${firstCluster}`],
    })
    return []
  }
  const chain: number[] = []
  const seen = new Set<number>()
  let cluster = firstCluster
  while (cluster >= 2 && cluster <= maxCluster && chain.length <= geometry.totalClusters) {
    if (seen.has(cluster)) {
      addIssue(issues, 'cluster-chain-loop', 'error', '簇链形成环', { count: 1, examples: [path] })
      break
    }
    seen.add(cluster)
    chain.push(cluster)
    reachable.add(cluster)
    const refs = references.get(cluster) ?? []
    if (!refs.includes(path)) refs.push(path)
    references.set(cluster, refs)
    const next = fatEntryFromBytes(geometry, fat, cluster)
    if (isEoc(geometry, next)) break
    if (next === 0) {
      addIssue(issues, 'chain-ended-free', 'error', '簇链提前指向空闲簇', { count: 1, examples: [path] })
      break
    }
    if (isBad(geometry, next) || next === 1 || next > maxCluster) {
      addIssue(issues, 'invalid-cluster-link', 'error', '簇链包含无效链接', { count: 1, examples: [`${path} → ${next}`] })
      break
    }
    cluster = next
  }
  if (chain.length > geometry.totalClusters) {
    addIssue(issues, 'cluster-chain-too-long', 'error', '簇链超过卷簇总数', { count: 1, examples: [path] })
  }
  if (expectedClusters !== undefined && chain.length !== expectedClusters) {
    addIssue(issues, 'file-chain-size-mismatch', 'warning', '文件大小与簇链长度不一致', {
      count: 1,
      examples: [`${path}（需要 ${expectedClusters} 簇，实际 ${chain.length} 簇）`],
    })
  }
  return chain
}

async function readDirectoryBytes(context: ScanContext, chain: number[]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  for (const cluster of chain) {
    assertNotAborted(context.signal)
    chunks.push(await context.read(clusterOffset(context.geometry, cluster), context.geometry.clusterBytes))
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function scanUnreferencedChains(
  context: ScanContext,
  fat: Uint8Array,
  allocated: readonly number[],
): void {
  const { geometry, issues, reachable } = context
  const checked = new Set<number>()
  const maxCluster = geometry.totalClusters + 1
  for (const start of allocated) {
    if (reachable.has(start) || checked.has(start)) continue
    const local = new Set<number>()
    let cluster = start
    while (cluster >= 2 && cluster <= maxCluster) {
      if (reachable.has(cluster)) {
        addIssue(issues, 'orphan-chain-cross-link', 'error', '不可达簇链连接到目录可达簇', {
          count: 1,
          examples: [`簇 ${start} → ${cluster}`],
        })
        break
      }
      if (local.has(cluster)) {
        addIssue(issues, 'orphan-chain-loop', 'error', '不可达簇链形成环', {
          count: 1,
          examples: [`簇 ${cluster}`],
        })
        break
      }
      if (checked.has(cluster)) break
      local.add(cluster)
      checked.add(cluster)
      const next = fatEntryFromBytes(geometry, fat, cluster)
      if (isEoc(geometry, next)) break
      if (next === 0) {
        addIssue(issues, 'orphan-chain-ended-free', 'error', '不可达簇链提前指向空闲簇', {
          count: 1,
          examples: [`簇 ${cluster}`],
        })
        break
      }
      if (isBad(geometry, next) || next === 1 || next > maxCluster) {
        addIssue(issues, 'orphan-invalid-cluster-link', 'error', '不可达簇链包含无效链接', {
          count: 1,
          examples: [`簇 ${cluster} → ${next}`],
        })
        break
      }
      cluster = next
    }
  }
}

async function walkDirectory(
  context: ScanContext,
  fat: Uint8Array,
  path: string,
  chain: number[],
  rootDir?: { bytes: Uint8Array; offset: number },
  depth = 0,
): Promise<void> {
  if (depth > MAX_DIRECTORY_DEPTH) {
    addIssue(context.issues, 'directory-depth-limit', 'error', '目录嵌套超过扫描上限', {
      count: 1,
      examples: [path || '(根目录)'],
    })
    return
  }
  const bytes = rootDir?.bytes ?? await readDirectoryBytes(context, chain)
  let pendingLfn = ''
  let pendingLfnChecksum: number | undefined
  let pendingLfnSequence = 0
  for (let offset = 0; offset + 32 <= bytes.byteLength; offset += 32) {
    assertNotAborted(context.signal)
    if (context.entriesSeen++ >= MAX_DIRECTORY_ENTRIES) {
      addIssue(context.issues, 'directory-entry-limit', 'error', '目录项超过扫描上限', { count: 1 })
      return
    }
    const entry = bytes.subarray(offset, offset + 32)
    const first = entry[0]!
    if (first === 0x00) break
    if (first === 0xe5) {
      pendingLfn = ''
      pendingLfnChecksum = undefined
      pendingLfnSequence = 0
      continue
    }
    const attributes = entry[11]!
    if (attributes === 0x0f) {
      const sequence = entry[0]! & 0x1f
      const checksum = entry[13]
      if (sequence === 0 || (entry[0]! & 0x40) !== 0) {
        pendingLfn = decodeLfnPart(entry)
        pendingLfnSequence = sequence
        pendingLfnChecksum = checksum
      } else if (pendingLfnSequence === sequence + 1 && pendingLfnChecksum === checksum) {
        pendingLfn = decodeLfnPart(entry) + pendingLfn
        pendingLfnSequence = sequence
      } else {
        pendingLfn = ''
        pendingLfnChecksum = undefined
        pendingLfnSequence = 0
      }
      continue
    }
    if (attributes & 0x08) {
      pendingLfn = ''
      pendingLfnChecksum = undefined
      pendingLfnSequence = 0
      continue
    }
    const shortChecksum = shortNameChecksum(entry)
    const name = pendingLfn && pendingLfnChecksum === shortChecksum ? pendingLfn : decodeShortName(entry)
    pendingLfn = ''
    pendingLfnChecksum = undefined
    pendingLfnSequence = 0
    if (!name || name === '.' || name === '..') continue
    const itemPath = path ? `${path}/${name}` : name
    const directory = (attributes & 0x10) !== 0
    const firstCluster = context.geometry.variant === 'FAT32'
      ? ((u16(entry, 20) << 16) >>> 0) | u16(entry, 26)
      : u16(entry, 26)
    const size = u32(entry, 28)
    const expected = directory ? undefined : Math.ceil(size / context.geometry.clusterBytes)
    const itemChain = walkChain(context, fat, firstCluster, itemPath, expected)
    const entryOffset = rootDir
      ? rootDir.offset + offset
      : chain.length > 0
        ? clusterOffset(context.geometry, chain[Math.floor(offset / context.geometry.clusterBytes)]!) +
          (offset % context.geometry.clusterBytes)
        : undefined
    context.entries.push({
      path: itemPath,
      directory,
      firstCluster,
      size,
      chain: itemChain,
      ...(entryOffset !== undefined ? { entryOffset } : {}),
    })
    if (directory) {
      context.directories += 1
      await walkDirectory(context, fat, itemPath, itemChain, undefined, depth + 1)
    } else {
      context.files += 1
    }
  }
}

async function scanFat(options: DiskScanOptions, totalBytes: number, startedAt: number): Promise<DiskScanReport> {
  const path = normalizeDiskImagePath(options.path)
  const reportBase = { path, target: options.partition ? `分区 ${options.partition.index}` : '镜像' }
  const update = (id: DiskScanItemId, state: DiskScanItemState) => options.onItemUpdate?.(id, state)
  const read = async (offset: number, length: number): Promise<Uint8Array> => {
    assertNotAborted(options.signal)
    const blob = await filesReadBlobRange(path, offset, length)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes.byteLength !== length) throw new Error('镜像范围读取不完整')
    return bytes
  }
  const base = options.partition?.startBytes ?? 0
  const volumeBytes = options.partition?.sizeBytes ?? totalBytes - base
  update('read-boot', { status: 'running', note: '读取引导区' })
  const bootHead = await read(base, SECTOR)
  const declaredBytesPerSector = u16(bootHead, 11)
  const boot = [512, 1024, 2048, 4096].includes(declaredBytesPerSector) && declaredBytesPerSector > SECTOR
    ? await read(base, declaredBytesPerSector)
    : bootHead
  if (!isFatBootSector(boot)) {
    update('read-boot', { status: 'failed', message: '不是 FAT 引导区' })
    const exfat = new TextDecoder('latin1').decode(bootHead.subarray(3, 11)) === 'EXFAT   '
    return {
      ...reportBase,
      status: exfat ? 'unsupported' : 'failed',
      fsType: exfat ? 'exFAT' : undefined,
      totalBytes,
      volumeBytes,
      issues: [{ code: exfat ? 'exfat-unsupported' : 'invalid-boot', severity: 'error', message: exfat ? '暂不支持 exFAT 一致性扫描' : '无法识别 FAT 引导区' }],
      durationMs: Math.round(nowMs() - startedAt),
    }
  }
  update('read-boot', { status: 'done', value: '引导区可读' })
  const geometry = parseGeometry(boot, base, volumeBytes)
  const issues: FatIssue[] = []
  const context: ScanContext = {
    geometry,
    read,
    signal: options.signal,
    issues,
    reachable: new Set<number>(),
    references: new Map<number, string[]>(),
    entries: [],
    entriesSeen: 0,
    files: 0,
    directories: 0,
  }
  update('check-geometry', { status: 'running', note: '校验 FAT 参数' })
  const declaredBytes = geometry.totalSectors * geometry.bytesPerSector
  if (
    geometry.totalSectors <= geometry.dataStartSector ||
    geometry.dataSectors <= 0 ||
    declaredBytes > volumeBytes ||
    geometry.base + declaredBytes > totalBytes
  ) {
    addIssue(issues, 'geometry-out-of-range', 'error', 'BPB 声明的卷范围超出镜像或数据区无效', { count: 1 })
  }
  const fatEntriesCapacity = geometry.variant === 'FAT12'
    ? Math.floor((geometry.fatBytes * 2) / 3)
    : Math.floor(geometry.fatBytes / (geometry.variant === 'FAT16' ? 2 : 4))
  if (fatEntriesCapacity < geometry.totalClusters + 2) {
    addIssue(issues, 'fat-too-small', 'error', 'FAT 表容量不足以覆盖卷簇范围', {
      count: 1,
      examples: [`需要至少 ${geometry.totalClusters + 2} 项，实际约 ${fatEntriesCapacity} 项`],
    })
  }
  if (geometry.variant === 'FAT32' && (geometry.rootCluster < 2 || geometry.rootCluster > geometry.totalClusters + 1)) {
    addIssue(issues, 'invalid-root-cluster', 'error', 'FAT32 根目录起始簇超出卷范围', {
      count: 1,
      examples: [String(geometry.rootCluster)],
    })
  }
  if (geometry.totalClusters < 1) addIssue(issues, 'no-data-clusters', 'error', '卷没有可用数据簇', { count: 1 })
  update('check-geometry', { status: 'done', value: `${geometry.variant} · ${geometry.totalClusters.toLocaleString()} 簇` })

  update('check-fat', { status: 'running', note: '扫描 FAT 表' })
  const fat = await readFatTable(context)
  const allocated: number[] = []
  let freeClusters = 0
  for (let cluster = 2; cluster <= geometry.totalClusters + 1; cluster += 1) {
    if ((cluster & 0x3ff) === 0) assertNotAborted(options.signal)
    const value = fatEntryFromBytes(geometry, fat, cluster)
    if (value === 0) freeClusters += 1
    else allocated.push(cluster)
  }
  update('check-fat', { status: 'done', value: `${allocated.length.toLocaleString()} 已分配 · ${freeClusters.toLocaleString()} 空闲` })

  update('walk-directory', { status: 'running', note: '遍历目录树' })
  if (geometry.variant === 'FAT32') {
    const rootChain = walkChain(context, fat, geometry.rootCluster, '', undefined)
    context.entries.push({ path: '', directory: true, firstCluster: geometry.rootCluster, size: 0, chain: rootChain })
    await walkDirectory(context, fat, '', rootChain)
  } else {
    const rootOffset = base + (geometry.reservedSectors + geometry.fatCount * geometry.fatSizeSectors) * geometry.bytesPerSector
    const rootBytes = await read(rootOffset, geometry.rootDirSectors * geometry.bytesPerSector)
    await walkDirectory(context, fat, '', [], { bytes: rootBytes, offset: rootOffset })
  }
  update('walk-directory', { status: 'done', value: `${context.files.toLocaleString()} 个文件 · ${context.directories.toLocaleString()} 个目录` })

  update('check-clusters', { status: 'running', note: '检查簇引用关系' })
  for (const [cluster, refs] of context.references) {
    if (refs.length > 1) {
      addIssue(issues, 'cross-linked-cluster', 'error', '同一簇被多个目录项引用', { count: 1, examples: [`簇 ${cluster}：${refs.slice(0, 3).join('、')}`] })
    }
  }
  const orphan = allocated.filter((cluster) => !context.reachable.has(cluster))
  if (orphan.length > 0) {
    addIssue(issues, 'orphan-clusters', 'warning', 'FAT 中已分配但目录树不可达的簇', {
      count: 1,
      clusterCount: orphan.length,
      byteCount: orphan.length * geometry.clusterBytes,
      examples: formatRanges(orphan),
    })
    scanUnreferencedChains(context, fat, orphan)
  }
  update('check-clusters', { status: 'done', value: `${orphan.length.toLocaleString()} 个孤儿簇` })

  options.collect?.({
    geometry,
    fat,
    allocated,
    orphan,
    reachable: context.reachable,
    references: context.references,
    entries: context.entries,
  })

  update('summarize', { status: 'running', note: '生成扫描报告' })
  const status: DiskScanStatus = issues.some((issue) => issue.severity === 'error') || issues.length > 0 ? 'issues' : 'clean'
  const report: DiskScanReport = {
    ...reportBase,
    status,
    fsType: geometry.variant,
    partition: options.partition,
    totalBytes,
    volumeBytes,
    bytesPerSector: geometry.bytesPerSector,
    sectorsPerCluster: geometry.sectorsPerCluster,
    reservedSectors: geometry.reservedSectors,
    fatCount: geometry.fatCount,
    fatSizeSectors: geometry.fatSizeSectors,
    rootEntries: geometry.rootEntries,
    totalSectors: geometry.totalSectors,
    rootDirSectors: geometry.rootDirSectors,
    dataStartSector: geometry.dataStartSector,
    dataSectors: geometry.dataSectors,
    rootCluster: geometry.variant === 'FAT32' ? geometry.rootCluster : undefined,
    clusterBytes: geometry.clusterBytes,
    totalClusters: geometry.totalClusters,
    allocatedClusters: allocated.length,
    freeClusters,
    reachableClusters: context.reachable.size,
    orphanClusters: orphan.length,
    orphanBytes: orphan.length * geometry.clusterBytes,
    fileCount: context.files,
    directoryCount: context.directories,
    issues,
    durationMs: Math.round(nowMs() - startedAt),
  }
  update('summarize', { status: 'done', value: status === 'clean' ? '未发现问题' : `发现 ${issues.length} 项问题` })
  return report
}

function emptyItems(): Record<DiskScanItemId, DiskScanItemState> {
  return {
    'read-boot': { status: 'pending' },
    'check-geometry': { status: 'pending' },
    'check-fat': { status: 'pending' },
    'walk-directory': { status: 'pending' },
    'check-clusters': { status: 'pending' },
    summarize: { status: 'pending' },
  }
}

export function initialDiskScanItems(): Record<DiskScanItemId, DiskScanItemState> {
  return emptyItems()
}

export function diskScanResultText(report: DiskScanReport): string {
  const lines = [
    `错误扫描：${report.target}`,
    `状态：${report.status}`,
    `文件系统：${report.fsType ?? '未知'}`,
    `镜像：${report.path}`,
  ]
  if (report.bytesPerSector !== undefined) lines.push(`每扇区字节数：${report.bytesPerSector}`)
  if (report.sectorsPerCluster !== undefined) lines.push(`每簇扇区数：${report.sectorsPerCluster}`)
  if (report.reservedSectors !== undefined) lines.push(`保留扇区：${report.reservedSectors}`)
  if (report.fatCount !== undefined) lines.push(`FAT 副本数：${report.fatCount}`)
  if (report.fatSizeSectors !== undefined) lines.push(`每份 FAT 扇区数：${report.fatSizeSectors}`)
  if (report.rootEntries !== undefined) lines.push(`根目录项数：${report.rootEntries}`)
  if (report.totalSectors !== undefined) lines.push(`卷总扇区数：${report.totalSectors}`)
  if (report.rootDirSectors !== undefined) lines.push(`固定根目录扇区数：${report.rootDirSectors}`)
  if (report.dataStartSector !== undefined) lines.push(`数据区起始扇区：${report.dataStartSector}`)
  if (report.dataSectors !== undefined) lines.push(`数据区扇区数：${report.dataSectors}`)
  if (report.rootCluster !== undefined) lines.push(`根目录起始簇：${report.rootCluster}`)
  if (report.clusterBytes !== undefined) lines.push(`簇大小：${report.clusterBytes} B`)
  if (report.totalClusters !== undefined) lines.push(`簇总数：${report.totalClusters}`)
  if (report.allocatedClusters !== undefined) lines.push(`已分配簇：${report.allocatedClusters}`)
  if (report.freeClusters !== undefined) lines.push(`空闲簇：${report.freeClusters}`)
  if (report.reachableClusters !== undefined) lines.push(`目录可达簇：${report.reachableClusters}`)
  if (report.orphanClusters !== undefined) lines.push(`孤儿簇：${report.orphanClusters}（${report.orphanBytes ?? 0} B）`)
  if (report.fileCount !== undefined) lines.push(`文件/目录：${report.fileCount}/${report.directoryCount ?? 0}`)
  for (const issue of report.issues) {
    const amount = issue.clusterCount !== undefined ? `，${issue.clusterCount} 簇` : ''
    lines.push(`- [${issue.severity}] ${issue.code}${amount}：${issue.message}`)
    if (issue.examples?.length) lines.push(`  示例：${issue.examples.join('、')}`)
  }
  lines.push(`耗时：${report.durationMs} ms`)
  return lines.join('\n')
}

export async function runDiskImageScan(options: DiskScanOptions): Promise<DiskScanReport> {
  const startedAt = nowMs()
  const path = normalizeDiskImagePath(options.path)
  const occupant = getDiskImageOccupant(path)
  if (occupant && occupant.kind !== 'files-mount') {
    if (occupant.kind === 'vm') throw new Error(diskImageOccupiedByVmError(path))
    throw new Error(genericDiskImageOccupiedError(path, occupant))
  }
  const stat = await filesStat(path)
  if (!stat || stat.kind !== 'file') throw new Error('镜像文件不存在')
  try {
    return await scanFat(options, stat.byteSize, startedAt)
  } catch (error) {
    if (error instanceof Error && error.message === 'aborted') throw error
    options.onItemUpdate?.('summarize', { status: 'failed', message: error instanceof Error ? error.message : String(error) })
    return {
      path,
      target: options.partition ? `分区 ${options.partition.index}` : '镜像',
      status: 'failed',
      totalBytes: stat.byteSize,
      partition: options.partition,
      issues: [{ code: 'scan-failed', severity: 'error', message: error instanceof Error ? error.message : String(error) }],
      durationMs: Math.round(nowMs() - startedAt),
    }
  }
}

export const DISK_SCAN_ITEM_ORDER: readonly DiskScanItemId[] = [
  'read-boot',
  'check-geometry',
  'check-fat',
  'walk-directory',
  'check-clusters',
  'summarize',
]

export const DISK_SCAN_ITEM_LABELS: Record<DiskScanItemId, string> = {
  'read-boot': '读取引导区',
  'check-geometry': '检查卷参数',
  'check-fat': '扫描 FAT 表',
  'walk-directory': '遍历目录树',
  'check-clusters': '检查簇引用',
  summarize: '生成报告',
}

export function isDiskScanClean(report: DiskScanReport): boolean {
  return report.status === 'clean'
}

export function scanItemsForReport(report: DiskScanReport): Record<DiskScanItemId, DiskScanItemState> {
  const items = emptyItems()
  for (const id of DISK_SCAN_ITEM_ORDER) items[id] = { status: 'done', value: report.status === 'clean' ? '完成' : '已完成' }
  return items
}
