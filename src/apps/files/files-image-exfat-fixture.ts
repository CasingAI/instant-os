/**
 * 构造最小可挂载的 exFAT 镜像，供测试使用。
 *
 * 布局按微软 exFAT 规范：24 扇区引导区（主 12 + 备份 12，含引导校验和）、
 * 单份 FAT、簇堆（根目录 = 簇 2，分配位图 = 簇 3，预置文件从簇 4 起）。
 * 卷标 / 预置文件的目录项复用卷实现里的序列化逻辑，保证哈希与校验和口径一致。
 */
import {
  computeExfatNameHash,
  computeExfatSetChecksum,
} from './files-image-exfat-volume.ts'

const SECTOR = 512
const BOOT_REGION_SECTORS = 24
const CLUSTER_FIRST = 2
const CLUSTER_EOC = 0xffffffff
const MBR_PARTITION_START_SECTOR = 2048

export type ExfatFixtureFile = {
  name: string
  data?: Uint8Array
  /** true 时流扩展项置 NoFatChain（簇仍物理连续），考验驱动两种读法 */
  noFatChain?: boolean
}

export type ExfatFixtureDirectory = {
  name: string
  /** 预置簇数；默认 1 */
  clusterCount?: number
  /** true：在目录簇之后占住下一簇（放一个 1 簇文件的位图/FAT 记录），迫使目录无法连续扩展 */
  blockNextCluster?: boolean
}

