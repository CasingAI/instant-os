import {
  addMsToCalendarInstant,
  formatEditionDateKey,
  parseEditionDateKey,
} from '../../os/calendar-instant.ts'
import { getOsNowInstant } from '../../os/os-clock.ts'
import { DateTimeDatePanel } from '../../ui/date-time-date-panel.tsx'

export type NewsDatePickerProps = {
  open: boolean
  value: string
  onSelect: (dateStr: string) => void
  onClose: () => void
}

const MS_PER_DAY = 86_400_000

const NEWS_DATE_PANEL_THEME = {
  accent: 'var(--news-accent)',
  accentLight: 'var(--news-accent-light)',
  accentDeep: 'var(--ios-nav-back-color-active)',
} as const

export function NewsDatePicker({ open, value, onSelect, onClose }: NewsDatePickerProps) {
  return (
    <DateTimeDatePanel
      open={open}
      hostSelector=".news"
      theme={NEWS_DATE_PANEL_THEME}
      title="选择日期"
      confirmLabel="确定"
      initial={parseEditionDateKey(value)}
      onCancel={onClose}
      onConfirm={(next) => {
        onSelect(formatEditionDateKey(next))
        onClose()
      }}
    />
  )
}

export function shiftEditionDate(dateStr: string, deltaDays: number): string {
  const instant = parseEditionDateKey(dateStr)
  const shifted = addMsToCalendarInstant(instant, deltaDays * MS_PER_DAY)
  return formatEditionDateKey(shifted)
}

export function getTodayEditionDate(): string {
  return formatEditionDateKey(getOsNowInstant())
}

export function formatShortEditionDate(dateStr: string): string {
  const { month, day } = parseEditionDateKey(dateStr)
  return `${month}月${day}日`
}
