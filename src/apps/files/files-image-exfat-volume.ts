/**
 * exFAT 磁盘镜像卷：与 FatImageVolume 并行的另一条镜像驱动链路。
 *
 * 磁盘结构按微软 exFAT 规范实现（与 Linux fs/exfat、Windows 行为一致）：
 *  - 引导区共 24 扇区（主 12 + 备份 12），FAT 从第 24 扇区起；
 *  - FAT 为 32 位表项，簇号从 2 开始，0xFFFFFFF8 以上视为链尾；
 *  - 目录是 32 字节目录项的集合，文件 = File(0x85) + Stream(0xC0) + Name(0xC1)*n 连续槽位；
 *  - 分配状态由根目录里的位图文件（0x81）维护，LSB 在前，位 N 对应簇 N+2。
 *
 * 外部 npm `exfat` 包基于规范早期草案（目录项布局与正式规范不符）且读写均未实现，
 * 故本文件为纯 TS 自研实现，仅复用 FAT 卷的 SectorCache 异步到同步桥接。
 * 只覆盖普通文件/目录读写；TexFAT、ACL、命名流等扩展特性不做。
 */
import { countSystemDebugHot } from '../../os/system-debug-log.ts'
import {
  FAT_VOLUME_INLINE_FLUSH_DIRTY_BYTES,
  ImageSectorMiss,
  SectorCache,
  type FatVolumeOptions,
  type ImageDiskIo,
} from './files-image-fat-volume.ts'
import type { ImageVolume, ImageVolumeEntry } from './files-image-volume.ts'

const SECTOR = 512
const WRITE_BEHIND_IDLE_MS = 100
const WRITE_BEHIND_DIRTY_BYTES = 256 * 1024
export const EXFAT_VOLUME_INLINE_FLUSH_DIRTY_BYTES = FAT_VOLUME_INLINE_FLUSH_DIRTY_BYTES
/** 已持有队列的长任务内的让出时间片，与 FAT 卷一致 */
const EXFAT_VOLUME_HELD_YIELD_MS = 16

/* ─── exFAT 磁盘结构常量（字段偏移单位：字节）─── */

const EXFAT_FS_NAME_BYTES = [0x45, 0x58, 0x46, 0x41, 0x54, 0x20, 0x20, 0x20] // 'EXFAT   '
const BOOT_REGION_SECTORS = 24 // 主 + 备份引导区
const MAX_CLUSTER = 0x0ffffff5
const CLUSTER_FIRST = 2
const CLUSTER_EOC = 0xffffffff

const ENTRY_TYPE_FILE = 0x85
const ENTRY_TYPE_STREAM = 0xc0
const ENTRY_TYPE_NAME = 0xc1
const ENTRY_TYPE_BITMAP = 0x81
const ENTRY_TYPE_LABEL = 0x83

const ATTR_DIRECTORY = 0x0010
const ATTR_ARCHIVE = 0x0020

const SECONDARY_FLAG_ALLOCATION = 0x01
const SECONDARY_FLAG_NO_FAT_CHAIN = 0x02

const DIRENTRY_SIZE = 32
const NAME_UNITS_PER_ENTRY = 15
const MAX_NAME_CHARS = 255
/** 目录大小上限（同 Linux：8M 个目录项），再叠加不超过卷容量一半的防御上限 */
const MAX_DIRECTORY_BYTES = Math.min(8388608 * DIRENTRY_SIZE, 64 * 1024 * 1024)

const DOS_YEAR_MIN = 1980
const DOS_YEAR_MAX = 2107

/* ─── 数值读写 ─── */

function u16le(data: Uint8Array, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8)
}

function u32le(data: Uint8Array, offset: number): number {
  return (
    data[offset]! |
    (data[offset + 1]! << 8) |
    (data[offset + 2]! << 16) |
    (data[offset + 3]! << 24 >>> 0)
  )
}

function u64le(data: Uint8Array, offset: number): number {
  const lo = u32le(data, offset)
  const hi = u32le(data, offset + 4)
  return lo + hi * 0x100000000
}

function w16le(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff
  data[offset + 1] = (value >>> 8) & 0xff
}

function w32le(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff
  data[offset + 1] = (value >>> 8) & 0xff
  data[offset + 2] = (value >>> 16) & 0xff
  data[offset + 3] = (value >>> 24) & 0xff
}

function w64le(data: Uint8Array, offset: number, value: number): void {
  w32le(data, offset, value % 0x100000000)
  w32le(data, offset + 4, Math.floor(value / 0x100000000))
}

function copyBytes(source: Uint8Array): Uint8Array {
  const out = new Uint8Array(source.byteLength)
  out.set(source)
  return out
}

/* ─── 时间：DOS 日期/时间 与毫秒互转 ─── */

function dosDateTimeToMs(date: number, time: number, centis: number): number {
  const year = DOS_YEAR_MIN + (date >>> 9)
  const month = (date >>> 5) & 0x0f
  const day = date & 0x1f
  if (month < 1 || month > 12 || day < 1 || day > 31) return 0
  const ms = Date.UTC(
    year,
    month - 1,
    day,
    (time >>> 11) & 0x1f,
    (time >>> 5) & 0x3f,
    (time & 0x1f) * 2,
  )
  if (!Number.isFinite(ms)) return 0
  return ms + Math.min(199, centis & 0xff) * 10
}

function msToDos(ms: number): { date: number; time: number; centis: number } {
  const clamped = Math.min(
    Date.UTC(DOS_YEAR_MAX, 11, 31, 23, 59, 58),
    Math.max(Date.UTC(DOS_YEAR_MIN, 0, 1), Math.floor(ms)),
  )
  const d = new Date(clamped)
  const date =
    ((d.getUTCFullYear() - DOS_YEAR_MIN) << 9) |
    ((d.getUTCMonth() + 1) << 5) |
    d.getUTCDate()
  const time =
    (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2)
  return { date, time, centis: Math.floor(d.getUTCMilliseconds() / 10) }
}

/* ─── 名字与集合校验和（规范算法）─── */

function encodeNameUnits(name: string): number[] {
  const units: number[] = []
  for (let i = 0; i < name.length; i += 1) {
    units.push(name.charCodeAt(i))
  }
  return units
}

/**
 * 规范 7.4：名字哈希对大写化后的 UTF-16 码元按小端字节流逐字节循环右移叠加。
 * 注意真实实现（macOS / Linux fs/exfat 的 exfat_calc_chksum16(upname, len*2)）
 * 都按字节而非按码元累加，与规范伪代码的字面读法不同；已在真实镜像上核对。
 */
export function computeExfatNameHash(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    const upper = String.fromCharCode(name.charCodeAt(i)).toUpperCase()
    const unit = upper.length === 1 ? upper.charCodeAt(0) : name.charCodeAt(i)
    const lo = unit & 0xff
    const hi = (unit >>> 8) & 0xff
    hash = (((hash & 1) << 15) | (hash >>> 1)) + lo
    hash &= 0xffff
    hash = (((hash & 1) << 15) | (hash >>> 1)) + hi
    hash &= 0xffff
  }
  return hash
}

/** 规范 7.2：文件集合校验和，跳过首项第 2-3 字节（校验和自身） */
export function computeExfatSetChecksum(entries: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < entries.byteLength; i += 1) {
    if (i >= 2 && i <= 3) continue
    sum = (((sum & 1) << 15) | (sum >>> 1)) + entries[i]!
    sum &= 0xffff
  }
  return sum
}

/* ─── 引导区（VBR）解析 ─── */

export type ExfatSuperblock = {
  bytesPerSector: number
  sectorsPerCluster: number
  clusterSize: number
  /** FAT 区起始（卷内字节偏移） */
  fatStart: number
  /** 单份 FAT 长度（字节） */
  fatLength: number
  /** 簇堆起始（卷内字节偏移） */
  clusterHeapStart: number
  clusterCount: number
  rootCluster: number
  numberOfFats: number
  activeFat: number
  volumeLength: number
  serialNumber: number
}

/**
 * 解析并校验 exFAT 引导扇区；几何不合法（NTFS、FAT BPB、垃圾数据）返回 undefined。
 * 不校验引导区校验和：脏位图/异常关盘的镜像仍应可挂载。
 */
