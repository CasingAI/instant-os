import {
  addMsToCalendarInstant,
  calendarDayKey,
  calendarInstantFromDate,
  calendarInstantToDate,
  calendarInstantToMs,
  calendarInstantToMsBigInt,
  formatCalendarInstantDateContext,
  type CalendarInstant,
} from './calendar-instant.ts'

const MS_PER_CALENDAR_YEAR = 365n * 86_400_000n
import {
  loadDateTimeSettings,
  saveDateTimeSettings,
  defaultManualDateTimeSettings,
  systemDateTimeSettings,
  type DateTimeSettings,
} from './date-time-settings-storage.ts'

export const OS_CLOCK_CHANGED_EVENT = 'instant-os:clock-changed'

export type { CalendarInstant, CalendarEra } from './calendar-instant.ts'
export type { DateTimeSettings } from './date-time-settings-storage.ts'
export {
  loadDateTimeSettings,
  saveDateTimeSettings,
  calendarInstantFromSystemNow,
} from './date-time-settings-storage.ts'
export {
  calendarDayKey,
  calendarInstantFromDate,
  formatCalendarInstantLabel,
  formatEditionDateKey,
  normalizeCalendarInstant,
  parseEditionDateKey,
} from './calendar-instant.ts'

let cachedSettings: DateTimeSettings | undefined

function readSettings(): DateTimeSettings {
  if (!cachedSettings) {
    cachedSettings = loadDateTimeSettings()
  }
  return cachedSettings
}

function refreshSettingsCache(): void {
  cachedSettings = loadDateTimeSettings()
}

export function isOsUsingSystemTime(): boolean {
  return readSettings().useSystemTime
}

export function isOsUsing24HourTime(): boolean {
  return readSettings().use24HourTime !== false
}

export function getOsNowInstant(): CalendarInstant {
  const settings = readSettings()
  if (settings.useSystemTime || !settings.manual) {
    return calendarInstantFromDate(new Date())
  }

  const elapsed = Date.now() - settings.manual.anchorRealMs
  return addMsToCalendarInstant(settings.manual.virtual, elapsed)
}

/** 系统虚拟时钟的毫秒时间戳；公元前等超出 JS Date 范围时仍可用 BigInt 推导。 */
export function osNowMs(): number {
  return calendarInstantToMs(getOsNowInstant())
}

export function osNowDate(): Date {
  const instant = getOsNowInstant()
  const date = calendarInstantToDate(instant)
  if (Number.isFinite(date.getTime())) {
    return date
  }
  return new Date(osNowMs())
}

export function osDayKey(): string {
  return calendarDayKey(getOsNowInstant())
}

export function formatOsDateTimeContext(): string {
  return formatCalendarInstantDateContext(getOsNowInstant())
}

/** 虚拟系统时间相对真实墙钟是否至少偏离指定年数（过去或未来）。 */
export function isOsClockAtLeastYearsAwayFromReal(years: number): boolean {
  const wholeYears = Math.trunc(years)
  if (wholeYears <= 0) {
    return false
  }
  const osMs = calendarInstantToMsBigInt(getOsNowInstant())
  const realMs = BigInt(Date.now())
  const diff = osMs >= realMs ? osMs - realMs : realMs - osMs
  return diff >= BigInt(wholeYears) * MS_PER_CALENDAR_YEAR
}

export function applyOsManualDateTime(virtual: CalendarInstant): boolean {
  const use24HourTime = isOsUsing24HourTime()
  const saved = saveDateTimeSettings(defaultManualDateTimeSettings(virtual, use24HourTime))
  if (!saved) {
    return false
  }
  refreshSettingsCache()
  dispatchClockChanged()
  return true
}

export function applyOsSystemDateTime(): boolean {
  const saved = saveDateTimeSettings(systemDateTimeSettings(isOsUsing24HourTime()))
  if (!saved) {
    return false
  }
  refreshSettingsCache()
  dispatchClockChanged()
  return true
}

export function applyOs24HourTime(use24HourTime: boolean): boolean {
  const current = readSettings()
  const next: DateTimeSettings = current.useSystemTime
    ? systemDateTimeSettings(use24HourTime)
    : {
        version: 1,
        useSystemTime: false,
        use24HourTime,
        manual: current.manual,
      }
  if (!next.useSystemTime && !next.manual) {
    return false
  }
  const saved = saveDateTimeSettings(next)
  if (!saved) {
    return false
  }
  refreshSettingsCache()
  dispatchClockChanged()
  return true
}

export function dispatchClockChanged(): void {
  window.dispatchEvent(new CustomEvent(OS_CLOCK_CHANGED_EVENT))
}

export function syncOsClockFromStorage(): void {
  refreshSettingsCache()
  dispatchClockChanged()
}
