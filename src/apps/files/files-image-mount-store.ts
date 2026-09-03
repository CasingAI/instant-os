import {
  claimDiskImagePath,
  normalizeDiskImagePath,
  releaseDiskImagePath,
} from './files-disk-image-occupancy.ts'
import { diskImageLabelFromFileName } from './files-disk-image-name.ts'
import { ExfatImageVolume } from './files-image-exfat-volume.ts'
import { FatImageVolume, type ImageDiskIo } from './files-image-fat-volume.ts'
import { listPersistedImageMounts } from './files-image-mount-persist.ts'
import {
  isImageLocationId,
  isImagePartitionLocationId,
  makeImageLocationId,
  makeImagePartitionLocationId,
  newImageLocationKey,
  type ImageFilesLocationId,
} from './files-types.ts'
import {
  partitionByteOffset,
  scanImagePartitions,
  type ImagePartitionEntry,
} from './files-image-partition.ts'
import type { ImageVolume } from './files-image-volume.ts'

export type ImageMountRecord = {
  id: ImageFilesLocationId
  label: string
  imagePath: string
  unreadableReason?: string
  partition?: ImagePartitionEntry
  /** 多分区镜像的占位锚点，不是可浏览卷。 */
  isPartitionAnchor?: boolean
}

export const FILES_IMAGE_MOUNTS_CHANGED_EVENT = 'instant-os-files-image-mounts-changed'

type ImageMountSession = ImageMountRecord & { volume?: ImageVolume }

const sessions = new Map<ImageFilesLocationId, ImageMountSession>()

function notifyImageMountsChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(FILES_IMAGE_MOUNTS_CHANGED_EVENT))
}

function publicRecord(session: ImageMountSession): ImageMountRecord {
  const { id, label, imagePath, unreadableReason, partition, isPartitionAnchor } = session
  return { id, label, imagePath, unreadableReason, partition, isPartitionAnchor }
}

export function listImageMounts(): ImageMountRecord[] {
  return [...sessions.values()].map(publicRecord)
}

export function getCachedImageMount(id: string): ImageMountRecord | undefined {
  if (!isImageLocationId(id)) return undefined
  const session = sessions.get(id)
  return session ? publicRecord(session) : undefined
}

export function getImageMountByPath(imagePath: string): ImageMountRecord | undefined {
  const normalized = normalizeDiskImagePath(imagePath)
  for (const session of sessions.values()) {
    if (session.imagePath === normalized && !isImagePartitionLocationId(session.id)) {
      return publicRecord(session)
    }
  }
  return undefined
}

export function getImageMountsByPath(imagePath: string): ImageMountRecord[] {
  const normalized = normalizeDiskImagePath(imagePath)
  return [...sessions.values()].filter((s) => s.imagePath === normalized).map(publicRecord)
}

export function getImageMountReadError(id: ImageFilesLocationId): string | undefined {
  return sessions.get(id)?.unreadableReason
}

export function getImageVolume(id: ImageFilesLocationId): ImageVolume {
  const session = sessions.get(id)
  if (!session?.volume) {
    throw new Error(session?.isPartitionAnchor ? '多分区镜像没有可直接浏览的整盘卷，请选择具体分区' : '磁盘镜像未挂载')
  }
  return session.volume
}

const FAT_PARTITION_TYPES = new Set([
  0x01, 0x04, 0x06, 0x0b, 0x0c, 0x0e, 0x11, 0x14, 0x16, 0x1b, 0x1c,
])

async function preparePartitionVolume(
  io: ImageDiskIo,
  partition: ImagePartitionEntry,
): Promise<ImageVolume | undefined> {
  const baseOffset = partitionByteOffset(partition)
  const partitionBytes = partition.sectorCount * 512
  // FAT 类型字节先交给 libmount 实测（簇数几何以 libmount 口径为准）；
  // exFAT 由引导区签名确认。
  if (FAT_PARTITION_TYPES.has(partition.partitionType)) {
    const volume = new FatImageVolume(io, { baseOffset, capacityBytes: partitionBytes })
    await volume.prepare()
    return volume
  }
  if (partition.fsType === 'exFAT') {
    const volume = new ExfatImageVolume(io, { baseOffset, capacityBytes: partitionBytes })
    await volume.prepare()
    return volume
  }
  return undefined
}

