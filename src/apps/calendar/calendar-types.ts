export type CalendarMarkerKind = 'holiday' | 'solar-term' | 'weather' | 'special'

export type CalendarDayMarker = {
  id: string
  /** 当月日号 1–31 */
  day: number
  dayKey: string
  kind: CalendarMarkerKind
  /** 格子上用的短名，如假日名、节气名 */
  name: string
  /** 可选一句说明，如「放三日假」「小雪初至」 */
  note?: string
}

export type CalendarMonthDigest = {
  monthKey: string
  generatedAt: number
  markers: CalendarDayMarker[]
}

export type CalendarStore = {
  /** 按月缓存的特殊日期标记 */
  digestsByMonth: Record<string, CalendarMonthDigest>
}

export const CALENDAR_MARKER_KIND_LABEL: Record<CalendarMarkerKind, string> = {
  holiday: '假期',
  'solar-term': '节气',
  weather: '天气',
  special: '特殊',
}
