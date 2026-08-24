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
  unreadableReason?: string
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
  let unreadableReason: string | undefined
  try {
    await volume.prepare()
  } catch (error) {
    unreadableReason = error instanceof Error ? error.message : String(error)
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