export function parseExfatSuperblock(boot: Uint8Array): ExfatSuperblock | undefined {
  if (boot.byteLength < SECTOR) return undefined
  if (boot[510] !== 0x55 || boot[511] !== 0xaa) return undefined
  for (let i = 0; i < EXFAT_FS_NAME_BYTES.length; i += 1) {
    if (boot[3 + i] !== EXFAT_FS_NAME_BYTES[i]) return undefined
  }
  const sectorShift = boot[108]!
  const clusterShift = boot[109]!
  if (sectorShift < 9 || sectorShift > 12) return undefined
  if (clusterShift > 25 - sectorShift) return undefined
  const numberOfFats = boot[110]!
  if (numberOfFats < 1 || numberOfFats > 2) return undefined
  const bytesPerSector = 1 << sectorShift
  const sectorsPerCluster = 1 << clusterShift
  const fatOffsetSectors = u32le(boot, 80)
  const fatLengthSectors = u32le(boot, 84)
  const heapOffsetSectors = u32le(boot, 88)
  const clusterCount = u32le(boot, 92)
  const rootCluster = u32le(boot, 96)
  // VolumeLength 单位是扇区
  const volumeLengthBytes = u64le(boot, 72) * bytesPerSector
  if (fatOffsetSectors < BOOT_REGION_SECTORS || fatLengthSectors === 0) return undefined
  if (heapOffsetSectors < fatOffsetSectors + fatLengthSectors * numberOfFats) return undefined
  if (clusterCount < 1 || clusterCount > MAX_CLUSTER) return undefined
  if (rootCluster < CLUSTER_FIRST || rootCluster >= clusterCount + CLUSTER_FIRST) return undefined
  const heapEndBytes = (heapOffsetSectors + clusterCount * sectorsPerCluster) * bytesPerSector
  if (!Number.isFinite(volumeLengthBytes) || volumeLengthBytes < heapEndBytes) return undefined
  return {
    bytesPerSector,
    sectorsPerCluster,
    clusterSize: bytesPerSector * sectorsPerCluster,
    fatStart: fatOffsetSectors * bytesPerSector,
    fatLength: fatLengthSectors * bytesPerSector,
    clusterHeapStart: heapOffsetSectors * bytesPerSector,
    clusterCount,
    rootCluster,
    numberOfFats,
    activeFat: (u16le(boot, 106) & 0x01) === 0 ? 0 : 1,
    volumeLength: volumeLengthBytes,
    serialNumber: u32le(boot, 100),
  }
}

/* ─── 目录项解析 ─── */

export type ExfatStreamRef = {
  firstCluster: number
  dataLength: number
  noFatChain: boolean
}

export type ExfatNode = ExfatStreamRef & {
  name: string
  attributes: number
  createdAt: number
  updatedAt: number
  accessedAt: number
  /** 目录项在所属目录数据里的起始槽位与总槽数 */
  slot: number
  slotCount: number
}

export type ParsedDirectory = {
  nodes: ExfatNode[]
  bitmapStream: ExfatStreamRef | undefined
  label: string | undefined
}

export function parseExfatDirectory(data: Uint8Array): ParsedDirectory {
  const nodes: ExfatNode[] = []
  let bitmapStream: ExfatStreamRef | undefined
  let label: string | undefined
  const slots = Math.floor(data.byteLength / DIRENTRY_SIZE)
  let slot = 0
  while (slot < slots) {
    const base = slot * DIRENTRY_SIZE
    const type = data[base]!
    if (type === 0x00) break // 目录结束
    if (type < 0x80) {
      slot += 1 // 已删除项
      continue
    }
    if (type === ENTRY_TYPE_BITMAP) {
      bitmapStream = {
        firstCluster: u32le(data, base + 20),
        dataLength: u64le(data, base + 24),
        noFatChain: (data[base + 1]! & SECONDARY_FLAG_NO_FAT_CHAIN) !== 0,
      }
      slot += 1
      continue
    }
    if (type === ENTRY_TYPE_LABEL) {
      const count = Math.min(11, data[base + 1]!)
      let labelUnits = ''
      for (let i = 0; i < count; i += 1) {
        labelUnits += String.fromCharCode(u16le(data, base + 2 + i * 2))
      }
      label = labelUnits
      slot += 1
      continue
    }
    if (type === ENTRY_TYPE_FILE) {
      const secondaryCount = data[base + 1]!
      const setSlots = 1 + secondaryCount
      if (secondaryCount < 1 || slot + setSlots > slots) {
        slot += 1 // 集合损坏，退一格继续扫
        continue
      }
      const streamBase = (slot + 1) * DIRENTRY_SIZE
      if (data[streamBase] !== ENTRY_TYPE_STREAM) {
        slot += setSlots
        continue
      }
      const nameCharCount = data[streamBase + 3]!
      const nameEntryCount = Math.max(1, Math.ceil(nameCharCount / NAME_UNITS_PER_ENTRY))
      if (secondaryCount !== 1 + nameEntryCount) {
        slot += setSlots
        continue
      }
      let namesValid = true
      let nameUnits = ''
      for (let i = 0; i < nameEntryCount; i += 1) {
        const nameBase = (slot + 2 + i) * DIRENTRY_SIZE
        if (data[nameBase] !== ENTRY_TYPE_NAME) {
          namesValid = false
          break
        }
        for (let u = 0; u < NAME_UNITS_PER_ENTRY && nameUnits.length < nameCharCount; u += 1) {
          nameUnits += String.fromCharCode(u16le(data, nameBase + 2 + u * 2))
        }
      }
      if (!namesValid) {
        slot += setSlots
        continue
      }
      const attributes = u16le(data, base + 4)
      const createdAt = dosDateTimeToMs(u16le(data, base + 10), u16le(data, base + 8), data[base + 20]!)
      const updatedAt = dosDateTimeToMs(u16le(data, base + 14), u16le(data, base + 12), data[base + 21]!)
      const accessedAt = dosDateTimeToMs(u16le(data, base + 18), u16le(data, base + 16), 0)
      nodes.push({
        name: nameUnits,
        attributes,
        createdAt,
        updatedAt,
        accessedAt,
        firstCluster: u32le(data, streamBase + 20),
        dataLength: u64le(data, streamBase + 24),
        noFatChain: (data[streamBase + 1]! & SECONDARY_FLAG_NO_FAT_CHAIN) !== 0,
        slot,
        slotCount: setSlots,
      })
      slot += setSlots
      continue
    }
    // 其它类型（UpCase 0x82、GUID/PADDING/ACL/vendor 等）：按 SecondaryCount 跳过整个集合
    slot += 1 + (data[base + 1]! & 0x7f)
  }
  return { nodes, bitmapStream, label }
}

type FileSetSpec = {
  name: string
  attributes: number
  firstCluster: number
  dataLength: number
  noFatChain: boolean
  createdAt: number
  updatedAt: number
  accessedAt: number
}

function exfatFileSetSlotCount(spec: FileSetSpec): number {
  return 2 + Math.max(1, Math.ceil(spec.name.length / NAME_UNITS_PER_ENTRY))
}

