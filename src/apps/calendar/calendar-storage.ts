import {
  DEVICE_STORAGE_KEYS,
  writeLocalStorageItem,
} from '../../os/device-storage.ts'
import type { CalendarDayDigest, CalendarMajorEvent, CalendarStore } from './calendar-types.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.calendar

export const CALENDAR_STORE_CHANGED_EVENT = 'instant-os:calendar-store-changed'

function emptyStore(): CalendarStore {
  return { digestsByDay: {} }
}

function normalizeEvent(raw: unknown): CalendarMajorEvent | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const record = raw as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.title !== 'string') {
    return undefined
  }
  if (typeof record.summary !== 'string' || typeof record.category !== 'string') {
    return undefined
  }
  return {
    id: record.id,
    title: record.title.trim(),
    summary: record.summary.trim(),
    category: record.category.trim() || '要闻',
  }
}

function normalizeDigest(raw: unknown): CalendarDayDigest | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const record = raw as Record<string, unknown>
  if (typeof record.dayKey !== 'string') {
    return undefined
  }
  const events = Array.isArray(record.events)
    ? record.events
        .map(normalizeEvent)
        .filter((item): item is CalendarMajorEvent => item !== undefined)
    : []
  return {
    dayKey: record.dayKey,
    generatedAt: typeof record.generatedAt === 'number' ? record.generatedAt : Date.now(),
    events,
  }
}

function normalizeStore(raw: unknown): CalendarStore {
  if (!raw || typeof raw !== 'object') {
    return emptyStore()
  }
  const record = raw as Record<string, unknown>
  const digestsByDay: Record<string, CalendarDayDigest> = {}
  if (record.digestsByDay && typeof record.digestsByDay === 'object') {
    for (const [key, value] of Object.entries(record.digestsByDay as Record<string, unknown>)) {
      const digest = normalizeDigest(value)
      if (digest) {
        digestsByDay[key] = digest
      }
    }
  }
  return { digestsByDay }
}

function emitChanged(): void {
  window.dispatchEvent(new Event(CALENDAR_STORE_CHANGED_EVENT))
}

export function readCalendarStore(): CalendarStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return emptyStore()
    }
    return normalizeStore(JSON.parse(raw) as unknown)
  } catch {
    return emptyStore()
  }
}

export function writeCalendarStore(store: CalendarStore): void {
  writeLocalStorageItem(STORAGE_KEY, JSON.stringify(store))
  emitChanged()
}

export function getDayDigest(dayKey: string): CalendarDayDigest | undefined {
  return readCalendarStore().digestsByDay[dayKey]
}

export function saveDayDigest(digest: CalendarDayDigest): CalendarStore {
  const store = readCalendarStore()
  const next: CalendarStore = {
    digestsByDay: {
      ...store.digestsByDay,
      [digest.dayKey]: digest,
    },
  }
  writeCalendarStore(next)
  return next
}

export function clearCalendarStore(): CalendarStore {
  const next = emptyStore()
  writeCalendarStore(next)
  return next
}

export function getCalendarStorageBytes(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? new TextEncoder().encode(raw).length : 0
  } catch {
    return 0
  }
}

export function createEventId(): string {
  return `cal-evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