export type ExfatFixtureOptions = {
  /** 卷大小（不含 MBR 前置区）；默认 2MB */
  sizeBytes?: number
  /** log2(每簇扇区数)；默认 3（4KB 簇） */
  sectorsPerClusterShift?: number
  /** true 时在卷前放一个 MBR，exFAT 分区类型 0x07 从 2048 扇区开始 */
  partitioned?: boolean
  label?: string
  files?: ExfatFixtureFile[]
  /** 预置 NoFatChain 子目录（目录项写入根目录，簇置零并标记占用） */
  directories?: ExfatFixtureDirectory[]
  /** FAT 份数：1 或 2；两份内容始终一致（引导区校验和按实际份数重算） */
  numberOfFats?: number
  /** VolFlags ActiveFat 位（0=首份 FAT）；置 1 时读取走第二份 FAT */
  activeFat?: number
  /** true 且 numberOfFats=2 时，把未被 ActiveFat 选中的那份 FAT 整区清零（模拟陈旧/损坏的另一份） */
  corruptInactiveFat?: boolean
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

/** 规范引导区校验和：扇区 0-10，跳过 VolumeFlags（106-107）与 PercentInUse（112） */
function bootChecksum(image: Uint8Array, baseSector: number): number {
  let sum = 0
  for (let sector = 0; sector <= 10; sector += 1) {
    const base = (baseSector + sector) * SECTOR
    for (let i = 0; i < SECTOR; i += 1) {
      if (sector === 0 && (i === 106 || i === 107 || i === 112)) continue
      sum = (((sum & 1) << 31) | (sum >>> 1)) + image[base + i]!
      sum = sum >>> 0
    }
  }
  return sum >>> 0
}

function serializeFixtureFileSet(
  file: ExfatFixtureFile,
  firstCluster: number,
  attributes = 0x0020,
  lengthOverride?: number,
): Uint8Array {
  const name = file.name
  const units: number[] = []
  for (let i = 0; i < name.length; i += 1) units.push(name.charCodeAt(i))
  const nameEntryCount = Math.max(1, Math.ceil(units.length / 15))
  const slotCount = 2 + nameEntryCount
  const buf = new Uint8Array(slotCount * 32)
  const dataLength = lengthOverride ?? file.data?.byteLength ?? 0
  const created = { date: ((2026 - 1980) << 9) | (8 << 5) | 1, time: (12 << 11) | (34 << 5) | 10, centis: 56 }
  buf[0] = 0x85
  buf[1] = 1 + nameEntryCount
  w16le(buf, 4, attributes)
  w16le(buf, 8, created.time)
  w16le(buf, 10, created.date)
  w16le(buf, 12, created.time)
  w16le(buf, 14, created.date)
  w16le(buf, 16, created.time)
  w16le(buf, 18, created.date)
  buf[20] = created.centis
  buf[21] = created.centis
  const streamBase = 32
  buf[streamBase] = 0xc0
  buf[streamBase + 1] = 0x01 | (file.noFatChain ? 0x02 : 0)
  buf[streamBase + 3] = units.length
  w16le(buf, streamBase + 4, computeExfatNameHash(name))
  w64le(buf, streamBase + 8, dataLength)
  w32le(buf, streamBase + 20, firstCluster)
  w64le(buf, streamBase + 24, dataLength)
  for (let i = 0; i < nameEntryCount; i += 1) {
    const nameBase = (2 + i) * 32
    buf[nameBase] = 0xc1
    for (let u = 0; u < 15; u += 1) {
      const index = i * 15 + u
      if (index >= units.length) break
      w16le(buf, nameBase + 2 + u * 2, units[index]!)
    }
  }
  w16le(buf, 2, computeExfatSetChecksum(buf))
  return buf
}

export function createExfatImage(options?: ExfatFixtureOptions): Uint8Array {
  const volumeSectors = Math.floor((options?.sizeBytes ?? 2 * 1024 * 1024) / SECTOR)
  const clusterShift = options?.sectorsPerClusterShift ?? 3
  const sectorsPerCluster = 1 << clusterShift
  const numberOfFats = options?.numberOfFats === 2 ? 2 : 1
  const activeFat = options?.activeFat === 1 ? 1 : 0
  const partitionStart = options?.partitioned ? MBR_PARTITION_START_SECTOR : 0
  const totalSectors = partitionStart + volumeSectors
  const image = new Uint8Array(totalSectors * SECTOR)
  const volumeBase = partitionStart * SECTOR

  // 迭代解出 FAT 长度：簇数依赖堆偏移，堆偏移依赖 FAT 长度（含全部 FAT 份数）
  const fatStart = BOOT_REGION_SECTORS
  let fatSectors = 1
  let clusterCount = 0
  for (;;) {
    const heapStart = fatStart + fatSectors * numberOfFats
    clusterCount = Math.floor((volumeSectors - heapStart) / sectorsPerCluster)
    const needed = Math.ceil(((clusterCount + 2) * 4) / SECTOR)
    if (needed <= fatSectors) break
    fatSectors = needed
  }
  const heapStart = fatStart + fatSectors * numberOfFats
  clusterCount = Math.floor((volumeSectors - heapStart) / sectorsPerCluster)

  const clusterSize = SECTOR * sectorsPerCluster
  const clusterOffset = (cluster: number): number =>
    volumeBase + heapStart * SECTOR + (cluster - CLUSTER_FIRST) * clusterSize

  /* ── VBR ── */
  const vbr = image.subarray(volumeBase, volumeBase + SECTOR)
  vbr.set([0xeb, 0x76, 0x90], 0)
  vbr.set([0x45, 0x58, 0x46, 0x41, 0x54, 0x20, 0x20, 0x20], 3) // 'EXFAT   '
  // 11..63 MustBeZero 区域填 0xFF：exFAT 要求非零，避免被误认成 FAT BPB
  vbr.fill(0xff, 11, 64)
  w64le(vbr, 64, partitionStart)
  w64le(vbr, 72, volumeSectors)
  w32le(vbr, 80, fatStart)
  w32le(vbr, 84, fatSectors)
  w32le(vbr, 88, heapStart)
  w32le(vbr, 92, clusterCount)
  w32le(vbr, 96, CLUSTER_FIRST) // 根目录簇
  w32le(vbr, 100, 0x1234abcd)
  vbr[104] = 0x00
  vbr[105] = 0x01 // 规范版本 1.00
  w16le(vbr, 106, activeFat)
  vbr[108] = 9 // 512 字节扇区
  vbr[109] = clusterShift
  vbr[110] = numberOfFats
  vbr[111] = 0x80
  vbr[112] = 0
  vbr[510] = 0x55
  vbr[511] = 0xaa

  /* ── 引导区其余扇区 + 备份 + 校验和 ── */
  const writeBootRegion = (regionStart: number): void => {
    for (let sector = 1; sector <= 8; sector += 1) {
      const base = (regionStart + sector) * SECTOR
      w32le(image, base + 508, 0xaa550000)
    }
    w32le(image, (regionStart + 9) * SECTOR + 508, 0xaa550000) // OEM 参数扇区签名
  }
  writeBootRegion(partitionStart)
  image.copyWithin(
    (partitionStart + 12) * SECTOR,
    partitionStart * SECTOR,
    (partitionStart + 12) * SECTOR,
  )
  const checksum = bootChecksum(image, partitionStart)
  for (let i = 0; i < 128; i += 1) {
    w32le(image, (partitionStart + 11) * SECTOR + i * 4, checksum)
    w32le(image, (partitionStart + 23) * SECTOR + i * 4, checksum)
  }

  /* ── FAT（全部份数内容一致）── */
  const fatBases: number[] = []
  for (let fat = 0; fat < numberOfFats; fat += 1) {
    fatBases.push(volumeBase + (fatStart + fat * fatSectors) * SECTOR)
  }
  const writeFat = (cluster: number, value: number): void => {
    for (const base of fatBases) w32le(image, base + cluster * 4, value)
  }
  writeFat(0, 0xfffffff8)
  writeFat(1, 0xffffffff)

  /* ── 分配：根目录簇 2，位图簇 3，预置文件从簇 4 起 ── */
  writeFat(CLUSTER_FIRST, CLUSTER_EOC)
  writeFat(3, CLUSTER_EOC)
  const bitmapBytes = Math.ceil(clusterCount / 8)
  const bitmap = new Uint8Array(bitmapBytes)
  const markUsed = (cluster: number): void => {
    const bit = cluster - CLUSTER_FIRST
    bitmap[bit >> 3] = bitmap[bit >> 3]! | (1 << (bit & 7))
  }
  markUsed(CLUSTER_FIRST)
  markUsed(3)

  let nextCluster = 4
  const fileSets: Uint8Array[] = []
  for (const file of options?.files ?? []) {
    const data = file.data ?? new Uint8Array(0)
    const clusters = Math.max(data.byteLength > 0 ? 1 : 0, Math.ceil(data.byteLength / clusterSize))
    const firstCluster = clusters > 0 ? nextCluster : 0
    for (let i = 0; i < clusters; i += 1) {
      const clu = nextCluster + i
      markUsed(clu)
      writeFat(clu, file.noFatChain ? CLUSTER_EOC : i + 1 < clusters ? clu + 1 : CLUSTER_EOC)
      if (data.byteLength > 0) {
        image.set(
          data.subarray(i * clusterSize, Math.min((i + 1) * clusterSize, data.byteLength)),
          clusterOffset(clu),
        )
      }
    }
    nextCluster += clusters
    fileSets.push(serializeFixtureFileSet(file, firstCluster))
  }

  /* ── 预置 NoFatChain 子目录（紧跟文件之后；blockNextCluster 时占住后续簇）── */
  const dirSets: Uint8Array[] = []
  for (const dir of options?.directories ?? []) {
    const count = Math.max(1, dir.clusterCount ?? 1)
    const firstCluster = nextCluster
    for (let i = 0; i < count; i += 1) {
      const clu = nextCluster + i
      markUsed(clu)
      writeFat(clu, CLUSTER_EOC) // NoFatChain 目录：FAT 项置 EOC，驱动按连续簇读取
      image.fill(0, clusterOffset(clu), clusterOffset(clu) + clusterSize)
    }
    nextCluster += count
    if (dir.blockNextCluster) {
      const blk = nextCluster
      markUsed(blk)
      writeFat(blk, CLUSTER_EOC)
      nextCluster += 1
    }
    dirSets.push(
      serializeFixtureFileSet(
        { name: dir.name, noFatChain: true },
        firstCluster,
        0x10, // ATTR_DIRECTORY
        count * clusterSize,
      ),
    )
  }

  /* ── 位图数据（簇 3）── */
  image.set(bitmap, clusterOffset(3))

  /* ── 根目录（簇 2）：卷标 + 位图 + 预置文件 + 0x00 终结 ── */
  const root = image.subarray(clusterOffset(CLUSTER_FIRST), clusterOffset(CLUSTER_FIRST) + clusterSize)
  let cursor = 0
  if (options?.label) {
    const labelUnits: number[] = []
    for (let i = 0; i < Math.min(11, options.label.length); i += 1) {
      labelUnits.push(options.label.charCodeAt(i))
    }
    root[cursor] = 0x83
    root[cursor + 1] = labelUnits.length
    for (let i = 0; i < labelUnits.length; i += 1) {
      w16le(root, cursor + 2 + i * 2, labelUnits[i]!)
    }
    cursor += 32
  }
  root[cursor] = 0x81
  root[cursor + 1] = 0x01
  w32le(root, cursor + 20, 3)
  w64le(root, cursor + 24, bitmapBytes)
  cursor += 32
  for (const set of fileSets) {
    if (cursor + set.byteLength > clusterSize) {
      throw new Error('fixture 预置文件/目录过多，超出单个根目录簇；请减少条目或加大簇')
    }
    root.set(set, cursor)
    cursor += set.byteLength
  }
  for (const set of dirSets) {
    if (cursor + set.byteLength > clusterSize) {
      throw new Error('fixture 预置文件/目录过多，超出单个根目录簇；请减少条目或加大簇')
    }
    root.set(set, cursor)
    cursor += set.byteLength
  }
  root[cursor] = 0x00

  /* ── MBR ── */
  if (options?.partitioned) {
    const mbr = image.subarray(0, SECTOR)
    mbr[446] = 0x80
    mbr[446 + 4] = 0x07
    w32le(mbr, 446 + 8, partitionStart)
    w32le(mbr, 446 + 12, volumeSectors)
    mbr[510] = 0x55
    mbr[511] = 0xaa
  }

  /* ── 模拟陈旧/损坏的非活动 FAT ── */
  if (numberOfFats === 2 && options?.corruptInactiveFat) {
    const inactive = activeFat === 1 ? 0 : 1
    const base = fatBases[inactive]!
    image.fill(0, base, base + fatSectors * SECTOR)
  }

  return image
}
