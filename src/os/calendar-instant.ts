export type CalendarEra = 'AD' | 'BC'

/** 公历时刻；year 为公元或公元前各自的正整数（无 0 年）。 */
export type CalendarInstant = {
  era: CalendarEra
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  millisecond: number
}

const MS_PER_DAY = 86_400_000n
const UNIX_EPOCH_JDN = 2_440_588n

export function calendarInstantFromDate(date: Date): CalendarInstant {
  const jsYear = date.getFullYear()
  const era: CalendarEra = jsYear <= 0 ? 'BC' : 'AD'
  const year = era === 'BC' ? 1 - jsYear : jsYear
  return {
    era,
    year,
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
    millisecond: date.getMilliseconds(),
  }
}

export function toAstronomicalYear(era: CalendarEra, year: number): number {
  return era === 'BC' ? -(year - 1) : year
}

export function calendarInstantToJsYear(instant: CalendarInstant): number {
  return toAstronomicalYear(instant.era, instant.year)
}

export function calendarInstantToDate(instant: CalendarInstant): Date {
  const jsYear = calendarInstantToJsYear(instant)
  return new Date(
    jsYear,
    instant.month - 1,
    instant.day,
    instant.hour,
    instant.minute,
    instant.second,
    instant.millisecond,
  )
}

function gregorianToJdn(astronomicalYear: number, month: number, day: number): bigint {
  const a = Math.floor((14 - month) / 12)
  const y = astronomicalYear + 4800 - a
  const m = month + 12 * a - 3
  return BigInt(
    day +
      Math.floor((153 * m + 2) / 5) +
      365 * y +
      Math.floor(y / 4) -
      Math.floor(y / 100) +
      Math.floor(y / 400) -
      32045,
  )
}

function jdnToGregorian(jdn: bigint): { astronomicalYear: number; month: number; day: number } {
  const j = Number(jdn)
  const a = j + 32044
  const b = Math.floor((4 * a + 3) / 146097)
  const c = a - Math.floor((146097 * b) / 4)
  const d = Math.floor((4 * c + 3) / 1461)
  const e = c - Math.floor((1461 * d) / 4)
  const m = Math.floor((5 * e + 2) / 153)
  const day = e - Math.floor((153 * m + 2) / 5) + 1
  const month = m + 3 - 12 * Math.floor(m / 10)
  const astronomicalYear = 100 * b + d - 4800 + Math.floor(m / 10)
  return { astronomicalYear, month, day }
}

function timeOfDayMs(instant: CalendarInstant): bigint {
  return BigInt(instant.hour) * 3_600_000n +
    BigInt(instant.minute) * 60_000n +
    BigInt(instant.second) * 1_000n +
    BigInt(instant.millisecond)
}

export function calendarInstantToMsBigInt(instant: CalendarInstant): bigint {
  const astroYear = toAstronomicalYear(instant.era, instant.year)
  const jdn = gregorianToJdn(astroYear, instant.month, instant.day)
  return (jdn - UNIX_EPOCH_JDN) * MS_PER_DAY + timeOfDayMs(instant)
}

export function calendarInstantToMs(instant: CalendarInstant): number {
  const date = calendarInstantToDate(instant)
  const ms = date.getTime()
  if (Number.isFinite(ms)) {
    return ms
  }
  const bigMs = calendarInstantToMsBigInt(instant)
  if (bigMs >= BigInt(Number.MIN_SAFE_INTEGER) && bigMs <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(bigMs)
  }
  return Number(bigMs)
}

export function msBigIntToCalendarInstant(ms: bigint): CalendarInstant {
  const dayIndex = ms >= 0n ? ms / MS_PER_DAY : (ms - (MS_PER_DAY - 1n)) / MS_PER_DAY
  const remainder = ms - dayIndex * MS_PER_DAY
  const timeMs = remainder < 0n ? remainder + MS_PER_DAY : remainder
  const jdn = UNIX_EPOCH_JDN + dayIndex
  const { astronomicalYear, month, day } = jdnToGregorian(jdn)
  const era: CalendarEra = astronomicalYear <= 0 ? 'BC' : 'AD'
  const year = era === 'BC' ? 1 - astronomicalYear : astronomicalYear
  const hour = Number(timeMs / 3_600_000n)
  const minute = Number((timeMs % 3_600_000n) / 60_000n)
  const second = Number((timeMs % 60_000n) / 1_000n)
  const millisecond = Number(timeMs % 1_000n)
  return { era, year, month, day, hour, minute, second, millisecond }
}

