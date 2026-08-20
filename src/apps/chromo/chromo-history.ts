import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import { osNowMs } from '../../os/os-clock.ts'
import { hostnameFromUrl } from '../browser/normalize-browser-url.ts'
import { normalizeChromoBookmarkUrl } from './chromo-bookmarks.ts'

export type ChromoHistoryVisit = {
  url: string
  title: string
  visitedAt: number
}

type HistoryStore = {
  visits: ChromoHistoryVisit[]
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.chromoHistory
const MAX_VISITS = 500

function emptyStore(): HistoryStore {
  return { visits: [] }
}

function isChromoHistoryVisit(value: unknown): value is ChromoHistoryVisit {
  if (!value || typeof value !== 'object') {
    return false
  }
  const visit = value as Partial<ChromoHistoryVisit>
  return (
    typeof visit.url === 'string' &&
    typeof visit.title === 'string' &&
    typeof visit.visitedAt === 'number' &&
    Number.isFinite(visit.visitedAt)
  )
}

function loadStore(): HistoryStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return emptyStore()
    }
    const parsed = JSON.parse(raw) as Partial<HistoryStore>
    if (!Array.isArray(parsed.visits)) {
      return emptyStore()
    }
    return {
      visits: parsed.visits.filter(isChromoHistoryVisit).slice(0, MAX_VISITS),
    }
  } catch {
    return emptyStore()
  }
}

function saveStore(store: HistoryStore): boolean {
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(store))
}

export function recordChromoHistoryVisit(visit: { url: string; title: string }): boolean {
  const url = normalizeChromoBookmarkUrl(visit.url)
  if (!url) {
    return false
  }

  const title = visit.title.trim() || hostnameFromUrl(url) || url
  const visitedAt = osNowMs()
  const store = loadStore()
  const nextVisits = [{ url, title, visitedAt }, ...store.visits.filter((entry) => entry.url !== url)].slice(
    0,
    MAX_VISITS,
  )

  return saveStore({ visits: nextVisits })
}

export function loadChromoHistory(): ChromoHistoryVisit[] {
  return loadStore().visits
}

export function removeChromoHistoryVisit(url: string): void {
  const normalized = normalizeChromoBookmarkUrl(url)
  if (!normalized) {
    return
  }
  const store = loadStore()
  saveStore({
    visits: store.visits.filter((entry) => entry.url !== normalized),
  })
}

export function clearChromoHistory(): void {
  saveStore(emptyStore())
}
