import { filesReadBlobRange, filesStat, filesWriteBytesRange } from './files-api.ts'
import { isDiskImageFileName } from './files-disk-image-name.ts'
import { normalizeDiskImagePath } from './files-disk-image-occupancy.ts'
import {
  closeImageMount,
  getImageMountByPath,
  openImageMount,
  type ImageMountRecord,
} from './files-image-mount-store.ts'
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

export async function mountDiskImage(imagePath: string): Promise<ImageMountRecord> {
  const path = normalizeDiskImagePath(imagePath)
  assertInternalImagePath(path)
  const existing = getImageMountByPath(path)
  if (existing) return existing
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
  return openImageMount({
    imagePath: path,
    fileName: stat.name || fileNameFromPath(path),
    io: {
      size: stat.byteSize,
      async read(offset, length) {
        const blob = await filesReadBlobRange(path, offset, length)
        return new Uint8Array(await blob.arrayBuffer())
      },
      async write(offset, data) {
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
    },
  })
}

export async function unmountDiskImage(locationId: ImageFilesLocationId): Promise<void> {
  if (!isImageLocationId(locationId)) {
    throw new Error('不是磁盘镜像卷')
  }
  await closeImageMount(locationId)
}
