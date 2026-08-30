import { filesReadBlobRange, filesStat, filesWriteBytesRange } from './files-api.ts'
import { isDiskImageFileName } from './files-disk-image-name.ts'
import {
  diskImageOccupiedByVmError,
  getDiskImageOccupant,
  normalizeDiskImagePath,
} from './files-disk-image-occupancy.ts'
import {
  forgetImageMount,
  listPersistedImageMounts,
  rememberImageMount,
} from './files-image-mount-persist.ts'
import {
  closeImageMount,
  getImageMountByPath,
  openImageMount,
  type ImageMountRecord,
} from './files-image-mount-store.ts'
import { openQuietBlobWriter } from './files-quiet-blob-write.ts'
import { isImageLocationId, type ImageFilesLocationId } from './files-types.ts'
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
  await closeImageMount(locationId)
  forgetImageMount(locationId)
}
