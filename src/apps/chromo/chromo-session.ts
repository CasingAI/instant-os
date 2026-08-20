import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import { hostnameFromUrl } from '../browser/normalize-browser-url.ts'
import { normalizeChromoBookmarkUrl } from './chromo-bookmarks.ts'
import { chromoInternalPageTitle, normalizeChromoInternalUrl, parseChromoInternalPage } from './chromo-internal.ts'

export type ChromoSessionTab = {
  url: string
  title: string
}

export type ChromoSession = {
  tabs: ChromoSessionTab[]
  activeIndex: number
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.chromoSession
export const CHROMO_SESSION_MAX_TABS = 20

export function emptyChromoSession(): ChromoSession {
  return {
    tabs: [{ url: '', title: '新标签页' }],
    activeIndex: 0,
  }
}

function normalizeSessionTab(value: unknown): ChromoSessionTab | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const item = value as Partial<ChromoSessionTab>
  if (typeof item.url !== 'string' || typeof item.title !== 'string') {
    return undefined
  }

  const trimmedUrl = item.url.trim()
  if (!trimmedUrl) {
    return { url: '', title: item.title.trim() || '新标签页' }
  }

  const internal = normalizeChromoInternalUrl(trimmedUrl)
  if (internal) {
    const page = parseChromoInternalPage(internal)
    return {
      url: internal,
      title: item.title.trim() || (page ? chromoInternalPageTitle(page) : internal),
    }
  }

  const url = normalizeChromoBookmarkUrl(trimmedUrl)
  if (!url) {
    return undefined
  }

  return {
    url,
    title: item.title.trim() || hostnameFromUrl(url) || url,
  }
}

export function normalizeChromoSession(value: unknown): ChromoSession {
  const raw =
    value && typeof value === 'object' ? (value as Partial<ChromoSession>) : undefined
  const tabs = (Array.isArray(raw?.tabs) ? raw.tabs : [])
    .map(normalizeSessionTab)
    .filter((item): item is ChromoSessionTab => Boolean(item))
    .slice(0, CHROMO_SESSION_MAX_TABS)

  if (tabs.length === 0) {
    return emptyChromoSession()
  }

  const requestedIndex = typeof raw?.activeIndex === 'number' && Number.isFinite(raw.activeIndex)
    ? Math.trunc(raw.activeIndex)
    : 0

  return {
    tabs,
    activeIndex: Math.min(Math.max(0, requestedIndex), tabs.length - 1),
  }
}

export function loadChromoSession(): ChromoSession | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return undefined
    }
    return normalizeChromoSession(JSON.parse(raw))
  } catch {
    return undefined
  }
}

export function saveChromoSession(session: ChromoSession): boolean {
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(normalizeChromoSession(session)))
}

export function saveChromoBlankSession(): boolean {
  return saveChromoSession(emptyChromoSession())
}

export function chromoSessionHasPages(
  session: ChromoSession | undefined,
): session is ChromoSession {
  return Boolean(session?.tabs.some((tab) => tab.url))
}
