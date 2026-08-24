/**
 * 磁盘工具数据层 — 树状层次结构
 *
 * 系统磁盘 → 容器（数据空间）→ 各内置卷
 *          → 挂载卷（本机文件夹 mount:）
 *          → 磁盘镜像（image:）→ 分区表 / FAT / 占用方
 *          → 废纸篓
 *
 * 底部独立区块：浏览器存储配额 / IndexedDB / localStorage 层级信息。
 * 只读；镜像解析走 files-api 的范围读取，不整读镜像。
 */
import { filesListVolumes, filesReadBlobRange, filesStat } from '../files/files-api.ts'
import {
  getDiskImageOccupant,
  type DiskImageOccupant,
} from '../files/files-disk-image-occupancy.ts'
import { listImageMounts } from '../files/files-image-mount-store.ts'
import { isImageLocationId, type FilesLocationId } from '../files/files-types.ts'
import { getFilesBytesByLocation } from '../files/files-storage.ts'
import {
  DEVICE_CAPACITY_BYTES,
  getTotalLocalStorageBytes,
} from '../../os/device-storage.ts'
import { getDataCapacityBytes, getTotalDataStorageBytes } from '../../os/device-data-storage.ts'

/* ─── 分区 / FAT 基础类型 ─── */

export type DiskPartitionInfo = {
  index: number
  startBytes: number
  sizeBytes: number
  typeByte: number
  typeLabel: string
  active: boolean
}

export type DiskFatInfo = {
  variant: 'FAT12' | 'FAT16' | 'FAT32'
  label: string
  clusterSizeBytes: number
  totalClusters: number
}

export type ImageOccupancy =
  | { kind: 'free' }
  | { kind: 'files-mount'; volumeId: string }
  | { kind: 'vm'; vmId: string }

/* ─── 树节点类型 ─── */

export type TreeNodeKind =
  | 'system-disk'      // 顶级：系统磁盘
  | 'container'        // 容器：数据存储空间
  | 'volume'           // 卷：内置 / 挂载 / 镜像
  | 'image-root'       // 镜像磁盘根
  | 'partition'        // 镜像内的分区
  | 'trash'            // 废纸篓

export type TreeNode = {
  id: string
  kind: TreeNodeKind
  label: string
  /** 子节点 */
  children?: TreeNode[]
  /** 卷字节占用 */
  bytes?: number
  /** 容器总容量（仅 system-disk / container） */
  capacityBytes?: number
  /** 是否可写 */
  writable?: boolean
  /** 卷标识 (locationId)，volume 节点才有 */
  locationId?: FilesLocationId
  /** 路径根，volume 节点才有 */
  pathRoot?: string
  /** 分区信息，partition 节点才有 */
  partition?: DiskPartitionInfo
  /** FAT 信息，volume/image-root 节点才有 */
  fat?: DiskFatInfo
  /** 镜像卷特有 */
  imageFile?: { path: string; sizeBytes: number }
  /** 镜像占用方 */
  occupancy?: ImageOccupancy
  /** 是否展开（UI 状态，数据层不关心，默认 true） */
  expanded?: boolean
  /** 所有子卷合计字节 */
  totalBytes?: number
}

/* ─── 二进制常量 ─── */

const PARTITION_TYPE_LABELS: Readonly<Record<number, string>> = {
  0x01: 'FAT12',
  0x04: 'FAT16 <32M',
  0x06: 'FAT16B',
  0x07: 'NTFS/HPFS/exFAT',
  0x0b: 'FAT32',
  0x0c: 'FAT32 LBA',
  0x0e: 'FAT16 LBA',
  0x11: '隐藏 FAT12',
  0x14: '隐藏 FAT16',
  0x16: '隐藏 FAT16B',
  0x1b: '隐藏 FAT32',
  0x1c: '隐藏 FAT32 LBA',
  0x83: 'Linux',
}

const BUILTIN_VOLUME_ORDER: readonly FilesLocationId[] = [
  'local',
  'applications',
  'dev',
  'tmp',
  'models3d',
  'source',
]

