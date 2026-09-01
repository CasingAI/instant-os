/**
 * 磁盘镜像分区发现与基址解析。
 *
 * - 解析 MBR（扇区 0）拿到 4 个主分区的起始扇区 / 长度；
 * - 选择要挂载的分区时，按 slot 顺序读该分区的引导扇区，识别为 FAT / exFAT 后返回基址；
 * - 未识别为受支持的文件系统、或分区表损坏时返回 undefined（让上层走整盘路径或抛错）。
 *
 * 该模块只做「无副作用探测」，不打开任何长连接、不预读扇区；
 * 实际扇区缓存由卷层管理。
 */
import type { ImageDiskIo } from './files-image-fat-volume.ts'
import { parseExfatSuperblock } from './files-image-exfat-volume.ts'

const SECTOR = 512

export type ImagePartitionEntry = {
  /** 1-based slot，与磁盘实用工具 UI 上的顺序一致 */
  slot: number
  /** MBR 表项里声明的分区类型字节 */
  partitionType: number
  /** 分区起始扇区（LBA） */
  startSector: number
  /** 分区大小（扇区数） */
  sectorCount: number
  /** 分区是否标记为 active（可启动） */
  active: boolean
  /** 探测到的文件系统类型；探测失败为 undefined */
  fsType: 'FAT12' | 'FAT16' | 'FAT32' | 'exFAT' | undefined
}

export type MbrPartitionTable = {
  /** 镜像里识别出的分区表（最多 4 个 slot，slot 顺序与 MBR 表项顺序一致） */
  partitions: ImagePartitionEntry[]
  /** MBR 签名是否合法（0x55 0xAA） */
  validMbr: boolean
}

/**
 * 读取 MBR，解析 4 个主分区表项。
 * 不会因为单条表项异常就放弃：四格里只要起始扇区 + 大小合理（落在镜像范围内）就保留。
 */
export async function readMbrPartitionTable(io: ImageDiskIo): Promise<MbrPartitionTable> {
  const boot = await io.read(0, SECTOR)
  if (boot.byteLength < SECTOR) {
    return { partitions: [], validMbr: false }
  }
  const validMbr = boot[510] === 0x55 && boot[511] === 0xaa
  const partitions: ImagePartitionEntry[] = []
  if (!validMbr) {
    return { partitions, validMbr }
  }
  for (let slot = 0; slot < 4; slot += 1) {
    const base = 446 + slot * 16
    const partitionType = boot[base + 4]!
    const lbaStart =
      boot[base + 8]! |
      (boot[base + 9]! << 8) |
      (boot[base + 10]! << 16) |
      (boot[base + 11]! << 24 >>> 0)
    const sectorCount =
      boot[base + 12]! |
      (boot[base + 13]! << 8) |
      (boot[base + 14]! << 16) |
      (boot[base + 15]! << 24 >>> 0)
    if (partitionType === 0) continue
    if (lbaStart <= 0 || sectorCount <= 0) continue
    const startByte = lbaStart * SECTOR
    const sizeBytes = sectorCount * SECTOR
    if (startByte + sizeBytes > io.size) continue
    const active = (boot[base]! & 0x80) !== 0
    partitions.push({
      slot: slot + 1,
      partitionType,
      startSector: lbaStart,
      sectorCount,
      active,
      fsType: undefined,
    })
  }
  return { partitions, validMbr }
}

/**
 * FAT BPB 探测（libmount 之外的内联版本，用于在挂载前预判）：
 * 检验 BPB 头合法性并按 BPB 推断 FAT 类型。
 * 不读 FAT 表与根目录内容，仅看引导扇区字段；足以决定是否能交给 FatImageVolume 接管。
 */
