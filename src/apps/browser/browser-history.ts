import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import { osNowMs } from '../../os/os-clock.ts'
import { isStartPageUrl, normalizeBrowserUrl } from './normalize-browser-url.ts'

export type HistoryVisitRecord = {
  url: string
  title: string
  visitedAt: number
}

type HistoryStore = {
  visits: HistoryVisitRecord[]
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.safariHistory
const MAX_VISITS = 500

function emptyStore(): HistoryStore {
  return { visits: [] }
}

function loadStore(): HistoryStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return emptyStore()
    }
    const parsed = JSON.parse(raw) as HistoryStore
    if (!Array.isArray(parsed.visits)) {
      return emptyStore()
    }
    return parsed
  } catch {
    return emptyStore()
  }
}

function saveStore(store: HistoryStore): boolean {
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(store))
}

export function recordBrowserHistoryVisit(visit: { url: string; title: string }): void {
  if (isStartPageUrl(visit.url)) {
    return
  }

  const url = normalizeBrowserUrl(visit.url)
  const title = visit.title.trim() || url
  const visitedAt = osNowMs()
  const store = loadStore()

  const withoutDuplicate = store.visits.filter((entry) => entry.url !== url)
  const nextVisits = [{ url, title, visitedAt }, ...withoutDuplicate].slice(0, MAX_VISITS)

  saveStore({ visits: nextVisits })
}

export function loadBrowserHistory(): HistoryVisitRecord[] {
  return loadStore().visits
}

export function clearBrowserHistory(): void {
  saveStore(emptyStore())
}

export function removeBrowserHistoryVisit(url: string): void {
  const normalized = normalizeBrowserUrl(url)
  const store = loadStore()
  saveStore({
    visits: store.visits.filter((entry) => entry.url !== normalized),
  })
}

export function getBrowserHistoryStorageBytes(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return 0
    }
    return new TextEncoder().encode(raw).length
  } catch {
    return 0
  }
}
