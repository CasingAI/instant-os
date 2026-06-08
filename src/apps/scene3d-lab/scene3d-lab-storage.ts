import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import type { LiveTokenUsage } from '../browser/estimate-token-usage.ts'

export type Scene3dLabArchive = {
  id: string
  title: string
  prompt: string
  html: string
  rawText: string
  savedAt: number
  usage: LiveTokenUsage
}

type Scene3dLabArchiveStore = {
  archives: Scene3dLabArchive[]
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.scene3dLabArchives
const MAX_ARCHIVES = 40

function emptyStore(): Scene3dLabArchiveStore {
  return { archives: [] }
}

function loadStore(): Scene3dLabArchiveStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return emptyStore()
    }
    const parsed = JSON.parse(raw) as Scene3dLabArchiveStore
    if (!Array.isArray(parsed.archives)) {
      return emptyStore()
    }
    return {
      archives: parsed.archives.filter(isValidArchive),
    }
  } catch {
    return emptyStore()
  }
}

function saveStore(store: Scene3dLabArchiveStore): boolean {
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(store))
}

function isValidArchive(value: unknown): value is Scene3dLabArchive {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Partial<Scene3dLabArchive>
  return (
    typeof record.id === 'string' &&
    typeof record.title === 'string' &&
    typeof record.prompt === 'string' &&
    typeof record.html === 'string' &&
    typeof record.rawText === 'string' &&
    typeof record.savedAt === 'number'
  )
}

export function loadScene3dLabArchives(): Scene3dLabArchive[] {
  return loadStore().archives.sort((left, right) => right.savedAt - left.savedAt)
}

export function defaultArchiveTitle(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, ' ')
  if (!trimmed) {
    return '未命名场景'
  }
  return trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed
}

export type SaveScene3dLabArchiveInput = {
  title: string
  prompt: string
  html: string
  rawText: string
  usage: LiveTokenUsage
}

export function saveScene3dLabArchive(input: SaveScene3dLabArchiveInput): Scene3dLabArchive | undefined {
  const html = input.html.trim()
  if (!html) {
    return undefined
  }

  const title = input.title.trim() || defaultArchiveTitle(input.prompt)
  const archive: Scene3dLabArchive = {
    id: `scene3d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    prompt: input.prompt,
    html,
    rawText: input.rawText,
    savedAt: Date.now(),
    usage: input.usage,
  }

  const store = loadStore()
  const nextArchives = [archive, ...store.archives.filter((entry) => entry.id !== archive.id)].slice(
    0,
    MAX_ARCHIVES,
  )
  const saved = saveStore({ archives: nextArchives })
  return saved ? archive : undefined
}

export function removeScene3dLabArchive(id: string): void {
  const store = loadStore()
  saveStore({
    archives: store.archives.filter((entry) => entry.id !== id),
  })
}

export function clearScene3dLabArchives(): void {
  saveStore(emptyStore())
}
