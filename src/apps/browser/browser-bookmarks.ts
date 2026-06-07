import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import { hostnameFromUrl, isStartPageUrl, normalizeBrowserUrl } from './normalize-browser-url.ts'

export type BrowserBookmark = {
  url: string
  title: string
  emoji: string | undefined
  color: string | undefined
}

type BookmarkStore = {
  items: BrowserBookmark[]
  barVisible: boolean
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.safariBookmarks
const MAX_BOOKMARKS = 64

const DEFAULT_BOOKMARKS: BrowserBookmark[] = [
  { url: 'https://www.apple.com', title: 'Apple', emoji: '🍎', color: '#1d1d1f' },
  { url: 'https://www.google.com', title: 'Google', emoji: 'G', color: '#4285f4' },
  { url: 'https://github.com', title: 'GitHub', emoji: '⌘', color: '#24292f' },
  { url: 'https://zh.wikipedia.org', title: '维基百科', emoji: 'W', color: '#3366cc' },
  { url: 'https://www.zhihu.com', title: '知乎', emoji: '知', color: '#0066ff' },
  { url: 'https://www.bilibili.com', title: 'Bilibili', emoji: 'B', color: '#fb7299' },
  { url: 'https://www.taobao.com', title: '淘宝', emoji: '淘', color: '#ff5000' },
  { url: 'https://weibo.com', title: '微博', emoji: '微', color: '#e6162d' },
]

function defaultStore(): BookmarkStore {
  return {
    items: DEFAULT_BOOKMARKS.map((item) => ({ ...item, url: normalizeBrowserUrl(item.url) })),
    barVisible: true,
  }
}

function loadStore(): BookmarkStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return defaultStore()
    }

    const parsed = JSON.parse(raw) as Partial<BookmarkStore>
    if (!Array.isArray(parsed.items)) {
      return defaultStore()
    }

    const items = parsed.items
      .filter(
        (item): item is BrowserBookmark =>
          Boolean(item) &&
          typeof item.url === 'string' &&
          typeof item.title === 'string' &&
          !isStartPageUrl(item.url),
      )
      .map((item) => ({
        url: normalizeBrowserUrl(item.url),
        title: item.title.trim() || hostnameFromUrl(item.url),
        emoji: typeof item.emoji === 'string' ? item.emoji : undefined,
        color: typeof item.color === 'string' ? item.color : undefined,
      }))

    return {
      items: items.length > 0 ? items : defaultStore().items,
      barVisible: parsed.barVisible !== false,
    }
  } catch {
    return defaultStore()
  }
}

function saveStore(store: BookmarkStore): boolean {
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(store))
}

function persistItems(items: BrowserBookmark[]): boolean {
  const store = loadStore()
  return saveStore({ ...store, items })
}

export function loadBrowserBookmarks(): BrowserBookmark[] {
  return loadStore().items
}

export function loadBookmarksBarVisible(): boolean {
  return loadStore().barVisible
}

export function setBookmarksBarVisible(visible: boolean): void {
  const store = loadStore()
  saveStore({ ...store, barVisible: visible })
}

export function isBrowserBookmarked(url: string): boolean {
  const normalized = normalizeBrowserUrl(url)
  return loadStore().items.some((item) => item.url === normalized)
}

export function addBrowserBookmark(bookmark: { url: string; title: string }): boolean {
  if (isStartPageUrl(bookmark.url)) {
    return false
  }

  const url = normalizeBrowserUrl(bookmark.url)
  const title = bookmark.title.trim() || hostnameFromUrl(url)
  const store = loadStore()

  if (store.items.some((item) => item.url === url)) {
    return false
  }

  const nextItems = [
    {
      url,
      title,
      emoji: bookmarkDisplayGlyph(url, title),
      color: bookmarkAccentColor(url),
    },
    ...store.items,
  ].slice(0, MAX_BOOKMARKS)

  return saveStore({ ...store, items: nextItems })
}

export function removeBrowserBookmark(url: string): void {
  const normalized = normalizeBrowserUrl(url)
  const store = loadStore()
  persistItems(store.items.filter((item) => item.url !== normalized))
}

export function updateBrowserBookmarkTitle(url: string, title: string): void {
  const normalized = normalizeBrowserUrl(url)
  const trimmed = title.trim()
  if (!trimmed) {
    return
  }

  const store = loadStore()
  const index = store.items.findIndex((item) => item.url === normalized)
  if (index < 0) {
    return
  }

  const items = store.items.map((item, i) => (i === index ? { ...item, title: trimmed } : item))
  persistItems(items)
}

export function toggleBrowserBookmark(bookmark: { url: string; title: string }): boolean {
  if (isBrowserBookmarked(bookmark.url)) {
    removeBrowserBookmark(bookmark.url)
    return false
  }

  return addBrowserBookmark(bookmark)
}

export function bookmarkDisplayGlyph(url: string, title?: string): string {
  const host = hostnameFromUrl(url)
  const label = title?.trim() || host
  if (/[\u{1F300}-\u{1FAFF}]/u.test(label)) {
    return [...label].find((char) => /\p{Extended_Pictographic}/u.test(char)) ?? label.charAt(0).toUpperCase()
  }
  return label.charAt(0).toUpperCase() || host.charAt(0).toUpperCase() || '?'
}

export function bookmarkAccentColor(url: string): string {
  const host = hostnameFromUrl(url)
  let hash = 0
  for (let index = 0; index < host.length; index += 1) {
    hash = (hash * 31 + host.charCodeAt(index)) >>> 0
  }

  const hue = hash % 360
  return `hsl(${hue} 58% 46%)`
}

export function getBrowserBookmarksStorageBytes(): number {
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
