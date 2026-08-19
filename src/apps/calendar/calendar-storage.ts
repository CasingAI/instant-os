import { createRegistryStore } from '../../os/registry-store.ts'
import type {
  CalendarDayMarker,
  CalendarMarkerKind,
  CalendarMonthDigest,
  CalendarStore,
} from './calendar-types.ts'

const MARKER_KINDS = new Set<CalendarMarkerKind>([
  'holiday',
  'solar-term',
  'weather',
  'special',
])

export const CALENDAR_STORE_CHANGED_EVENT = 'instant-os:calendar-store-changed'

const registryStore = createRegistryStore<CalendarStore>({
  appId: 'calendar',
  defaultValue: emptyStore,
  legacyKey: 'store',
  fields: [
    {
      key: 'digestsByMonth',
      valueType: 'json',
      read: (store) => store.digestsByMonth,
      write: (value, draft) => ({ ...draft, digestsByMonth: value }),
      normalize: normalizeDigestsByMonth,
    },
  ],
  changedEventName: CALENDAR_STORE_CHANGED_EVENT,
})

function normalizeDigestsByMonth(raw: unknown): Record<string, CalendarMonthDigest> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {}
  }
  const digestsByMonth: Record<string, CalendarMonthDigest> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const digest = normalizeMonthDigest(value)
    if (digest) {
      digestsByMonth[key] = digest
    }
  }
  return digestsByMonth
}

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

export function subscribeCalendarStore(listener: () => void): () => void {
  return registryStore.subscribe(listener)
}

export async function readCalendarStore(): Promise<CalendarStore> {
  return registryStore.read()
}

export async function writeCalendarStore(store: CalendarStore): Promise<void> {
  await registryStore.write(store)
}

export async function getMonthDigest(
  monthKey: string,
): Promise<CalendarMonthDigest | undefined> {
  const store = await readCalendarStore()
  return store.digestsByMonth[monthKey]
}

export async function saveMonthDigest(digest: CalendarMonthDigest): Promise<void> {
  const store = await readCalendarStore()
  const next: CalendarStore = {
    digestsByMonth: {
      ...store.digestsByMonth,
      [digest.monthKey]: digest,
    },
  }
  await writeCalendarStore(next)
}

export async function clearCalendarStore(): Promise<void> {
  await writeCalendarStore(emptyStore())
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
