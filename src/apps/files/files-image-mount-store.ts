import {
  claimDiskImagePath,
  normalizeDiskImagePath,
  releaseDiskImagePath,
} from './files-disk-image-occupancy.ts'
import { diskImageLabelFromFileName } from './files-disk-image-name.ts'
import { FatImageVolume, type ImageDiskIo } from './files-image-fat-volume.ts'
import {
  isImageLocationId,
  makeImageLocationId,
  newImageLocationKey,
  type ImageFilesLocationId,
} from './files-types.ts'

export type ImageMountRecord = {
  id: ImageFilesLocationId
  label: string
  imagePath: string
}

export const FILES_IMAGE_MOUNTS_CHANGED_EVENT = 'instant-os-files-image-mounts-changed'

type ImageMountSession = ImageMountRecord & {
  volume: FatImageVolume
}

const sessions = new Map<ImageFilesLocationId, ImageMountSession>()

function notifyImageMountsChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(FILES_IMAGE_MOUNTS_CHANGED_EVENT))
}

export function listImageMounts(): ImageMountRecord[] {
  return [...sessions.values()].map(({ id, label, imagePath }) => ({ id, label, imagePath }))
}

export function getCachedImageMount(id: string): ImageMountRecord | undefined {
  if (!isImageLocationId(id)) return undefined
  const session = sessions.get(id)
  if (!session) return undefined
  return { id: session.id, label: session.label, imagePath: session.imagePath }
}

export function getImageMountByPath(imagePath: string): ImageMountRecord | undefined {
  const normalized = normalizeDiskImagePath(imagePath)
  for (const session of sessions.values()) {
    if (session.imagePath === normalized) {
      return { id: session.id, label: session.label, imagePath: session.imagePath }
    }
  }
  return undefined
}

export function getImageVolume(id: ImageFilesLocationId): FatImageVolume {
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

  const taken = new Set<string>([...sessions.keys()])
  const key = newImageLocationKey(params.fileName, taken)
  const id = makeImageLocationId(key)
  const occupant = { kind: 'files-mount' as const, id }
  claimDiskImagePath(imagePath, occupant)
  const volume = new FatImageVolume(params.io)
  try {
    await volume.prepare()
  } catch (error) {
    releaseDiskImagePath(imagePath, occupant)
    throw error
  }
  const record: ImageMountSession = {
    id,
    label: diskImageLabelFromFileName(params.fileName),
    imagePath,
    volume,
  }
  sessions.set(id, record)
  notifyImageMountsChanged()
  return { id: record.id, label: record.label, imagePath: record.imagePath }
}

export async function closeImageMount(id: ImageFilesLocationId): Promise<void> {
  const session = sessions.get(id)
  if (!session) return
  try {
    await session.volume.flush()
  } finally {
    sessions.delete(id)
    releaseDiskImagePath(session.imagePath, { kind: 'files-mount', id })
    notifyImageMountsChanged()
  }
}

export function resetImageMountsForTests(): void {
  for (const session of sessions.values()) {
    releaseDiskImagePath(session.imagePath, { kind: 'files-mount', id: session.id })
  }
  sessions.clear()
}