const BUILTIN_VOLUME_LABELS: Record<string, string> = {
  local: '用户文件',
  applications: '应用程序',
  dev: '开发者数据',
  tmp: '临时文件',
  models3d: '3D 模型',
  source: '系统',
  trash: '废纸篓',
}

function partitionTypeLabel(typeByte: number): string {
  const label = PARTITION_TYPE_LABELS[typeByte]
  return label ?? `未知（0x${typeByte.toString(16).padStart(2, '0')}）`
}

/* ─── 扇区读取 ─── */

async function readSectorRange(
  path: string,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  const blob = await filesReadBlobRange(path, offset, length)
  return new Uint8Array(await blob.arrayBuffer())
}

/* ─── MBR 解析 ─── */

function parseMbrPartitions(sector0: Uint8Array, diskSizeBytes: number): DiskPartitionInfo[] {
  if (sector0.length < 512) return []
  if (sector0[510] !== 0x55 || sector0[511] !== 0xaa) return []

  const partitions: DiskPartitionInfo[] = []
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

    const typeByte = sector0[base + 4]!
    const status = sector0[base]!
    const lbaStart =
      sector0[base + 8]! |
      (sector0[base + 9]! << 8) |
      (sector0[base + 10]! << 16) |
      ((sector0[base + 11]! << 24) >>> 0)
    const sectorCount =
      sector0[base + 12]! |
      (sector0[base + 13]! << 8) |
      (sector0[base + 14]! << 16) |
      ((sector0[base + 15]! << 24) >>> 0)
    if (sectorCount <= 0) continue

    partitions.push({
      index: slot + 1,
      startBytes: lbaStart * 512,
      sizeBytes: sectorCount * 512,
      typeByte,
      typeLabel: partitionTypeLabel(typeByte),
      active: status === 0x80,
    })
  }
  void diskSizeBytes
  return partitions
}

/* ─── FAT BPB 解析 ─── */

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

function parseFatBootSector(bootSector: Uint8Array): DiskFatInfo | undefined {
  if (bootSector.length < 512 || bootSector[510] !== 0x55 || bootSector[511] !== 0xaa) {
    return undefined
  }
  const bytesPerSector = u16(bootSector, 11)
  const sectorsPerCluster = bootSector[13] ?? 0
  const reservedSectors = u16(bootSector, 14)
  const fatCount = bootSector[16] ?? 0
  const rootEntries = u16(bootSector, 17)
  const totalSectors16 = u16(bootSector, 19)
  const fatSize16 = u16(bootSector, 22)
  const totalSectors32 = u32(bootSector, 32)
  const fatSize32 = u32(bootSector, 36)

  if (!bytesPerSector || !sectorsPerCluster || !fatCount) return undefined
  const totalSectors = totalSectors16 || totalSectors32
  if (!totalSectors) return undefined

  const fatSize = fatSize16 || fatSize32
  const rootDirSectors = Math.ceil((rootEntries * 32) / bytesPerSector)
  const dataStart = reservedSectors + fatCount * fatSize + rootDirSectors
  const dataSectors = totalSectors - dataStart
  const clusters = Math.floor(dataSectors / sectorsPerCluster)

  let variant: DiskFatInfo['variant']
  if (clusters < 4085) variant = 'FAT12'
  else if (clusters < 65525) variant = 'FAT16'
  else variant = 'FAT32'

  let label = ''
  if (variant === 'FAT32') {
    label = new TextDecoder('latin1')
      .decode(bootSector.subarray(71, 82))
      .trim()
  }

  return {
    variant,
    label: label.replace(/\0/g, '').trim(),
    clusterSizeBytes: bytesPerSector * sectorsPerCluster,
    totalClusters: clusters,
  }
}

/* ─── 占用方 ─── */

function occupancyFromDisk(occupant: DiskImageOccupant | undefined): ImageOccupancy {
  if (!occupant) return { kind: 'free' }
  if (occupant.kind === 'files-mount') {
    return { kind: 'files-mount', volumeId: occupant.id }
  }
  return { kind: 'vm', vmId: occupant.id }
}

/* ─── 镜像卷探测 ─── */

