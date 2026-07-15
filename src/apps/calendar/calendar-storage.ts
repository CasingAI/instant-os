import {
  DEVICE_STORAGE_KEYS,
  writeLocalStorageItem,
} from '../../os/device-storage.ts'
import type {
  CalendarDayMarker,
  CalendarMarkerKind,
  CalendarMonthDigest,
  CalendarStore,
} from './calendar-types.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.calendar
const MARKER_KINDS = new Set<CalendarMarkerKind>([
  'holiday',
  'solar-term',
  'weather',
  'special',
])

export const CALENDAR_STORE_CHANGED_EVENT = 'instant-os:calendar-store-changed'

function emptyStore(): CalendarStore {
  return { digestsByMonth: {} }
}

function normalizeKind(raw: unknown): CalendarMarkerKind {
  if (typeof raw === 'string' && MARKER_KINDS.has(raw as CalendarMarkerKind)) {
    return raw as CalendarMarkerKind
  }
  return 'special'
}

function normalizeMarker(raw: unknown): CalendarDayMarker | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const record = raw as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.dayKey !== 'string') {
    return undefined
  }
  if (typeof record.name !== 'string' || typeof record.day !== 'number') {
    return undefined
  }
  const name = record.name.trim()
  if (!name || !Number.isFinite(record.day) || record.day < 1 || record.day > 31) {
    return undefined
  }
  const note =
    typeof record.note === 'string' && record.note.trim()
      ? record.note.trim()
      : undefined
  return {
    id: record.id,
    day: Math.floor(record.day),
    dayKey: record.dayKey,
    kind: normalizeKind(record.kind),
    name,
    note,
  }
}

function normalizeMonthDigest(raw: unknown): CalendarMonthDigest | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const record = raw as Record<string, unknown>
  if (typeof record.monthKey !== 'string') {
    return undefined
  }
  const markers = Array.isArray(record.markers)
    ? record.markers
        .map(normalizeMarker)
        .filter((item): item is CalendarDayMarker => item !== undefined)
    : []
  return {
    monthKey: record.monthKey,
    generatedAt: typeof record.generatedAt === 'number' ? record.generatedAt : Date.now(),
    markers,
  }
}

function normalizeStore(raw: unknown): CalendarStore {
  if (!raw || typeof raw !== 'object') {
    return emptyStore()
  }
  const record = raw as Record<string, unknown>
  const digestsByMonth: Record<string, CalendarMonthDigest> = {}
  if (record.digestsByMonth && typeof record.digestsByMonth === 'object') {
    for (const [key, value] of Object.entries(
      record.digestsByMonth as Record<string, unknown>,
    )) {
      const digest = normalizeMonthDigest(value)
      if (digest) {
        digestsByMonth[key] = digest
      }
    }
  }
  return { digestsByMonth }
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

export function getMonthDigest(monthKey: string): CalendarMonthDigest | undefined {
  return readCalendarStore().digestsByMonth[monthKey]
}

export function saveMonthDigest(digest: CalendarMonthDigest): CalendarStore {
  const store = readCalendarStore()
  const next: CalendarStore = {
    digestsByMonth: {
      ...store.digestsByMonth,
      [digest.monthKey]: digest,
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

export function createMarkerId(): string {
  return `cal-mk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 从日编码取月编码，如 2026-07-14 → 2026-07 */
export function monthKeyFromDayKey(dayKey: string): string {
  const match = /^(-?\d{1,9}-\d{2})-\d{2}$/.exec(dayKey.trim())
  return match?.[1] ?? dayKey.slice(0, Math.max(0, dayKey.lastIndexOf('-')))
}

export function formatMonthKey(view: {
  era: 'AD' | 'BC'
  year: number
  month: number
}): string {
  const yearPart =
    view.era === 'BC'
      ? `-${String(view.year).padStart(4, '0')}`
      : String(view.year).padStart(4, '0')
  return `${yearPart}-${String(view.month).padStart(2, '0')}`
}