export function serializeExfatFileSet(spec: FileSetSpec): Uint8Array {
  const units = encodeNameUnits(spec.name)
  const nameEntryCount = Math.max(1, Math.ceil(units.length / NAME_UNITS_PER_ENTRY))
  const slotCount = exfatFileSetSlotCount(spec)
  const buf = new Uint8Array(slotCount * DIRENTRY_SIZE)

  const created = msToDos(spec.createdAt)
  const modified = msToDos(spec.updatedAt)
  const accessed = msToDos(spec.accessedAt)
  const fileBase = 0
  buf[fileBase] = ENTRY_TYPE_FILE
  buf[fileBase + 1] = 1 + nameEntryCount
  w16le(buf, fileBase + 4, spec.attributes)
  w16le(buf, fileBase + 8, created.time)
  w16le(buf, fileBase + 10, created.date)
  w16le(buf, fileBase + 12, modified.time)
  w16le(buf, fileBase + 14, modified.date)
  w16le(buf, fileBase + 16, accessed.time)
  w16le(buf, fileBase + 18, accessed.date)
  buf[fileBase + 20] = created.centis
  buf[fileBase + 21] = modified.centis
  buf[fileBase + 22] = 0 // 时区偏移无效，按本地时间解释
  buf[fileBase + 23] = 0
  buf[fileBase + 24] = 0

  const streamBase = DIRENTRY_SIZE
  buf[streamBase] = ENTRY_TYPE_STREAM
  buf[streamBase + 1] =
    SECONDARY_FLAG_ALLOCATION | (spec.noFatChain ? SECONDARY_FLAG_NO_FAT_CHAIN : 0)
  buf[streamBase + 3] = units.length
  w16le(buf, streamBase + 4, computeExfatNameHash(spec.name))
  w64le(buf, streamBase + 8, spec.dataLength)
  w32le(buf, streamBase + 20, spec.firstCluster)
  w64le(buf, streamBase + 24, spec.dataLength)

  for (let i = 0; i < nameEntryCount; i += 1) {
    const nameBase = (2 + i) * DIRENTRY_SIZE
    buf[nameBase] = ENTRY_TYPE_NAME
    buf[nameBase + 1] = 0
    for (let u = 0; u < NAME_UNITS_PER_ENTRY; u += 1) {
      const index = i * NAME_UNITS_PER_ENTRY + u
      if (index >= units.length) break
      w16le(buf, nameBase + 2 + u * 2, units[index]!)
    }
  }

  w16le(buf, fileBase + 2, computeExfatSetChecksum(buf))
  return buf
}

/** 原地改动集合字节后重算 SetChecksum（fsck 会校验，漏刷会被判为损坏目录项） */
function refreshFileSetChecksum(data: Uint8Array, slot: number): void {
  const base = slot * DIRENTRY_SIZE
  if (data[base] !== ENTRY_TYPE_FILE) {
    throw new Error('exFAT 目录项损坏：文件项缺失')
  }
  const end = (slot + 1 + data[base + 1]!) * DIRENTRY_SIZE
  w16le(data, base + 2, computeExfatSetChecksum(data.subarray(base, end)))
}

/** 目录数据里原地更新文件集合的流扩展项（槽位 = 文件项槽位） */
function patchStreamEntry(
  data: Uint8Array,
  slot: number,
  fields: { firstCluster?: number; dataLength?: number; noFatChain?: boolean },
): void {
  const base = (slot + 1) * DIRENTRY_SIZE
  if (data[base] !== ENTRY_TYPE_STREAM) {
    throw new Error('exFAT 目录项损坏：流扩展项缺失')
  }
  if (fields.noFatChain !== undefined) {
    data[base + 1] =
      SECONDARY_FLAG_ALLOCATION |
      (fields.noFatChain ? SECONDARY_FLAG_NO_FAT_CHAIN : 0)
  }
  if (fields.firstCluster !== undefined) {
    w32le(data, base + 20, fields.firstCluster)
  }
  if (fields.dataLength !== undefined) {
    w64le(data, base + 8, fields.dataLength)
    w64le(data, base + 24, fields.dataLength)
  }
  refreshFileSetChecksum(data, slot)
}

function patchFileModifiedTime(data: Uint8Array, slot: number, ms: number): void {
  const base = slot * DIRENTRY_SIZE
  if (data[base] !== ENTRY_TYPE_FILE) {
    throw new Error('exFAT 目录项损坏：文件项缺失')
  }
  const dos = msToDos(ms)
  w16le(data, base + 12, dos.time)
  w16le(data, base + 14, dos.date)
  data[base + 21] = dos.centis
  refreshFileSetChecksum(data, slot)
}

/**
 * 找到能容纳 need 个槽位的连续可用区：0x00（未用）或已删除（bit7 已清）的
 * 文件集合类槽位（规范 7.6.1：删除槽位只允许同类复用）。
 * 注意 0x85（在用）与 0x05（已删除）仅差 bit7，不能按掩码后类型匹配。
 */
function findFreeEntrySlots(data: Uint8Array, need: number): number | undefined {
  const slots = Math.floor(data.byteLength / DIRENTRY_SIZE)
  let runStart = -1
  let runLength = 0
  for (let slot = 0; slot < slots; slot += 1) {
    const type = data[slot * DIRENTRY_SIZE]!
    const usable =
      type === 0x00 ||
      type === 0x05 || // 已删除的文件项
      type === 0x40 || // 已删除的流扩展项
      type === 0x41 // 已删除的文件名项
    if (usable) {
      if (runStart < 0) runStart = slot
      runLength += 1
      if (runLength >= need) return runStart
    } else {
      runStart = -1
      runLength = 0
    }
  }
  return undefined
}

function splitPathSegments(relativePath: string): string[] {
  const segments = relativePath.split('/').filter((item) => item.length > 0)
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new Error('路径不合法：不支持 . 或 ..')
    }
    if (segment.length > MAX_NAME_CHARS) {
      throw new Error('路径不合法：名称过长')
    }
  }
  return segments
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/* ─── 卷实现 ─── */

type ExfatDirHandle = {
  /** 所属文件节点；根目录为 undefined */
  node: ExfatNode | undefined
  clusters: number[]
  noFatChain: boolean
  /** 目录完整数据，长度恒等于 clusters.length * clusterSize */
  data: Uint8Array
}

type OpenDir = {
  handle: ExfatDirHandle
  dirty: boolean
  grew: boolean
}

export class ExfatImageVolume implements ImageVolume {
  private readonly cache: SectorCache
  private readonly driver: {
    readonly capacity: number
    read: (address: number, count: number) => Uint8Array
    write: (address: number, data: Uint8Array) => void
  }
  private readonly io: ImageDiskIo
  private readonly inlineFlushDirtyBytes: number
  private readonly writeBehindDirtyBytes: number
  private baseOffset = 0
  private superblock: ExfatSuperblock | undefined
  private bitmap: Uint8Array | undefined
  private bitmapStream: ExfatStreamRef | undefined
  private bitmapDirty = false
  private allocHint = CLUSTER_FIRST
  private chain: Promise<void> = Promise.resolve()
  private flushing: Promise<void> = Promise.resolve()
  private dirty = false
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private lastHeldYieldAt = 0

  constructor(io: ImageDiskIo, options?: FatVolumeOptions) {
    this.io = io
    this.cache = new SectorCache(io.size, options?.maxResidentBytes)
    this.inlineFlushDirtyBytes = Math.max(
      1,
      options?.inlineFlushDirtyBytes ?? EXFAT_VOLUME_INLINE_FLUSH_DIRTY_BYTES,
    )
    this.writeBehindDirtyBytes = Math.max(
      1,
      options?.writeBehindDirtyBytes ?? WRITE_BEHIND_DIRTY_BYTES,
    )
    this.driver = {
      capacity: io.size,
      read: (address, count) => this.cache.read(address, count),
      write: (address, data) => this.cache.write(address, copyBytes(data)),
    }
  }