async function inspectImageVolume(
  record: ReturnType<typeof listImageMounts>[number],
): Promise<{ node: TreeNode; bytes: number }> {
  const stat = await filesStat(record.imagePath).catch(() => undefined)
  const sizeBytes = stat?.byteSize ?? 0
  const occupancy = occupancyFromDisk(getDiskImageOccupant(record.imagePath))

  const imageRoot: TreeNode = {
    id: record.id,
    kind: 'image-root',
    label: record.label,
    bytes: sizeBytes,
    imageFile: { path: record.imagePath, sizeBytes: sizeBytes },
    occupancy,
    children: [],
  }

  if (sizeBytes >= 512) {
    try {
      const sector0 = await readSectorRange(record.imagePath, 0, 512)
      const partitions = parseMbrPartitions(sector0, sizeBytes)

      // FAT 探测
      const candidates: Array<{ offset: number }> = []
      const firstFatPartition = partitions.find((p) => p.typeLabel.startsWith('FAT') || [0x01, 0x04, 0x06, 0x0b, 0x0c, 0x0e].includes(p.typeByte))
      if (firstFatPartition) candidates.push({ offset: firstFatPartition.startBytes })
      candidates.push({ offset: 0 })

      let fatInfo: DiskFatInfo | undefined
      for (const candidate of candidates) {
        if (candidate.offset + 512 > sizeBytes) continue
        const bootSector =
          candidate.offset === 0 ? sector0 : await readSectorRange(record.imagePath, candidate.offset, 512)
        const fat = parseFatBootSector(bootSector)
        if (fat) {
          fatInfo = fat
          break
        }
      }

      if (fatInfo) imageRoot.fat = fatInfo

      // 为每个分区生成子节点
      if (partitions.length > 0) {
        imageRoot.children = partitions.map((partition) => ({
          id: `${record.id}:part${partition.index}`,
          kind: 'partition' as const,
          label: `分区 ${partition.index}${partition.active ? '（活动）' : ''}`,
          bytes: partition.sizeBytes,
          partition,
          fat: fatInfo && partition.index === (firstFatPartition?.index ?? 1) ? fatInfo : undefined,
        }))
      }
    } catch {
      // 解析失败不影响基础信息
    }
  }

  return { node: imageRoot, bytes: sizeBytes }
}

/* ─── 路径 → locationId ─── */

function parseLocationFromPath(path: string): FilesLocationId | undefined {
  const BUILTIN_ROOTS: Record<string, FilesLocationId> = {
    '/user': 'local',
    '/Applications': 'applications',
    '/dev': 'dev',
    '/tmp': 'tmp',
    '/models': 'models3d',
    '/system': 'source',
    '/trash': 'trash',
  }
  const builtin = BUILTIN_ROOTS[path]
  if (builtin) return builtin
  if (path.startsWith('/mount/')) return `mount:${path.slice('/mount/'.length)}`
  if (path.startsWith('/media/')) return `image:${path.slice('/media/'.length)}`
  return undefined
}

/* ─── 浏览器存储 ─── */

export type BrowserStorageSnapshot = {
  persisted: boolean
  estimateSupported: boolean
  usageBytes: number | undefined
  quotaBytes: number | undefined
  systemCapacityBytes: number
  localStorageUsedBytes: number
  /** 数据空间（IndexedDB）已用字节，与设置页同一口径 */
  dataStorageUsedBytes: number
}

export async function loadBrowserStorageSnapshot(): Promise<BrowserStorageSnapshot> {
  let persisted = false
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? false
  } catch {
    persisted = false
  }

  let usageBytes: number | undefined
  let quotaBytes: number | undefined
  let estimateSupported = typeof navigator.storage?.estimate === 'function'
  if (estimateSupported) {
    try {
      const estimate = await navigator.storage.estimate()
      usageBytes = estimate.usage
      quotaBytes = estimate.quota
      if (usageBytes === undefined && quotaBytes === undefined) {
        estimateSupported = false
      }
    } catch {
      estimateSupported = false
    }
  }

  const dataStorageUsedBytes = await getTotalDataStorageBytes()

  return {
    persisted,
    estimateSupported,
    usageBytes,
    quotaBytes,
    systemCapacityBytes: getDataCapacityBytes(),
    localStorageUsedBytes: getTotalLocalStorageBytes(),
    dataStorageUsedBytes,
  }
}