export async function openImageMount(params: {
  imagePath: string
  fileName: string
  io: ImageDiskIo
}): Promise<ImageMountRecord> {
  const imagePath = normalizeDiskImagePath(params.imagePath)
  const existing = getImageMountByPath(imagePath)
  if (existing) return existing

  const persisted = listPersistedImageMounts()
  const taken = new Set<string>([...sessions.keys()])
  for (const item of persisted) if (item.imagePath !== imagePath) taken.add(item.id)
  const remembered = persisted.find((item) => item.imagePath === imagePath)
  const id = remembered && !taken.has(remembered.id)
    ? remembered.id
    : makeImageLocationId(newImageLocationKey(params.fileName, taken))
  claimDiskImagePath(imagePath, { kind: 'files-mount', id })
  const label = diskImageLabelFromFileName(params.fileName)

  try {
    const table = await scanImagePartitions(params.io)
    if (table.validMbr && table.partitions.length > 0) {
      let compatibilityVolume: ImageVolume | undefined
      const anchor: ImageMountSession = {
        id,
        label,
        imagePath,
        isPartitionAnchor: true,
      }
      sessions.set(id, anchor)
      for (const partition of table.partitions) {
        try {
          const volume = await preparePartitionVolume(params.io, partition)
          if (!volume) continue
          if (!compatibilityVolume) compatibilityVolume = volume
          const partId = makeImagePartitionLocationId(id.slice('image:'.length), partition.slot)
          sessions.set(partId, {
            id: partId,
            label: `${label} · 分区${partition.slot}`,
            imagePath,
            partition,
            volume,
          })
        } catch {
          // 单个损坏/不支持分区不应阻塞同镜像其它分区挂载。
        }
      }
      if (compatibilityVolume) {
        // 保留旧 API 的锚点根路径兼容性：旧调用仍可读写首个可识别分区；新 UI 使用独立 part<N> 卷。
        anchor.volume = compatibilityVolume
      } else {
        anchor.unreadableReason = '多分区镜像没有可识别的文件系统'
      }
      notifyImageMountsChanged()
      return publicRecord(anchor)
    }

    let volume: ImageVolume = new FatImageVolume(params.io)
    let unreadableReason: string | undefined
    try {
      await volume.prepare()
    } catch (fatError) {
      const exfat = new ExfatImageVolume(params.io)
      try {
        await exfat.prepare()
        volume = exfat
      } catch {
        unreadableReason = fatError instanceof Error ? fatError.message : String(fatError)
      }
    }
    const record: ImageMountSession = { id, label, imagePath, volume, unreadableReason }
    sessions.set(id, record)
    notifyImageMountsChanged()
    return publicRecord(record)
  } catch (error) {
    releaseDiskImagePath(imagePath, { kind: 'files-mount', id })
    throw error
  }
}

export async function closeImageMountsByPath(imagePath: string): Promise<void> {
  const normalized = normalizeDiskImagePath(imagePath)
  const targets = [...sessions.values()].filter((s) => s.imagePath === normalized)
  const closedVolumes = new Set<ImageVolume>()
  for (const session of targets) {
    try {
      if (session.volume && !closedVolumes.has(session.volume)) {
        closedVolumes.add(session.volume)
        // 先上门控再 close：close 内部会排空已入队任务；门控保证排空期间
        // 不会有新写入插进来（新来的拷贝直接报「正在推出」，绝不静默丢数据）
        session.volume.beginClose()
        await session.volume.close()
      }
    } finally { sessions.delete(session.id) }
  }
  const anchor = targets.find((s) => !isImagePartitionLocationId(s.id))
  if (anchor) releaseDiskImagePath(normalized, { kind: 'files-mount', id: anchor.id })
  if (targets.length > 0) notifyImageMountsChanged()
}

/** 该路径镜像卷上已入队尚未完成的任务数；多分区共享同一卷时不重复计 */
export function imageMountPendingWork(imagePath: string): number {
  const normalized = normalizeDiskImagePath(imagePath)
  const seen = new Set<ImageVolume>()
  let total = 0
  for (const session of sessions.values()) {
    if (session.imagePath !== normalized || !session.volume || seen.has(session.volume)) continue
    seen.add(session.volume)
    total += session.volume.pendingWorkCount
  }
  return total
}

/**
 * 等该路径镜像卷上的在途写入全部完成（拷贝仍在推进时会持续等待）。
 * 推出前的拦截用：等待期间新到的写入也会被纳入，直到归零才返回。
 */
export async function drainImageMountWrites(imagePath: string): Promise<void> {
  while (imageMountPendingWork(imagePath) > 0) {
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

export async function closeImageMount(id: ImageFilesLocationId): Promise<void> {
  const session = sessions.get(id)
  if (!session) return
  if (!isImagePartitionLocationId(id)) {
    await closeImageMountsByPath(session.imagePath)
    return
  }
  try { await session.volume?.close() } finally {
    sessions.delete(id)
    notifyImageMountsChanged()
  }
}

export async function resetImageMountsForTests(): Promise<void> {
  const paths = [...new Set([...sessions.values()].map((s) => s.imagePath))]
  for (const path of paths) await closeImageMountsByPath(path).catch(() => undefined)
  sessions.clear()
}