  /* ── 操作串行化与扇区桥接（与 FatImageVolume 同构）── */

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work, work)
    this.chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async withSectors<T>(fn: () => T | Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        return await fn()
      } catch (error) {
        if (error instanceof ImageSectorMiss) {
          await this.cache.fill(this.io, error.offset, error.length)
          continue
        }
        throw error
      }
    }
    throw new Error('磁盘镜像读取失败：扇区预取次数过多')
  }

  private async yieldHeld(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    this.lastHeldYieldAt = performance.now()
  }

  private async maybeYieldHeld(): Promise<void> {
    if (performance.now() - this.lastHeldYieldAt < EXFAT_VOLUME_HELD_YIELD_MS) return
    await this.yieldHeld()
  }

  private async maybeFlushHeld(): Promise<void> {
    if (this.cache.dirtyBytes() < this.inlineFlushDirtyBytes) return
    await this.flushHeld()
    await this.yieldHeld()
  }

  /* ── 回刷：位图先写回缓存，再整体落盘 ── */

  private kickFlush(): void {
    this.flushing = this.flushing.then(
      () => this.flushIfNeeded(),
      () => this.flushIfNeeded(),
    )
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.kickFlush()
    }, WRITE_BEHIND_IDLE_MS)
  }

  private markDirty(): void {
    this.dirty = true
    if (this.cache.dirtyBytes() >= this.writeBehindDirtyBytes) {
      this.kickFlush()
    } else {
      this.scheduleFlush()
    }
  }

  private noteDirtyCache(): void {
    if (this.cache.dirtyBytes() > 0 || this.bitmapDirty) this.markDirty()
  }

  private async writeBitmapIfDirty(): Promise<void> {
    if (!this.bitmapDirty || !this.bitmap || !this.bitmapStream) return
    const bitmap = this.bitmap
    const stream = this.bitmapStream
    const sb = this.requireSuperblock()
    const clusters = stream.noFatChain
      ? this.streamClusters(stream)
      : await this.walkChain(stream.firstCluster)
    await this.withSectors(() => {
      let cursor = 0
      for (const clu of clusters) {
        if (cursor >= bitmap.byteLength) break
        const piece = bitmap.subarray(cursor, Math.min(cursor + sb.clusterSize, bitmap.byteLength))
        this.driver.write(this.clusterOffset(clu), piece)
        cursor += sb.clusterSize
      }
    })
    this.bitmapDirty = false
  }

  hasUnflushedSectors(): boolean {
    return this.cache.dirtyBytes() > 0 || this.bitmapDirty
  }

  get unflushedBytes(): number {
    return this.cache.dirtyBytes()
  }

  get residentSectorCount(): number {
    return this.cache.residentSectorCount
  }

  hasResidentSector(index: number): boolean {
    return this.cache.hasSector(index)
  }

  private async flushIfNeeded(): Promise<void> {
    if (!this.dirty && this.cache.dirtyBytes() === 0 && !this.bitmapDirty) return
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    await this.flushNow()
  }

  private async flushNow(): Promise<void> {
    await this.enqueue(async () => {
      try {
        await this.writeBitmapIfDirty()
        await this.cache.flush(this.io)
        if (this.cache.dirtyBytes() === 0) {
          this.dirty = false
        }
      } catch (error) {
        this.dirty = true
        throw error
      }
    })
  }

  /** 仅限已持有队列的长任务内调用：直接落盘（同 FatImageVolume.flushHeld 的约束） */
  private async flushHeld(): Promise<void> {
    try {
      await this.writeBitmapIfDirty()
      await this.cache.flush(this.io)
      if (this.cache.dirtyBytes() === 0) {
        this.dirty = false
      }
    } catch (error) {
      this.dirty = true
      throw error
    }
  }

  /* ── 卷布局基础 ── */

  private requireSuperblock(): ExfatSuperblock {
    if (!this.superblock) {
      throw new Error('exFAT 卷尚未挂载')
    }
    return this.superblock
  }

  private clusterOffset(cluster: number): number {
    const sb = this.requireSuperblock()
    return this.baseOffset + sb.clusterHeapStart + (cluster - CLUSTER_FIRST) * sb.clusterSize
  }

  private fatEntryOffset(cluster: number, fatIndex: number): number {
    const sb = this.requireSuperblock()
    return this.baseOffset + sb.fatStart + fatIndex * sb.fatLength + cluster * 4
  }

  private async readFatEntry(cluster: number): Promise<number> {
    const sb = this.requireSuperblock()
    return this.withSectors(() => u32le(this.driver.read(this.fatEntryOffset(cluster, sb.activeFat), 4), 0))
  }

  private async writeFatEntry(cluster: number, value: number): Promise<void> {
    const sb = this.requireSuperblock()
    await this.withSectors(() => {
      for (let fat = 0; fat < sb.numberOfFats; fat += 1) {
        const offset = this.fatEntryOffset(cluster, fat)
        const scratch = new Uint8Array(4)
        w32le(scratch, 0, value)
        this.driver.write(offset, scratch)
      }
    })
  }

  private isClusterFree(cluster: number): boolean {
    const sb = this.requireSuperblock()
    if (cluster < CLUSTER_FIRST || cluster >= sb.clusterCount + CLUSTER_FIRST) return false
    const bit = cluster - CLUSTER_FIRST
    return (this.bitmap![bit >> 3]! & (1 << (bit & 7))) === 0
  }

  private markClusterUsed(cluster: number, used: boolean): void {
    const sb = this.requireSuperblock()
    const bit = cluster - CLUSTER_FIRST
    if (bit < 0 || bit >= sb.clusterCount) {
      throw new Error('簇号越界，镜像可能已损坏')
    }
    const mask = 1 << (bit & 7)
    const byte = this.bitmap![bit >> 3]!
    this.bitmap![bit >> 3] = used ? byte | mask : byte & ~mask
    this.bitmapDirty = true
    this.markDirty()
  }

  /**
   * 扫描位图分配 count 个簇（可为非连续），置位图、串 FAT 链。
   * zero=true 时把簇清零（预分配 / 需要读改写的场景）；整簇覆盖写的调用方可传 false 省一遍写。
   */
  private async allocateChain(count: number, zero = true): Promise<number[]> {
    const sb = this.requireSuperblock()
    const out: number[] = []
    let cursor = this.allocHint
    for (let scanned = 0; scanned < sb.clusterCount && out.length < count; scanned += 1) {
      if (this.isClusterFree(cursor)) out.push(cursor)
      cursor += 1
      if (cursor >= sb.clusterCount + CLUSTER_FIRST) cursor = CLUSTER_FIRST
    }
    if (out.length < count) {
      throw new Error('磁盘空间不足')
    }
    for (const clu of out) {
      this.markClusterUsed(clu, true)
    }
    for (let i = 0; i < out.length; i += 1) {
      await this.writeFatEntry(out[i]!, i + 1 < out.length ? out[i + 1]! : CLUSTER_EOC)
    }
    this.allocHint = (out[out.length - 1]! + 1 - CLUSTER_FIRST >= sb.clusterCount)
      ? CLUSTER_FIRST
      : out[out.length - 1]! + 1
    if (zero) {
      const zeros = new Uint8Array(sb.clusterSize)
      for (const clu of out) {
        await this.withSectors(() => this.driver.write(this.clusterOffset(clu), zeros))
        await this.maybeFlushHeld()
        await this.maybeYieldHeld()
      }
    }
    return out
  }

  private async walkChain(firstCluster: number): Promise<number[]> {
    const sb = this.requireSuperblock()
    const chain: number[] = []
    const seen = new Set<number>()
    let clu = firstCluster
    while (
      clu >= CLUSTER_FIRST &&
      clu < sb.clusterCount + CLUSTER_FIRST &&
      !seen.has(clu) &&
      chain.length <= sb.clusterCount
    ) {
      seen.add(clu)
      chain.push(clu)
      countSystemDebugHot('files', 'exfat-chain-walk')
      const next = await this.readFatEntry(clu)
      if (next >= 0x0ffffff8) break
      clu = next
    }
    return chain
  }

  private streamClusters(stream: ExfatStreamRef): number[] {
    const sb = this.requireSuperblock()
    if (stream.noFatChain && stream.firstCluster >= CLUSTER_FIRST) {
      const count = Math.max(1, Math.ceil(stream.dataLength / sb.clusterSize))
      const clusters: number[] = []
      for (let i = 0; i < count; i += 1) clusters.push(stream.firstCluster + i)
      return clusters
    }
    if (!stream.noFatChain) {
      throw new Error('内部错误：FAT 链流需异步走 walkChain')
    }
    return []
  }

  private async clustersOf(stream: ExfatStreamRef): Promise<number[]> {
    return stream.noFatChain ? this.streamClusters(stream) : await this.walkChain(stream.firstCluster)
  }

  /** 释放一条流占用的簇：清位图 + 清 FAT 表项（NoFatChain 流按算术簇号清理） */
  private async freeStream(stream: ExfatStreamRef): Promise<void> {
    if (stream.firstCluster < CLUSTER_FIRST) return
    const clusters = await this.clustersOf(stream)
    for (const clu of clusters) {
      this.markClusterUsed(clu, false)
      await this.writeFatEntry(clu, 0)
    }
  }

  /* ── 目录读写 ── */

  private async loadDir(node: ExfatNode | undefined, firstCluster: number): Promise<ExfatDirHandle> {
    const sb = this.requireSuperblock()
    const noFatChain = node?.noFatChain ?? false // 根目录按 FAT 链读取
    const clusters = noFatChain
      ? this.streamClusters({ firstCluster, dataLength: node!.dataLength, noFatChain: true })
      : await this.walkChain(firstCluster)
    if (clusters.length === 0) {
      throw new Error('exFAT 目录簇链为空，镜像可能已损坏')
    }
    const data = new Uint8Array(clusters.length * sb.clusterSize)
    let cursor = 0
    for (const clu of clusters) {
      await this.withSectors(() => {
        data.set(this.driver.read(this.clusterOffset(clu), sb.clusterSize), cursor)
      })
      cursor += sb.clusterSize
    }
    return { node, clusters, noFatChain, data }
  }

  private async writeDirHandle(handle: ExfatDirHandle): Promise<void> {
    const sb = this.requireSuperblock()
    const expected = handle.clusters.length * sb.clusterSize
    if (handle.data.byteLength !== expected) {
      throw new Error('内部错误：目录数据长度与簇数不一致')
    }
    for (let i = 0; i < handle.clusters.length; i += 1) {
      const clu = handle.clusters[i]!
      await this.withSectors(() => {
        this.driver.write(this.clusterOffset(clu), handle.data.subarray(i * sb.clusterSize, (i + 1) * sb.clusterSize))
      })
    }
  }

  /** 目录扩容；NoFatChain 目录优先物理连续扩展，失败则整条转成 FAT 链 */
  private async growDirectory(open: OpenDir, count: number): Promise<void> {
    const sb = this.requireSuperblock()
    const handle = open.handle
    if (handle.data.byteLength + count * sb.clusterSize > MAX_DIRECTORY_BYTES) {
      throw new Error('目录过大，无法继续扩展')
    }
    let converted = false
    if (handle.noFatChain) {
      const last = handle.clusters[handle.clusters.length - 1]!
      let contiguous = true
      for (let i = 1; i <= count; i += 1) {
        if (last + i >= sb.clusterCount + CLUSTER_FIRST || !this.isClusterFree(last + i)) {
          contiguous = false
          break
        }
      }
      if (contiguous) {
        for (let i = 1; i <= count; i += 1) {
          const clu = last + i
          this.markClusterUsed(clu, true)
          await this.writeFatEntry(clu, CLUSTER_EOC)
          handle.clusters.push(clu)
        }
      } else {
        // 现有簇改成 FAT 链后走通用追加
        for (let i = 0; i < handle.clusters.length; i += 1) {
          await this.writeFatEntry(
            handle.clusters[i]!,
            i + 1 < handle.clusters.length ? handle.clusters[i + 1]! : CLUSTER_EOC,
          )
        }
        handle.noFatChain = false
        converted = true
      }
    }
    if (!handle.noFatChain && (converted || handle.clusters.length > 0)) {
      const added = await this.allocateChain(count)
      const tail = handle.clusters[handle.clusters.length - 1]!
      await this.writeFatEntry(tail, added[0]!)
      handle.clusters.push(...added)
    }
    const grown = new Uint8Array(handle.data.byteLength + count * sb.clusterSize)
    grown.set(handle.data)
    handle.data = grown
    open.dirty = true
    open.grew = true
  }

  /** 从最深一层向上落盘目录数据；扩容过的层同步改写父目录里的流扩展项 */
  private async commitDirs(chain: OpenDir[]): Promise<void> {
    const sb = this.requireSuperblock()
    for (let i = chain.length - 1; i >= 1; i -= 1) {
      const open = chain[i]!
      if (open.grew && open.handle.node) {
        const parentOpen = chain[i - 1]!
        patchStreamEntry(parentOpen.handle.data, open.handle.node.slot, {
          dataLength: open.handle.clusters.length * sb.clusterSize,
          noFatChain: open.handle.noFatChain,
        })
        parentOpen.dirty = true
      }
      if (open.dirty) {
        await this.writeDirHandle(open.handle)
      }
    }
    const root = chain[0]!
    if (root.dirty) {
      await this.writeDirHandle(root.handle)
    }
  }

  private async openRoot(): Promise<OpenDir> {
    const sb = this.requireSuperblock()
    const handle = await this.loadDir(undefined, sb.rootCluster)
    return { handle, dirty: false, grew: false }
  }

  private async openChildDir(node: ExfatNode): Promise<OpenDir> {
    const handle = await this.loadDir(node, node.firstCluster)
    return { handle, dirty: false, grew: false }
  }

  /** 解析路径到目标所在父目录；node 为目标（可能不存在） */
  private async resolveParent(
    relativePath: string,
  ): Promise<{ chain: OpenDir[]; parent: OpenDir; node: ExfatNode | undefined; name: string }> {
    const segments = splitPathSegments(relativePath)
    if (segments.length === 0) {
      throw new Error('路径不能为空')
    }
    let current = await this.openRoot()
    const chain: OpenDir[] = [current]
    for (let i = 0; i < segments.length - 1; i += 1) {
      const parsed = parseExfatDirectory(current.handle.data)
      const next = parsed.nodes.find((item) => sameName(item.name, segments[i]!))
      if (!next || (next.attributes & ATTR_DIRECTORY) === 0) {
        throw new Error('文件夹不存在')
      }
      current = await this.openChildDir(next)
      chain.push(current)
    }
    const name = segments[segments.length - 1]!
    const parsed = parseExfatDirectory(current.handle.data)
    const node = parsed.nodes.find((item) => sameName(item.name, name))
    return { chain, parent: current, node, name }
  }

  private toEntry(node: ExfatNode): ImageVolumeEntry {
    const isDirectory = (node.attributes & ATTR_DIRECTORY) !== 0
    const updatedAt = node.updatedAt || node.createdAt || Date.now()
    return {
      name: node.name,
      kind: isDirectory ? 'folder' : 'file',
      byteSize: isDirectory ? 0 : node.dataLength,
      createdAt: node.createdAt || updatedAt,
      updatedAt,
    }
  }

  private static nodeDirectory(node: ExfatNode): boolean {
    return (node.attributes & ATTR_DIRECTORY) !== 0
  }

  /* ── 挂载与卸载 ── */

  private async detectBaseOffset(): Promise<number> {
    const sector0 = await this.io.read(0, SECTOR)
    if (sector0.byteLength >= SECTOR && parseExfatSuperblock(sector0.subarray(0, SECTOR))) {
      return 0
    }
    if (sector0.byteLength >= SECTOR && sector0[510] === 0x55 && sector0[511] === 0xaa) {
      for (let slot = 0; slot < 4; slot += 1) {
        const base = 446 + slot * 16
        let allZero = true
        for (let i = 0; i < 16; i += 1) {
          if (sector0[base + i] !== 0) {
            allZero = false
            break
          }
        }
        if (allZero) continue
        const lbaStart =
          sector0[base + 8]! |
          (sector0[base + 9]! << 8) |
          (sector0[base + 10]! << 16) |
          (sector0[base + 11]! << 24 >>> 0)
        if (lbaStart <= 0) continue
        const partitionStart = lbaStart * SECTOR
        if (partitionStart + SECTOR > this.io.size) continue
        const boot = await this.io.read(partitionStart, SECTOR)
        if (boot.byteLength >= SECTOR && parseExfatSuperblock(boot.subarray(0, SECTOR))) {
          return partitionStart
        }
      }
      throw new Error('分区的文件系统不受支持（支持 FAT12/16/32 与 exFAT）')
    }
    throw new Error('无法识别此镜像的文件系统：可能是空白盘或不受支持的格式')
  }

  private async loadBitmap(rootData: Uint8Array): Promise<void> {
    const sb = this.requireSuperblock()
    const parsed = parseExfatDirectory(rootData)
    const stream = parsed.bitmapStream
    if (!stream || stream.firstCluster < CLUSTER_FIRST) {
      throw new Error('exFAT 卷缺少分配位图，镜像可能已损坏')
    }
    const size = Math.min(
      stream.dataLength || Math.ceil(sb.clusterCount / 8),
      Math.ceil(sb.clusterCount / 8),
    )
    const bitmap = new Uint8Array(size)
    // 位图按连续簇读（NoFatChain 置位）；FAT 链位图逐簇搬运
    const clusters = stream.noFatChain
      ? this.streamClusters(stream)
      : await this.walkChain(stream.firstCluster)
    const clusterSize = sb.clusterSize
    let cursor = 0
    for (const clu of clusters) {
      if (cursor >= size) break
      await this.withSectors(() => {
        const chunk = this.driver.read(this.clusterOffset(clu), clusterSize)
        bitmap.set(chunk.subarray(0, Math.min(clusterSize, size - cursor)), cursor)
      })
      cursor += clusterSize
    }
    this.bitmap = bitmap
    this.bitmapStream = stream
  }

  async prepare(): Promise<void> {
    await this.enqueue(async () => {
      this.baseOffset = await this.detectBaseOffset()
      const boot = await this.withSectors(() =>
        copyBytes(this.driver.read(this.baseOffset, SECTOR)),
      )
      const superblock = parseExfatSuperblock(boot)
      if (!superblock) {
        throw new Error('exFAT 引导区无法解析，镜像可能已损坏')
      }
      const heapEnd =
        this.baseOffset + superblock.clusterHeapStart + superblock.clusterCount * superblock.clusterSize
      if (heapEnd > this.io.size) {
        throw new Error('exFAT 卷几何越界，镜像不完整')
      }
      this.superblock = superblock
      // 引导区 + FAT 钉进缓存；位图与目录数据靠单簇缺页重试兜底
      this.cache.pinSectorsBelow(
        Math.floor(
          (this.baseOffset + superblock.fatStart + superblock.fatLength * superblock.numberOfFats) /
            SECTOR,
        ),
      )
      const sb = this.requireSuperblock()
      const root = await this.loadDir(undefined, sb.rootCluster)
      await this.loadBitmap(root.data)
    })
  }

  async flush(): Promise<void> {
    this.kickFlush()
    await this.flushing
    if (this.cache.dirtyBytes() > 0 || this.bitmapDirty) {
      await this.flushNow()
    }
    await this.io.flush?.()
  }

  async close(): Promise<void> {
    await this.flush()
    await this.io.close?.()
  }

  /* ── 读操作 ── */

  async list(relativeDir: string): Promise<ImageVolumeEntry[]> {
    return this.enqueue(async () => {
      const segments = splitPathSegments(relativeDir)
      let current = await this.openRoot()
      for (const segment of segments) {
        const parsed = parseExfatDirectory(current.handle.data)
        const next = parsed.nodes.find((item) => sameName(item.name, segment))
        if (!next || !ExfatImageVolume.nodeDirectory(next)) {
          throw new Error('文件夹不存在')
        }
        current = await this.openChildDir(next)
      }
      const parsed = parseExfatDirectory(current.handle.data)
      return parsed.nodes.map((node) => this.toEntry(node))
    })
  }

  async stat(relativePath: string): Promise<ImageVolumeEntry | undefined> {
    if (!relativePath) return undefined
    return this.enqueue(async () => {
      const { node } = await this.resolveParent(relativePath)
      return node ? this.toEntry(node) : undefined
    })
  }

  async readFile(relativePath: string): Promise<Uint8Array> {
    return this.enqueue(async () => {
      const { node } = await this.resolveParent(relativePath)
      if (!node || ExfatImageVolume.nodeDirectory(node)) {
        throw new Error('文件不存在')
      }
      if (node.firstCluster < CLUSTER_FIRST || node.dataLength === 0) {
        return new Uint8Array(0)
      }
      const bytes = await this.readStreamBytes(node, 0, node.dataLength)
      return bytes
    })
  }

  /** 读取流覆盖 [offset, offset+length) 的簇并拼装切片 */
  private async readStreamBytes(
    stream: ExfatStreamRef,
    offset: number,
    length: number,
  ): Promise<Uint8Array> {
    const sb = this.requireSuperblock()
    const want = Math.max(0, length)
    if (want === 0) return new Uint8Array(0)
    const clusters = await this.clustersOf(stream)
    const firstIndex = Math.floor(offset / sb.clusterSize)
    const lastIndex = Math.floor((offset + want - 1) / sb.clusterSize)
    const out = new Uint8Array((lastIndex - firstIndex + 1) * sb.clusterSize)
    let cursor = 0
    for (let i = firstIndex; i <= lastIndex; i += 1) {
      const clu = clusters[i]
      if (clu === undefined) break
      await this.withSectors(() => {
        out.set(this.driver.read(this.clusterOffset(clu), sb.clusterSize), cursor)
      })
      cursor += sb.clusterSize
      await this.maybeYieldHeld()
    }
    const sliceStart = offset % sb.clusterSize
    return out.subarray(sliceStart, Math.min(sliceStart + want, cursor))
  }

  async readFileRange(
    relativePath: string,
    offset: number,
    length: number,
  ): Promise<Uint8Array> {
    return this.enqueue(async () => {
      const { node } = await this.resolveParent(relativePath)
      if (!node || ExfatImageVolume.nodeDirectory(node)) {
        throw new Error('文件不存在')
      }
      const start = Math.max(0, offset)
      const want = Math.max(0, Math.min(length, node.dataLength - start))
      if (want <= 0 || node.firstCluster < CLUSTER_FIRST) {
        return new Uint8Array(0)
      }
      return this.readStreamBytes(node, start, want)
    })
  }

  /* ── 写操作 ── */

  async writeFile(relativePath: string, data: Uint8Array): Promise<ImageVolumeEntry> {
    // 大包同步打进扇区缓存会卡住任务内回刷，改走流式写（与 FAT 卷同一策略）
    if (data.byteLength > this.inlineFlushDirtyBytes) {
      return this.writeFileStreamed(relativePath, data)
    }
    return this.enqueue(async () => {
      try {
        const { chain, parent, node, name } = await this.resolveParent(relativePath)
        if (node && ExfatImageVolume.nodeDirectory(node)) {
          throw new Error('无法写入文件：同名文件夹已存在')
        }
        const now = Date.now()
        // 先释放旧流再分配：整卷覆写大文件时旧簇可立即复用
        if (node) {
          await this.freeStream(node)
        }
        const sb = this.requireSuperblock()
        const clusters =
          data.byteLength > 0
            ? await this.allocateChain(Math.ceil(data.byteLength / sb.clusterSize), false)
            : []
        // 全簇覆盖写；末簇零底 + 叠加，新分配簇无需读改写
        for (let i = 0; i < clusters.length; i += 1) {
          const clu = clusters[i]!
          const start = i * sb.clusterSize
          const piece = data.subarray(start, Math.min(start + sb.clusterSize, data.byteLength))
          if (piece.byteLength === sb.clusterSize) {
            await this.withSectors(() => this.driver.write(this.clusterOffset(clu), piece))
          } else {
            const buf = new Uint8Array(sb.clusterSize)
            buf.set(piece)
            await this.withSectors(() => this.driver.write(this.clusterOffset(clu), buf))
          }
          await this.maybeFlushHeld()
          await this.maybeYieldHeld()
        }
        const firstCluster = clusters[0] ?? 0
        if (node) {
          patchStreamEntry(parent.handle.data, node.slot, {
            firstCluster,
            dataLength: data.byteLength,
            noFatChain: false,
          })
          patchFileModifiedTime(parent.handle.data, node.slot, now)
          parent.dirty = true
        } else {
          const spec: FileSetSpec = {
            name,
            attributes: ATTR_ARCHIVE,
            firstCluster,
            dataLength: data.byteLength,
            noFatChain: false,
            createdAt: now,
            updatedAt: now,
            accessedAt: now,
          }
          await this.insertFileSet(parent, spec)
        }
        await this.commitDirs(chain)
        return this.toEntry({
          name,
          attributes: ATTR_ARCHIVE,
          createdAt: node ? node.createdAt : now,
          updatedAt: now,
          accessedAt: now,
          firstCluster,
          dataLength: data.byteLength,
          noFatChain: false,
          slot: node ? node.slot : 0,
          slotCount: node ? node.slotCount : 0,
        })
      } finally {
        this.noteDirtyCache()
      }
    })
  }

  private async writeFileStreamed(
    relativePath: string,
    data: Uint8Array,
  ): Promise<ImageVolumeEntry> {
    const writer = await this.streamWriteFile(relativePath, {
      isNew: false,
      expectedSize: data.byteLength,
    })
    try {
      await writer.write(data)
      return await writer.close()
    } catch (error) {
      await writer.abort().catch(() => undefined)
      throw error
    }
  }

  /** 把序列化好的文件集合写进目录，必要时扩容；返回起始槽位 */
  private async insertFileSet(open: OpenDir, spec: FileSetSpec): Promise<number> {
    const bytes = serializeExfatFileSet(spec)
    const needSlots = bytes.byteLength / DIRENTRY_SIZE
    let slot = findFreeEntrySlots(open.handle.data, needSlots)
    if (slot === undefined) {
      await this.growDirectory(open, 1)
      slot = findFreeEntrySlots(open.handle.data, needSlots)
      if (slot === undefined) {
        throw new Error('exFAT 目录无法扩展，写入失败')
      }
    }
    open.handle.data.set(bytes, slot * DIRENTRY_SIZE)
    open.dirty = true
    // 集合恰好写满目录数据时补一个 0x00 终结符所在的簇
    if ((slot + needSlots) * DIRENTRY_SIZE >= open.handle.data.byteLength) {
      await this.growDirectory(open, 1)
    }
    return slot
  }

  async writeFileRange(
    relativePath: string,
    offset: number,
    data: Uint8Array,
  ): Promise<ImageVolumeEntry> {
    return this.enqueue(async () => {
      try {
        const { chain, parent, node } = await this.resolveParent(relativePath)
        if (!node || ExfatImageVolume.nodeDirectory(node)) {
          throw new Error('文件不存在')
        }
        const sb = this.requireSuperblock()
        if (offset > node.dataLength) {
          throw new Error('offset 超出文件末尾，当前不支持空洞扩展')
        }
        const now = Date.now()
        if (data.byteLength === 0) {
          patchFileModifiedTime(parent.handle.data, node.slot, now)
          parent.dirty = true
          await this.commitDirs(chain)
          return this.toEntry(node)
        }
        const newSize = Math.max(node.dataLength, offset + data.byteLength)
        const neededClusters = Math.ceil(newSize / sb.clusterSize)
        const oldClusterCount = Math.max(1, Math.ceil(node.dataLength / sb.clusterSize))
        let clusters = await this.clustersOf(node)
        let noFatChain = node.noFatChain
        let firstCluster = node.firstCluster
        if (neededClusters > clusters.length) {
          const extra = neededClusters - clusters.length
          let extended = false
          if (noFatChain && clusters.length > 0) {
            // NoFatChain 流优先物理连续扩展，失败则整条转成 FAT 链
            const last = clusters[clusters.length - 1]!
            let contiguous = true
            for (let i = 1; i <= extra; i += 1) {
              if (last + i >= sb.clusterCount + CLUSTER_FIRST || !this.isClusterFree(last + i)) {
                contiguous = false
                break
              }
            }
            if (contiguous) {
              for (let i = 1; i <= extra; i += 1) {
                const clu = last + i
                this.markClusterUsed(clu, true)
                await this.writeFatEntry(clu, CLUSTER_EOC)
                clusters.push(clu)
              }
              extended = true
            } else {
              for (let i = 0; i < clusters.length; i += 1) {
                await this.writeFatEntry(
                  clusters[i]!,
                  i + 1 < clusters.length ? clusters[i + 1]! : CLUSTER_EOC,
                )
              }
              noFatChain = false
            }
          }
          if (!extended) {
            const added = await this.allocateChain(extra)
            if (firstCluster < CLUSTER_FIRST) {
              firstCluster = added[0]!
            } else {
              await this.writeFatEntry(clusters[clusters.length - 1]!, added[0]!)
            }
            clusters = [...clusters, ...added]
            noFatChain = false
          }
        }
        const startCluster = Math.floor(offset / sb.clusterSize)
        const endCluster = Math.floor((offset + data.byteLength - 1) / sb.clusterSize)
        for (let i = startCluster; i <= endCluster; i += 1) {
          const clu = clusters[i]
          if (clu === undefined) break
          const clusterStart = i * sb.clusterSize
          const overlapStart = Math.max(0, offset - clusterStart)
          const overlapEnd = Math.min(sb.clusterSize, offset + data.byteLength - clusterStart)
          if (overlapEnd <= overlapStart) continue
          const buf = new Uint8Array(sb.clusterSize)
          if (overlapStart !== 0 || overlapEnd !== sb.clusterSize) {
            if (i < oldClusterCount) {
              // 旧簇内局部写：读改写保留簇内其余旧数据
              await this.withSectors(() => {
                buf.set(this.driver.read(this.clusterOffset(clu), sb.clusterSize))
              })
            }
          }
          buf.set(
            data.subarray(clusterStart + overlapStart - offset, clusterStart + overlapEnd - offset),
            overlapStart,
          )
          await this.withSectors(() => this.driver.write(this.clusterOffset(clu), buf))
          await this.maybeFlushHeld()
          await this.maybeYieldHeld()
        }
        patchStreamEntry(parent.handle.data, node.slot, {
          firstCluster,
          dataLength: newSize,
          noFatChain,
        })
        patchFileModifiedTime(parent.handle.data, node.slot, now)
        parent.dirty = true
        await this.commitDirs(chain)
        return this.toEntry({
          ...node,
          firstCluster,
          dataLength: newSize,
          noFatChain,
          updatedAt: now,
        })
      } finally {
        this.noteDirtyCache()
      }
    })
  }

  async streamWriteFile(
    relativePath: string,
    options?: { isNew?: boolean; expectedSize?: number },
  ): Promise<{
    write(chunk: Uint8Array): Promise<void>
    close(): Promise<ImageVolumeEntry>
    abort(): Promise<void>
  }> {
    const isNew = options?.isNew === true
    const expectedSize = options?.expectedSize
    const state: {
      started: boolean
      chain: OpenDir[] | undefined
      parent: OpenDir | undefined
      slot: number | undefined
      slotCount: number
      clusters: number[]
      clusterSize: number
      pending: Uint8Array
      totalWritten: number
      aborted: boolean
      closed: boolean
    } = {
      started: false,
      chain: undefined,
      parent: undefined,
      slot: undefined,
      slotCount: 0,
      clusters: [],
      clusterSize: 0,
      pending: new Uint8Array(0),
      totalWritten: 0,
      aborted: false,
      closed: false,
    }

    const start = async (): Promise<void> => {
      if (state.started) return
      const { chain, parent, node, name } = await this.resolveParent(relativePath)
      if (node && ExfatImageVolume.nodeDirectory(node)) {
        throw new Error('无法写入文件：同名文件夹已存在')
      }
      const now = Date.now()
      const sb = this.requireSuperblock()
      state.clusterSize = sb.clusterSize
      if (node) {
        // 覆盖已有文件：立即截断原内容；abort 语义与 FAT 卷一致（保持为空）
        await this.freeStream(node)
        patchStreamEntry(parent.handle.data, node.slot, {
          firstCluster: 0,
          dataLength: 0,
          noFatChain: false,
        })
        parent.dirty = true
        state.slot = node.slot
        state.slotCount = node.slotCount
      } else {
        const spec: FileSetSpec = {
          name,
          attributes: ATTR_ARCHIVE,
          firstCluster: 0,
          dataLength: 0,
          noFatChain: false,
          createdAt: now,
          updatedAt: now,
          accessedAt: now,
        }
        state.slot = await this.insertFileSet(parent, spec)
        state.slotCount = exfatFileSetSlotCount(spec)
      }
      state.chain = chain
      state.parent = parent
      state.started = true
      if (expectedSize !== undefined && expectedSize > 0) {
        // 预分配整份文件：逐簇分配清零、到点落盘并让出
        const needed = Math.ceil(expectedSize / sb.clusterSize)
        state.clusters = await this.allocateChain(needed)
        await this.commitDirs(chain)
      } else {
        await this.commitDirs(chain)
      }
      this.noteDirtyCache()
    }

    const ensureCluster = async (index: number): Promise<number> => {
      while (state.clusters.length <= index) {
        const added = await this.allocateChain(1)
        if (state.clusters.length === 0) {
          state.clusters.push(added[0]!)
        } else {
          await this.writeFatEntry(state.clusters[state.clusters.length - 1]!, added[0]!)
          state.clusters.push(added[0]!)
        }
      }
      return state.clusters[index]!
    }

    await this.enqueue(async () => {
      await start()
    })

    return {
      write: (chunk) =>
        this.enqueue(async () => {
          if (state.closed || state.aborted) return
          try {
            await start()
            const combined = new Uint8Array(state.pending.byteLength + chunk.byteLength)
            combined.set(state.pending)
            combined.set(chunk, state.pending.byteLength)
            state.pending = combined
            while (state.pending.byteLength >= state.clusterSize) {
              const index = Math.floor(state.totalWritten / state.clusterSize)
              const clu = await ensureCluster(index)
              const full = state.pending.subarray(0, state.clusterSize)
              await this.withSectors(() => this.driver.write(this.clusterOffset(clu), full))
              state.totalWritten += state.clusterSize
              state.pending = state.pending.subarray(state.clusterSize)
              countSystemDebugHot('files', 'exfat-cluster-write')
              await this.maybeFlushHeld()
              await this.maybeYieldHeld()
            }
          } finally {
            this.noteDirtyCache()
          }
        }),
      close: () =>
        this.enqueue(async () => {
          if (state.closed || state.aborted) {
            throw new Error('无法写入文件')
          }
          state.closed = true
          try {
            await start()
            const parent = state.parent!
            const chain = state.chain!
            const now = Date.now()
            if (state.pending.byteLength > 0) {
              const index = Math.floor(state.totalWritten / state.clusterSize)
              const clu = await ensureCluster(index)
              const buf = new Uint8Array(state.clusterSize)
              buf.set(state.pending)
              await this.withSectors(() => this.driver.write(this.clusterOffset(clu), buf))
              state.totalWritten += state.pending.byteLength
              state.pending = new Uint8Array(0)
            }
            patchStreamEntry(parent.handle.data, state.slot!, {
              firstCluster: state.clusters[0] ?? 0,
              dataLength: state.totalWritten,
              noFatChain: false,
            })
            patchFileModifiedTime(parent.handle.data, state.slot!, now)
            parent.dirty = true
            await this.commitDirs(chain)
            const parsed = parseExfatDirectory(parent.handle.data)
            const node = parsed.nodes.find((item) => item.slot === state.slot)
            if (!node) throw new Error('无法写入文件')
            return this.toEntry(node)
          } finally {
            this.noteDirtyCache()
          }
        }),
      abort: () =>
        this.enqueue(async () => {
          if (state.closed) return
          state.aborted = true
          state.pending = new Uint8Array(0)
          try {
            const parent = state.parent
            const chain = state.chain
            if (parent && chain) {
              if (state.clusters.length > 0) {
                await this.freeStream({
                  firstCluster: state.clusters[0]!,
                  dataLength: state.clusters.length * state.clusterSize,
                  noFatChain: false,
                })
              }
              if (isNew && state.slot !== undefined) {
                // 新建文件：整个集合打删除标记，等于撤销创建
                for (let i = 0; i < state.slotCount; i += 1) {
                  const base = (state.slot + i) * DIRENTRY_SIZE
                  parent.handle.data[base] = parent.handle.data[base]! & 0x7f
                }
              } else if (state.slot !== undefined) {
                patchStreamEntry(parent.handle.data, state.slot, {
                  firstCluster: 0,
                  dataLength: 0,
                  noFatChain: false,
                })
              }
              parent.dirty = true
              await this.commitDirs(chain)
            }
          } finally {
            this.noteDirtyCache()
          }
        }),
    }
  }

  async mkdir(relativePath: string): Promise<ImageVolumeEntry> {
    return this.enqueue(async () => {
      try {
        const { chain, parent, node, name } = await this.resolveParent(relativePath)
        if (node) {
          throw new Error(ExfatImageVolume.nodeDirectory(node) ? '文件夹已存在' : '同名文件已存在')
        }
        const now = Date.now()
        const clusters = await this.allocateChain(1)
        const spec: FileSetSpec = {
          name,
          attributes: ATTR_DIRECTORY,
          firstCluster: clusters[0]!,
          dataLength: this.requireSuperblock().clusterSize,
          noFatChain: false,
          createdAt: now,
          updatedAt: now,
          accessedAt: now,
        }
        await this.insertFileSet(parent, spec)
        await this.commitDirs(chain)
        return this.toEntry({
          ...spec,
          slot: 0,
          slotCount: 0,
        })
      } finally {
        this.noteDirtyCache()
      }
    })
  }

  async remove(relativePath: string): Promise<void> {
    return this.enqueue(async () => {
      try {
        const { chain, parent, node } = await this.resolveParent(relativePath)
        if (!node) {
          throw new Error('项目不存在')
        }
        if (ExfatImageVolume.nodeDirectory(node)) {
          const child = await this.openChildDir(node)
          const parsed = parseExfatDirectory(child.handle.data)
          if (parsed.nodes.length > 0) {
            throw new Error('文件夹不为空')
          }
        }
        await this.freeStream(node)
        // 整个集合打删除标记（清 bit7）
        for (let i = 0; i < node.slotCount; i += 1) {
          const base = (node.slot + i) * DIRENTRY_SIZE
          parent.handle.data[base] = parent.handle.data[base]! & 0x7f
        }
        parent.dirty = true
        await this.commitDirs(chain)
      } finally {
        this.noteDirtyCache()
      }
    })
  }

  async rename(fromRelative: string, toRelative: string): Promise<ImageVolumeEntry> {
    return this.enqueue(async () => {
      try {
        const from = await this.resolveParent(fromRelative)
        if (!from.node) {
          throw new Error('项目不存在')
        }
        const node = from.node
        const fromSegments = splitPathSegments(fromRelative)
        const fromParentPath = fromSegments.slice(0, -1).join('/')
        const toSegments = splitPathSegments(toRelative)
        if (toSegments.length === 0) {
          throw new Error('目标路径不合法')
        }
        const toName = toSegments[toSegments.length - 1]!
        const toParentPath = toSegments.slice(0, -1).join('/')
        if (sameName(node.name, toName) && fromParentPath === toParentPath) {
          return this.toEntry(node)
        }
        if (
          ExfatImageVolume.nodeDirectory(node) &&
          (toParentPath === fromRelative ||
            toParentPath.startsWith(`${fromRelative}/`) ||
            toParentPath.split('/').some((segment) => sameName(segment, node.name)))
        ) {
          throw new Error('无法重命名：不能移动到自身内部')
        }
        const now = Date.now()
        const spec: FileSetSpec = {
          name: toName,
          attributes: node.attributes,
          firstCluster: node.firstCluster,
          dataLength: node.dataLength,
          noFatChain: node.noFatChain,
          createdAt: node.createdAt,
          updatedAt: now,
          accessedAt: now,
        }
        if (fromParentPath === toParentPath) {
          // 同目录重命名
          const parsed = parseExfatDirectory(from.parent.handle.data)
          const collision = parsed.nodes.find(
            (item) => item !== node && sameName(item.name, toName),
          )
          if (collision) {
            throw new Error('无法重命名：目标名称已存在')
          }
          const bytes = serializeExfatFileSet(spec)
          const needSlots = bytes.byteLength / DIRENTRY_SIZE
          if (needSlots <= node.slotCount) {
            // 槽位够用：原位重写，剩余槽位打删除标记
            from.parent.handle.data.set(bytes, node.slot * DIRENTRY_SIZE)
            for (let i = node.slot + needSlots; i < node.slot + node.slotCount; i += 1) {
              const base = i * DIRENTRY_SIZE
              from.parent.handle.data[base] = from.parent.handle.data[base]! & 0x7f
            }
          } else {
            const slot = await this.insertFileSet(from.parent, spec)
            for (let i = 0; i < node.slotCount; i += 1) {
              const base = (node.slot + i) * DIRENTRY_SIZE
              from.parent.handle.data[base] = from.parent.handle.data[base]! & 0x7f
            }
            void slot
          }
          from.parent.dirty = true
          await this.commitDirs(from.chain)
          return this.toEntry({ ...node, name: toName, updatedAt: now, slot: node.slot })
        }
        // 跨目录移动
        const to = await this.resolveParent(toRelative)
        if (to.node) {
          throw new Error('无法重命名：目标名称已存在')
        }
        await this.insertFileSet(to.parent, spec)
        for (let i = 0; i < node.slotCount; i += 1) {
          const base = (node.slot + i) * DIRENTRY_SIZE
          from.parent.handle.data[base] = from.parent.handle.data[base]! & 0x7f
        }
        from.parent.dirty = true
        await this.commitDirs(from.chain)
        await this.commitDirs(to.chain)
        return this.toEntry({ ...node, name: toName, updatedAt: now })
      } finally {
        this.noteDirtyCache()
      }
    })
  }
}
