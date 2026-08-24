/**
 * 磁盘镜像挂载意向：手动挂上后记住，刷新后自动再挂；只有手动推出才忘掉。
 */
import { isImageLocationId, type ImageFilesLocationId } from './files-types.ts'
import { normalizeDiskImagePath } from './files-disk-image-occupancy.ts'

export const FILES_IMAGE_MOUNTS_STORAGE_KEY = 'instant-os-files-image-mounts'

export type PersistedImageMount = {
  id: ImageFilesLocationId
  imagePath: string
}

type PersistFile = {
  version: 1
  mounts: PersistedImageMount[]
}

function readRaw(): string | undefined {
  try {
    return localStorage.getItem(FILES_IMAGE_MOUNTS_STORAGE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function writeRaw(value: string): void {
  try {
    localStorage.setItem(FILES_IMAGE_MOUNTS_STORAGE_KEY, value)
  } catch {
    // 配额满时本次记住失败，不打断挂载本身
  }
}

function parseMount(value: unknown): PersistedImageMount | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as { id?: unknown; imagePath?: unknown }
  if (typeof record.id !== 'string' || !isImageLocationId(record.id)) return undefined
  if (typeof record.imagePath !== 'string') return undefined
  const imagePath = normalizeDiskImagePath(record.imagePath)
  if (!imagePath.startsWith('/')) return undefined
  return { id: record.id, imagePath }
}

function parseFile(raw: string | undefined): PersistedImageMount[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; mounts?: unknown }
    if (parsed.version !== 1 || !Array.isArray(parsed.mounts)) return []
    const mounts: PersistedImageMount[] = []
    const seenIds = new Set<string>()
    const seenPaths = new Set<string>()
    for (const item of parsed.mounts) {
      const mount = parseMount(item)
      if (!mount) continue
      if (seenIds.has(mount.id) || seenPaths.has(mount.imagePath)) continue
      seenIds.add(mount.id)
      seenPaths.add(mount.imagePath)
      mounts.push(mount)
    }
    return mounts
  } catch {
    return []
  }
}

export function listPersistedImageMounts(): PersistedImageMount[] {
  return parseFile(readRaw())
}

export function rememberImageMount(record: PersistedImageMount): void {
  const imagePath = normalizeDiskImagePath(record.imagePath)
  if (!isImageLocationId(record.id) || !imagePath.startsWith('/')) return
  const next = listPersistedImageMounts().filter(
    (item) => item.id !== record.id && item.imagePath !== imagePath,
  )
  next.push({ id: record.id, imagePath })
  const file: PersistFile = { version: 1, mounts: next }
  writeRaw(JSON.stringify(file))
}

export function forgetImageMount(id: ImageFilesLocationId): void {
  const next = listPersistedImageMounts().filter((item) => item.id !== id)
  const file: PersistFile = { version: 1, mounts: next }
  writeRaw(JSON.stringify(file))
}

export function persistedImageMountForPath(imagePath: string): PersistedImageMount | undefined {
  const normalized = normalizeDiskImagePath(imagePath)
  return listPersistedImageMounts().find((item) => item.imagePath === normalized)
}

export function resetPersistedImageMountsForTests(): void {
  try {
    localStorage.removeItem(FILES_IMAGE_MOUNTS_STORAGE_KEY)
  } catch {
    // ignore
  }
}
