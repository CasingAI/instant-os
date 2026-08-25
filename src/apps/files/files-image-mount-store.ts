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
  makeImageLocationId,
  newImageLocationKey,
  type ImageFilesLocationId,
} from './files-types.ts'
import type { ImageVolume } from './files-image-volume.ts'

export type ImageMountRecord = {
  id: ImageFilesLocationId
  label: string
  imagePath: string
  unreadableReason?: string
}

export const FILES_IMAGE_MOUNTS_CHANGED_EVENT = 'instant-os-files-image-mounts-changed'

type ImageMountSession = ImageMountRecord & {
  volume: ImageVolume
}

const sessions = new Map<ImageFilesLocationId, ImageMountSession>()

function notifyImageMountsChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(FILES_IMAGE_MOUNTS_CHANGED_EVENT))
}

export function listImageMounts(): ImageMountRecord[] {
  return [...sessions.values()].map(({ id, label, imagePath, unreadableReason }) => ({
    id,
    label,
    imagePath,
    unreadableReason,
  }))
}

export function getCachedImageMount(id: string): ImageMountRecord | undefined {
  if (!isImageLocationId(id)) return undefined
  const session = sessions.get(id)
  if (!session) return undefined
  return { id: session.id, label: session.label, imagePath: session.imagePath, unreadableReason: session.unreadableReason }
}

export function getImageMountByPath(imagePath: string): ImageMountRecord | undefined {
  const normalized = normalizeDiskImagePath(imagePath)
  for (const session of sessions.values()) {
    if (session.imagePath === normalized) {
      return { id: session.id, label: session.label, imagePath: session.imagePath, unreadableReason: session.unreadableReason }
    }
  }
  return undefined
}

export function getImageMountReadError(id: ImageFilesLocationId): string | undefined {
  return sessions.get(id)?.unreadableReason
}

export function getImageVolume(id: ImageFilesLocationId): ImageVolume {
  const session = sessions.get(id)
  if (!session) {
    throw new Error('磁盘镜像未挂载')
  }
  return session.volume
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
  for (const item of persisted) {
    if (item.imagePath !== imagePath) taken.add(item.id)
  }
  const remembered = persisted.find((item) => item.imagePath === imagePath)
  const id =
    remembered && !taken.has(remembered.id)
      ? remembered.id
      : makeImageLocationId(newImageLocationKey(params.fileName, taken))
  const occupant = { kind: 'files-mount' as const, id }
  claimDiskImagePath(imagePath, occupant)
  // 探测顺序：先 FAT（保持既有行为），失败再试 exFAT（分区类型 0x07 与 NTFS 同值，
  // 只能靠引导区签名区分，见 ExfatImageVolume.detectBaseOffset）
  const fatVolume = new FatImageVolume(params.io)
  let volume: ImageVolume = fatVolume
  let unreadableReason: string | undefined
  try {
    await fatVolume.prepare()
  } catch (fatError) {
    const exfatVolume = new ExfatImageVolume(params.io)
    try {
      await exfatVolume.prepare()
      volume = exfatVolume
    } catch {
      volume = fatVolume
      unreadableReason = fatError instanceof Error ? fatError.message : String(fatError)
    }
  }
  const record: ImageMountSession = {
    id,
    label: diskImageLabelFromFileName(params.fileName),
    imagePath,
    volume,
    unreadableReason,
  }
  sessions.set(id, record)
  notifyImageMountsChanged()
  return { id: record.id, label: record.label, imagePath: record.imagePath, unreadableReason }
}

export async function closeImageMount(id: ImageFilesLocationId): Promise<void> {
  const session = sessions.get(id)
  if (!session) return
  try {
    await session.volume.close()
  } finally {
    sessions.delete(id)
    releaseDiskImagePath(session.imagePath, { kind: 'files-mount', id })
    notifyImageMountsChanged()
  }
}

export async function resetImageMountsForTests(): Promise<void> {
  const ids = [...sessions.keys()]
  for (const id of ids) {
    await closeImageMount(id).catch(() => undefined)
  }
  sessions.clear()
}