export function addMsToCalendarInstant(
  instant: CalendarInstant,
  deltaMs: number,
): CalendarInstant {
  const baseMs = calendarInstantToMsBigInt(instant)
  const nextMs = baseMs + BigInt(Math.trunc(deltaMs))
  return msBigIntToCalendarInstant(nextMs)
}

export function normalizeCalendarInstant(raw: Partial<CalendarInstant>): CalendarInstant {
  const era: CalendarEra = raw.era === 'BC' ? 'BC' : 'AD'
  const year = clampInt(raw.year, 1, 999_999_999)
  const month = clampInt(raw.month, 1, 12)
  const maxDay = getDaysInMonth(era, year, month)
  const day = clampInt(raw.day, 1, maxDay)
  return {
    era,
    year,
    month,
    day,
    hour: clampInt(raw.hour, 0, 23),
    minute: clampInt(raw.minute, 0, 59),
    second: clampInt(raw.second, 0, 59),
    millisecond: clampInt(raw.millisecond, 0, 999),
  }
}

function clampInt(value: unknown, min: number, max: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : min
  return Math.min(max, Math.max(min, parsed))
}

export function getDaysInMonth(era: CalendarEra, year: number, month: number): number {
  const astroYear = toAstronomicalYear(era, year)
  return new Date(astroYear, month, 0).getDate()
}

export function formatCalendarYearLabel(instant: Pick<CalendarInstant, 'era' | 'year'>): string {
  const padded = String(instant.year).padStart(4, '0')
  return instant.era === 'BC' ? `公元前${padded}年` : `${padded}年`
}

const CHINESE_MONTH_LABELS = [
  '一月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '十一月',
  '十二月',
] as const

/** 公历月份 1–12 →「一月」…「十二月」；超出范围时回退为「N月」。 */
export function formatChineseMonthLabel(month: number): string {
  return CHINESE_MONTH_LABELS[month - 1] ?? `${month}月`
}

export function formatEditionDateLabel(editionDate: string): string {
  const instant = parseEditionDateKey(editionDate)
  const weekday = weekdayLabelForInstant(instant)
  return `${formatCalendarYearLabel(instant)}${instant.month}月${instant.day}日 ${weekday}`
}

export function formatCalendarInstantLabel(instant: CalendarInstant): string {
  const datePart = `${formatCalendarYearLabel(instant)}${instant.month}月${instant.day}日`
  const timePart = `${pad2(instant.hour)}:${pad2(instant.minute)}:${pad2(instant.second)}`
  return `${datePart} ${timePart}`
}

export function formatCalendarInstantDateContext(instant: CalendarInstant): string {
  const date = calendarInstantToDate(instant)
  const timeLabel = Number.isFinite(date.getTime())
    ? date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : `${pad2(instant.hour)}:${pad2(instant.minute)}`
  const weekday = weekdayLabelForInstant(instant)
  const datePart = `${formatCalendarYearLabel(instant)}${instant.month}月${instant.day}日`
  return `${weekday}，${datePart} ${timeLabel}`
}

export function formatEditionDateKey(instant: CalendarInstant): string {
  const yearPart =
    instant.era === 'BC'
      ? `-${String(instant.year).padStart(4, '0')}`
      : String(instant.year).padStart(4, '0')
  return `${yearPart}-${String(instant.month).padStart(2, '0')}-${String(instant.day).padStart(2, '0')}`
}

export function parseEditionDateKey(dateStr: string): CalendarInstant {
  const match = /^(-?\d{1,9})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  if (!match) {
    return calendarInstantFromDate(new Date())
  }
  const yearValue = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isFinite(yearValue) || yearValue === 0 || !month || !day) {
    return calendarInstantFromDate(new Date())
  }
  if (yearValue < 0) {
    return normalizeCalendarInstant({ era: 'BC', year: -yearValue, month, day })
  }
  return normalizeCalendarInstant({ era: 'AD', year: yearValue, month, day })
}

export function calendarDayKey(instant: CalendarInstant): string {
  const astroYear = toAstronomicalYear(instant.era, instant.year)
  const year =
    astroYear < 0
      ? `-${String(-astroYear).padStart(4, '0')}`
      : String(astroYear).padStart(4, '0')
  const month = String(instant.month).padStart(2, '0')
  const day = String(instant.day).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function weekdayIndexForInstant(instant: CalendarInstant): number {
  const astroYear = toAstronomicalYear(instant.era, instant.year)
  const jdn = gregorianToJdn(astroYear, instant.month, instant.day)
  return Number((jdn + 1n) % 7n)
}

export function weekdayLabelForInstant(instant: CalendarInstant): string {
  const weekdayIndex = weekdayIndexForInstant(instant)
  const labels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const
  return labels[weekdayIndex] ?? '周一'
}
