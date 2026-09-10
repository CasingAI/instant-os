import { filesReadBlobRange, filesStat, filesWriteBytesRange } from './files-api.ts'
import { isDiskImageFileName } from './files-disk-image-name.ts'
import {
  diskImageOccupiedByVmError,
  getDiskImageOccupant,
  normalizeDiskImagePath,
} from './files-disk-image-occupancy.ts'
import {
  forgetImageMount,
  forgetImageMountsByPath,
  listPersistedImageMounts,
  persistedImageMountForPath,
  rememberImageMount,
} from './files-image-mount-persist.ts'
import {
  closeImageMount,
  closeImageMountsByPath,
  drainImageMountWrites,
  getCachedImageMount,
  getImageMountByPath,
  getImageMountsByPath,
  imageMountPendingWork,
  openImageMount,
  type ImageMountRecord,
} from './files-image-mount-store.ts'
import { openQuietBlobWriter } from './files-quiet-blob-write.ts'
import {
  isImageLocationId,
  isImagePartitionLocationId,
  makeImageLocationId,
  parseImagePartitionLocationId,
  type ImageFilesLocationId,
} from './files-types.ts'
import { parseFilesAbsolutePath } from './files-path.ts'

export { isDiskImageFileName }

const RANGE_CHUNK = 1024 * 1024

function assertInternalImagePath(path: string): void {
  const parsed = parseFilesAbsolutePath(path)
  if (!parsed) {
    throw new Error('只能挂载系统内部的磁盘镜像文件')
  }
  if (parsed.locationId !== 'local' && parsed.locationId !== 'dev' && parsed.locationId !== 'tmp') {
    throw new Error('磁盘镜像请放到用户文件、开发者数据或临时文件中再挂载')
  }
}

function fileNameFromPath(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(slash + 1) : path
}

let restorePromise: Promise<void> | undefined
let restoring = false

export function restorePersistedImageMounts(): Promise<void> {
  if (restorePromise) return restorePromise
  restorePromise = (async () => {
    restoring = true
    try {
      const remembered = listPersistedImageMounts()
      for (const item of remembered) {
        if (getImageMountByPath(item.imagePath)) continue
        // 恢复途中可能已被手动推出：以最新意向列表为准，旧快照里的不再挂
        if (!persistedImageMountForPath(item.imagePath)) continue
        try {
          await mountDiskImage(item.imagePath)
        } catch {
          // 文件暂时不可读或被虚拟机占用时保留记录，下次启动再试
        }
      }
    } finally {
      restoring = false
    }
  })()
  return restorePromise
}

export function resetImageMountRestoreForTests(): void {
  restorePromise = undefined
  restoring = false
}

export async function mountDiskImage(imagePath: string): Promise<ImageMountRecord> {
  if (!restoring) await restorePersistedImageMounts()
  const path = normalizeDiskImagePath(imagePath)
  assertInternalImagePath(path)
  const existing = getImageMountByPath(path)
  if (existing) {
    rememberImageMount({ id: existing.id, imagePath: existing.imagePath })
    return existing
  }
  const stat = await filesStat(path)
  if (!stat || stat.kind !== 'file') {
    throw new Error('镜像文件不存在')
  }
  if (!isDiskImageFileName(stat.name) && !isDiskImageFileName(fileNameFromPath(path))) {
    throw new Error('请选择 .img / .raw 等磁盘镜像文件')
  }
  if (stat.byteSize < 512) {
    throw new Error('镜像太小，不像有效的磁盘映像')
  }
  // 先查占用：VM 可写附加会独占镜像的 OPFS 写句柄，先开写通道只会漏出底层锁定错误
  if (getDiskImageOccupant(path)?.kind === 'vm') {
    throw new Error(diskImageOccupiedByVmError(path))
  }
  const quietWriter = await openQuietBlobWriter(path)
  try {
    const record = await openImageMount({
      imagePath: path,
      fileName: stat.name || fileNameFromPath(path),
      io: {
        size: stat.byteSize,
        async read(offset, length) {
          const blob = await filesReadBlobRange(path, offset, length)
          return new Uint8Array(await blob.arrayBuffer())
        },
        async write(offset, data) {
          if (quietWriter) {
            await quietWriter.writeAt(offset, data)
            return
          }
          let cursor = 0
          while (cursor < data.byteLength) {
            const take = Math.min(RANGE_CHUNK, data.byteLength - cursor)
            const slice = data.subarray(cursor, cursor + take)
            const copy = new Uint8Array(take)
            copy.set(slice)
            await filesWriteBytesRange(path, offset + cursor, copy)
            cursor += take
          }
        },
        async flush() {
          if (quietWriter) {
            await quietWriter.flush()
          }
        },
        async close() {
          if (quietWriter) {
            await quietWriter.close()
          }
        },
      },
    })
    rememberImageMount({ id: record.id, imagePath: record.imagePath })
    return record
  } catch (error) {
    // 挂载失败必须交还 OPFS 写会话，否则泄漏的独占句柄会卡住虚拟机回写
    await quietWriter?.abort().catch(() => undefined)
    throw error
  }
}