export async function requestBrowserPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

/* ─── 构建树 ─── */

export async function loadDiskTree(): Promise<TreeNode> {
  const volumes = await filesListVolumes()
  const images = listImageMounts()
  const builtinAndMountVolumes = volumes.filter((v) => !v.path.startsWith('/media/'))

  const locations: FilesLocationId[] = [
    ...builtinAndMountVolumes.map((v) => parseLocationFromPath(v.path)),
    ...images.map((i) => i.id),
  ].filter((id): id is FilesLocationId => id !== undefined)

  const bytesByLocation = new Map(
    (await getFilesBytesByLocation(locations)).map((entry) => [entry.locationId, entry.bytes]),
  )

  /* ── 内置卷容器 ── */
  const builtinChildren: TreeNode[] = []
  let builtinTotalBytes = 0

  for (const locationId of BUILTIN_VOLUME_ORDER) {
    const volume = builtinAndMountVolumes.find((v) => parseLocationFromPath(v.path) === locationId)
    if (!volume) continue
    const bytes = bytesByLocation.get(locationId) ?? 0
    builtinTotalBytes += bytes
    builtinChildren.push({
      id: locationId,
      kind: 'volume',
      label: BUILTIN_VOLUME_LABELS[locationId] ?? locationId,
      bytes,
      locationId,
      pathRoot: volume.path,
      writable: volume.writable,
    })
  }

  /* ── 挂载卷 ── */
  const mountChildren: TreeNode[] = []
  let mountTotalBytes = 0

  for (const volume of builtinAndMountVolumes) {
    const locationId = parseLocationFromPath(volume.path)
    if (!locationId || !locationId.startsWith('mount:')) continue
    const bytes = bytesByLocation.get(locationId) ?? 0
    mountTotalBytes += bytes
    mountChildren.push({
      id: locationId,
      kind: 'volume',
      label: volume.label,
      bytes,
      locationId,
      pathRoot: volume.path,
      writable: volume.writable,
    })
  }

  /* ── 磁盘镜像 ── */
  const imageChildren: TreeNode[] = []
  let imageTotalBytes = 0

  for (const image of images) {
    if (!isImageLocationId(image.id)) continue
    const { node, bytes } = await inspectImageVolume(image)
    imageTotalBytes += bytes
    imageChildren.push(node)
  }

  /* ── 废纸篓 ── */
  const trashVolume = builtinAndMountVolumes.find((v) => parseLocationFromPath(v.path) === 'trash')
  const trashBytes = trashVolume ? (bytesByLocation.get('trash') ?? 0) : 0

  /* ── 树根 ── */
  const systemDiskBytes = builtinTotalBytes + mountTotalBytes + imageTotalBytes + trashBytes

  const children: TreeNode[] = []

  // 容器（内置卷集合）
  children.push({
    id: 'container:builtin',
    kind: 'container',
    label: '数据空间（IndexedDB）',
    bytes: builtinTotalBytes,
    capacityBytes: getDataCapacityBytes(),
    children: builtinChildren,
  })

  // 挂载卷容器（仅在有挂载时显示）
  if (mountChildren.length > 0) {
    children.push({
      id: 'container:mount',
      kind: 'container',
      label: '挂载卷',
      bytes: mountTotalBytes,
      children: mountChildren,
    })
  }

  // 磁盘镜像容器（仅在有镜像时显示）
  if (imageChildren.length > 0) {
    children.push({
      id: 'container:image',
      kind: 'container',
      label: '磁盘镜像',
      bytes: imageTotalBytes,
      children: imageChildren,
    })
  }

  // 废纸篓
  children.push({
    id: 'trash',
    kind: 'trash',
    label: '废纸篓',
    bytes: trashBytes,
    locationId: 'trash',
    pathRoot: '/trash',
  })

  return {
    id: 'system-disk',
    kind: 'system-disk',
    label: '系统磁盘',
    bytes: systemDiskBytes,
    capacityBytes: DEVICE_CAPACITY_BYTES,
    children,
  }
}

export { DEVICE_CAPACITY_BYTES }