export function detectFatTypeFromBootSector(boot: Uint8Array): 'FAT12' | 'FAT16' | 'FAT32' | undefined {
  if (boot.byteLength < SECTOR) return undefined
  if (boot[510] !== 0x55 || boot[511] !== 0xaa) return undefined
  const bytsPerSec =
    (boot[11]! | (boot[12]! << 8)) || 512
  const secPerClus = boot[13]!
  const reserved = boot[14]! | (boot[15]! << 8)
  const numFats = boot[16]!
  const rootEntCnt = boot[17]! | (boot[18]! << 8)
  const totSec16 = boot[19]! | (boot[20]! << 8)
  const totSec32 = boot[32]! | (boot[33]! << 8) | (boot[34]! << 16) | (boot[35]! << 24 >>> 0)
  const fatSz16 = boot[22]! | (boot[23]! << 8)
  const fatSz32 = boot[36]! | (boot[37]! << 8) | (boot[38]! << 16) | (boot[39]! << 24 >>> 0)
  const totalSectors = totSec16 || totSec32
  if (bytsPerSec < 512 || bytsPerSec > 4096) return undefined
  if (!((bytsPerSec - 1) & bytsPerSec)) return undefined
  if (secPerClus === 0 || ((secPerClus - 1) & secPerClus)) return undefined
  if (numFats === 0) return undefined
  if (reserved === 0) return undefined
  const rootDirSectors = Math.ceil(rootEntCnt * 32 / bytsPerSec)
  if (rootEntCnt === 0) {
    // FAT32：根目录项数 0，fatSz32 非零
    if (fatSz32 === 0) return undefined
    const dataSec = totalSectors - (reserved + numFats * fatSz32 + rootDirSectors)
    if (dataSec <= 0) return undefined
    const countOfClusters = Math.floor(dataSec / secPerClus)
    if (countOfClusters < 65525) return undefined
    return 'FAT32'
  }
  if (fatSz16 === 0) return undefined
  const dataSec = totalSectors - (reserved + numFats * fatSz16 + rootDirSectors)
  if (dataSec <= 0) return undefined
  const countOfClusters = Math.floor(dataSec / secPerClus)
  if (countOfClusters < 4085) return 'FAT12'
  return 'FAT16'
}

/**
 * 探测某个分区是否承载受支持的文件系统（FAT12/16/32 或 exFAT）。
 * 不区分具体类型：上层按探测顺序交给 FatImageVolume / ExfatImageVolume。
 */
export async function detectPartitionFileSystem(
  io: ImageDiskIo,
  partition: ImagePartitionEntry,
): Promise<ImagePartitionEntry['fsType']> {
  const startByte = partition.startSector * SECTOR
  const boot = await io.read(startByte, SECTOR)
  if (boot.byteLength < SECTOR) return undefined
  if (parseExfatSuperblock(boot.subarray(0, SECTOR))) return 'exFAT'
  return detectFatTypeFromBootSector(boot)
}

/**
 * 一次性扫描镜像，列出全部 MBR 分区并探测文件系统类型。
 * 跳过 FAT/exFAT 都无法识别的空分区（如扩展分区 0x05 / 0x0F）。
 */
export async function scanImagePartitions(io: ImageDiskIo): Promise<MbrPartitionTable> {
  const table = await readMbrPartitionTable(io)
  for (const partition of table.partitions) {
    partition.fsType = await detectPartitionFileSystem(io, partition)
  }
  return table
}

/** 由分区表项换算字节偏移（卷层需要的 base offset） */
export function partitionByteOffset(partition: ImagePartitionEntry): number {
  return partition.startSector * SECTOR
}

/** 把分区表项写进 MBR 缓冲（供测试构造多分区镜像） */
export function writeMbrPartitionSlots(
  mbr: Uint8Array,
  entries: Array<{
    slot: number
    active: boolean
    partitionType: number
    startSector: number
    sectorCount: number
  }>,
): void {
  for (const entry of entries) {
    if (entry.slot < 1 || entry.slot > 4) continue
    const base = 446 + (entry.slot - 1) * 16
    mbr[base] = entry.active ? 0x80 : 0x00
    mbr[base + 4] = entry.partitionType
    mbr[base + 8] = entry.startSector & 0xff
    mbr[base + 9] = (entry.startSector >>> 8) & 0xff
    mbr[base + 10] = (entry.startSector >>> 16) & 0xff
    mbr[base + 11] = (entry.startSector >>> 24) & 0xff
    mbr[base + 12] = entry.sectorCount & 0xff
    mbr[base + 13] = (entry.sectorCount >>> 8) & 0xff
    mbr[base + 14] = (entry.sectorCount >>> 16) & 0xff
    mbr[base + 15] = (entry.sectorCount >>> 24) & 0xff
  }
}