export async function unmountDiskImage(locationId: ImageFilesLocationId): Promise<void> {
  if (!isImageLocationId(locationId)) {
    throw new Error('不是磁盘镜像卷')
  }
  const mounted = getCachedImageMount(locationId) ?? getImageMountByPath(locationId)
  if (mounted) {
    // 推出任意分区卷 = 推出整盘：分区 id 按 id 忘记删不到锚点意向，必须按整盘路径忘记
    await closeImageMountsByPath(mounted.imagePath)
    forgetImageMountsByPath(mounted.imagePath)
    return
  }
  await closeImageMount(locationId)
  // 会话已不在时的兜底：分区 id 换算回锚点 id 再忘记，与级联语义一致
  const partition = parseImagePartitionLocationId(locationId)
  forgetImageMount(partition ? makeImageLocationId(partition.imageKey) : locationId)
}

/** 该镜像卷位置上还有多少在途写入任务；推出前的拦截判断用 */
export function imageMountPendingWorkForLocation(locationId: ImageFilesLocationId): number {
  if (!isImageLocationId(locationId)) return 0
  const mounted = getCachedImageMount(locationId) ?? getImageMountByPath(locationId)
  if (!mounted) return 0
  return imageMountPendingWork(mounted.imagePath)
}

/** 等该镜像卷位置的在途写入全部完成（拷贝仍在推进时会持续等待） */
export async function drainImageMountWritesForLocation(locationId: ImageFilesLocationId): Promise<void> {
  if (!isImageLocationId(locationId)) return
  const mounted = getCachedImageMount(locationId) ?? getImageMountByPath(locationId)
  if (!mounted) return
  await drainImageMountWrites(mounted.imagePath)
}

/**
 * 挂载后应浏览的位置：有分区则取分区号最小、真正挂上且可浏览的分区；
 * 无分区表（整盘一个文件系统）取整盘卷。整盘占位（isPartitionAnchor）不会
 * 出现在侧栏容器里，永远不作为浏览目标；分区全不可读时返回 undefined，由调用方报错。
 */
export function firstBrowsableImageLocation(imagePath: string): ImageFilesLocationId | undefined {
  const sessions = getImageMountsByPath(imagePath)
  const partitions = sessions
    .filter((item) => isImagePartitionLocationId(item.id))
    .sort((a, b) => {
      const left = parseImagePartitionLocationId(a.id)?.partition ?? 0
      const right = parseImagePartitionLocationId(b.id)?.partition ?? 0
      return left - right
    })
  const readablePartition = partitions.find((item) => !item.unreadableReason)
  if (readablePartition) return readablePartition.id
  const wholeDisk = sessions.find((item) => !isImagePartitionLocationId(item.id) && !item.isPartitionAnchor)
  if (wholeDisk && !wholeDisk.unreadableReason) return wholeDisk.id
  return undefined
}

