import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import { hostnameFromUrl } from '../browser/normalize-browser-url.ts'

export type ChromoBookmark = {
  url: string
  title: string
}

type BookmarkStore = {
  items: ChromoBookmark[]
}

type ChromoSettings = {
  bookmarksBarVisible: boolean
}

const BOOKMARKS_KEY = DEVICE_STORAGE_KEYS.chromoBookmarks
const SETTINGS_KEY = DEVICE_STORAGE_KEYS.chromoSettings
const MAX_BOOKMARKS = 64

const DEFAULT_BOOKMARKS: ChromoBookmark[] = [
  { url: 'https://www.google.com/', title: 'Google' },
  { url: 'https://github.com/', title: 'GitHub' },
  { url: 'https://zh.wikipedia.org/', title: 'Wikipedia' },
  { url: 'https://developer.mozilla.org/', title: 'MDN' },
]

const DEFAULT_SETTINGS: ChromoSettings = {
  bookmarksBarVisible: true,
}

export function normalizeChromoBookmarkUrl(input: string): string | undefined {
  const trimmed = input.trim()
  if (!trimmed) {
    return undefined
  }

  let candidate = trimmed
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    candidate = `https://${candidate}`
  }

  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined
    }
    if (parsed.hostname === 'ithome.com') {
      parsed.hostname = 'www.ithome.com'
    }
    return parsed.href
  } catch {
    return undefined
  }
}

function defaultBookmarkStore(): BookmarkStore {
  return {
    items: DEFAULT_BOOKMARKS.map((item) => ({
      url: normalizeChromoBookmarkUrl(item.url) ?? item.url,
      title: item.title,
    })),
  }
}

function loadBookmarkStore(): BookmarkStore {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY)
    if (!raw) {
      return defaultBookmarkStore()
    }

    const parsed = JSON.parse(raw) as Partial<BookmarkStore>
    if (!Array.isArray(parsed.items)) {
      return defaultBookmarkStore()
    }

    const items = parsed.items
      .filter(
        (item): item is ChromoBookmark =>
          Boolean(item) && typeof item.url === 'string' && typeof item.title === 'string',
      )
      .map((item) => {
        const url = normalizeChromoBookmarkUrl(item.url)
        if (!url) {
          return undefined
        }
        return {
          url,
          title: item.title.trim() || hostnameFromUrl(url) || url,
        }
      })
      .filter((item): item is ChromoBookmark => Boolean(item))

    return { items }
  } catch {
    return defaultBookmarkStore()
  }
}

function saveBookmarkStore(store: BookmarkStore): boolean {
  return writeLocalStorageItem(BOOKMARKS_KEY, JSON.stringify(store))
}

function loadSettings(): ChromoSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) {
      return { ...DEFAULT_SETTINGS }
    }
    const parsed = JSON.parse(raw) as Partial<ChromoSettings>
    return {
      bookmarksBarVisible: parsed.bookmarksBarVisible !== false,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function saveSettings(settings: ChromoSettings): boolean {
  return writeLocalStorageItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function loadChromoBookmarks(): ChromoBookmark[] {
  return loadBookmarkStore().items
}

export function loadChromoBookmarksBarVisible(): boolean {
  return loadSettings().bookmarksBarVisible
}

export function setChromoBookmarksBarVisible(visible: boolean): void {
  saveSettings({ ...loadSettings(), bookmarksBarVisible: visible })
}

export function isChromoBookmarked(url: string): boolean {
  const normalized = normalizeChromoBookmarkUrl(url)
  if (!normalized) {
    return false
  }
  return loadBookmarkStore().items.some((item) => item.url === normalized)
}

export function addChromoBookmark(bookmark: { url: string; title: string }): boolean {
  const url = normalizeChromoBookmarkUrl(bookmark.url)
  if (!url) {
    return false
  }

  const title = bookmark.title.trim() || hostnameFromUrl(url) || url
  const store = loadBookmarkStore()
  if (store.items.some((item) => item.url === url)) {
    return false
  }

  return saveBookmarkStore({
    items: [{ url, title }, ...store.items].slice(0, MAX_BOOKMARKS),
  })
}

export function removeChromoBookmark(url: string): void {
  const normalized = normalizeChromoBookmarkUrl(url)
  if (!normalized) {
    return
  }
  const store = loadBookmarkStore()
  saveBookmarkStore({ items: store.items.filter((item) => item.url !== normalized) })
}

export function toggleChromoBookmark(bookmark: { url: string; title: string }): boolean {
  if (isChromoBookmarked(bookmark.url)) {
    removeChromoBookmark(bookmark.url)
    return false
  }
  return addChromoBookmark(bookmark)
}

export function chromoBookmarkGlyph(bookmark: Pick<ChromoBookmark, 'url' | 'title'>): string {
  const label = bookmark.title.trim() || hostnameFromUrl(bookmark.url)
  return (label.charAt(0) || '?').toUpperCase()
}
