import {
  calendarInstantFromDate,
  normalizeCalendarInstant,
  type CalendarInstant,
} from './calendar-instant.ts'
import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'

export type DateTimeSettings = {
  version: 1
  useSystemTime: boolean
  manual?: {
    anchorRealMs: number
    virtual: CalendarInstant
  }
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.dateTimeSettings

const DEFAULT_SETTINGS: DateTimeSettings = {
  version: 1,
  useSystemTime: true,
}

function normalizeCalendar(raw: unknown): CalendarInstant | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const record = raw as Record<string, unknown>
  return normalizeCalendarInstant({
    era: record.era === 'BC' ? 'BC' : 'AD',
    year: typeof record.year === 'number' ? record.year : undefined,
    month: typeof record.month === 'number' ? record.month : undefined,
    day: typeof record.day === 'number' ? record.day : undefined,
    hour: typeof record.hour === 'number' ? record.hour : undefined,
    minute: typeof record.minute === 'number' ? record.minute : undefined,
    second: typeof record.second === 'number' ? record.second : undefined,
    millisecond: typeof record.millisecond === 'number' ? record.millisecond : undefined,
  })
}

function normalizeDateTimeSettings(raw: unknown): DateTimeSettings {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_SETTINGS
  }

  const record = raw as Record<string, unknown>
  const useSystemTime = record.useSystemTime !== false
  if (useSystemTime) {
    return DEFAULT_SETTINGS
  }

  const manualRaw = record.manual
  if (!manualRaw || typeof manualRaw !== 'object') {
    return DEFAULT_SETTINGS
  }

  const manualRecord = manualRaw as Record<string, unknown>
  const anchorRealMs =
    typeof manualRecord.anchorRealMs === 'number' && Number.isFinite(manualRecord.anchorRealMs)
      ? manualRecord.anchorRealMs
      : Date.now()
  const virtual = normalizeCalendar(manualRecord.virtual)
  if (!virtual) {
    return DEFAULT_SETTINGS
  }

  return {
    version: 1,
    useSystemTime: false,
    manual: {
      anchorRealMs,
      virtual,
    },
  }
}

export function loadDateTimeSettings(): DateTimeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_SETTINGS
    }
    return normalizeDateTimeSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveDateTimeSettings(settings: DateTimeSettings): boolean {
  const payload: DateTimeSettings = settings.useSystemTime
    ? { version: 1, useSystemTime: true }
    : {
        version: 1,
        useSystemTime: false,
        manual: settings.manual,
      }

  if (!payload.useSystemTime && !payload.manual) {
    return false
  }

  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(payload))
}

export function defaultManualDateTimeSettings(virtual: CalendarInstant): DateTimeSettings {
  return {
    version: 1,
    useSystemTime: false,
    manual: {
      anchorRealMs: Date.now(),
      virtual: normalizeCalendarInstant(virtual),
    },
  }
}

export function systemDateTimeSettings(): DateTimeSettings {
  return DEFAULT_SETTINGS
}

export function calendarInstantFromSystemNow(): CalendarInstant {
  return calendarInstantFromDate(new Date())
}
