import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import {
  addMsToCalendarInstant,
  formatEditionDateKey,
  getDaysInMonth,
  normalizeCalendarInstant,
  parseEditionDateKey,
  weekdayIndexForInstant,
  type CalendarEra,
} from '../../os/calendar-instant.ts'
import { getOsNowInstant } from '../../os/os-clock.ts'
import { BackIcon, ForwardIcon } from '../../icons/app-icons.tsx'
import './news-date-picker.css'

export type NewsDatePickerProps = {
  open: boolean
  value: string
  onSelect: (dateStr: string) => void
  onClose: () => void
}

type PickerLevel = 'day' | 'month' | 'year' | 'decade'

const MS_PER_DAY = 86_400_000

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const
const MONTH_LABELS = [
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

type EditionDateParts = {
  era: CalendarEra
  year: number
  month: number
  day: number
}

function partsFromSignedYear(year: number, month: number, day: number): EditionDateParts {
  if (year < 0) {
    return { era: 'BC', year: -year, month, day }
  }
  return { era: 'AD', year, month, day }
}

function partsToSignedYear(parts: EditionDateParts): number {
  return parts.era === 'BC' ? -parts.year : parts.year
}

function parseEditionDate(dateStr: string): EditionDateParts {
  const instant = parseEditionDateKey(dateStr)
  return {
    era: instant.era,
    year: instant.year,
    month: instant.month,
    day: instant.day,
  }
}

function formatEditionDate(year: number, month: number, day: number): string {
  const parts = partsFromSignedYear(year, month, day)
  return formatEditionDateKey(
    normalizeCalendarInstant({
      era: parts.era,
      year: parts.year,
      month: parts.month,
      day: parts.day,
    }),
  )
}

function formatEditionDateFromParts(parts: EditionDateParts): string {
  return formatEditionDateKey(normalizeCalendarInstant(parts))
}

function getTodayParts(): EditionDateParts {
  const instant = getOsNowInstant()
  return {
    era: instant.era,
    year: instant.year,
    month: instant.month,
    day: instant.day,
  }
}

function getDecadeStart(year: number): number {
  return Math.floor(year / 10) * 10
}

function formatPickerYear(year: number): string {
  if (year < 0) {
    return String(year)
  }
  if (year < 10_000) {
    return String(year).padStart(4, '0')
  }
  return String(year)
}

function formatPickerYearLabel(year: number): string {
  return `${formatPickerYear(year)}年`
}

type PickerViewState = {
  level: PickerLevel
  year: number
  month: number
  decadeStart: number
}

function viewStateFromValue(value: string): PickerViewState {
  const parts = parseEditionDate(value)
  const signedYear = partsToSignedYear(parts)
  return {
    level: 'day',
    year: signedYear,
    month: parts.month,
    decadeStart: getDecadeStart(signedYear),
  }
}

export function NewsDatePicker({ open, value, onSelect, onClose }: NewsDatePickerProps) {
  const [view, setView] = useState<PickerViewState>(() => viewStateFromValue(value))

  useEffect(() => {
    if (open) {
      setView(viewStateFromValue(value))
    }
  }, [open, value])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const selected = useMemo(() => parseEditionDate(value), [value])
  const today = useMemo(() => getTodayParts(), [])

  const headerTitle = useMemo(() => {
    if (view.level === 'day') {
      return `${formatPickerYearLabel(view.year)}${view.month}月`
    }
    if (view.level === 'month') {
      return formatPickerYearLabel(view.year)
    }
    if (view.level === 'year') {
      return `${view.decadeStart}–${view.decadeStart + 9}`
    }
    return '选择年代'
  }, [view])

  const canDrillUp = view.level !== 'decade'

  const handleDrillUp = useCallback(() => {
    setView((prev) => {
      if (prev.level === 'day') {
        return { ...prev, level: 'month' }
      }
      if (prev.level === 'month') {
        return { ...prev, level: 'year', decadeStart: getDecadeStart(prev.year) }
      }
      if (prev.level === 'year') {
        return { ...prev, level: 'decade' }
      }
      return prev
    })
  }, [])

  const handlePrev = useCallback(() => {
    setView((prev) => {
      if (prev.level === 'day') {
        const month = prev.month === 1 ? 12 : prev.month - 1
        const year = prev.month === 1 ? prev.year - 1 : prev.year
        return { ...prev, year, month, decadeStart: getDecadeStart(year) }
      }
      if (prev.level === 'month') {
        const year = prev.year - 1
        return { ...prev, year, decadeStart: getDecadeStart(year) }
      }
      if (prev.level === 'year') {
        return { ...prev, decadeStart: prev.decadeStart - 10, year: prev.decadeStart - 10 }
      }
      return { ...prev, decadeStart: prev.decadeStart - 30 }
    })
  }, [])

  const handleNext = useCallback(() => {
    setView((prev) => {
      if (prev.level === 'day') {
        const month = prev.month === 12 ? 1 : prev.month + 1
        const year = prev.month === 12 ? prev.year + 1 : prev.year
        return { ...prev, year, month, decadeStart: getDecadeStart(year) }
      }
      if (prev.level === 'month') {
        const year = prev.year + 1
        return { ...prev, year, decadeStart: getDecadeStart(year) }
      }
      if (prev.level === 'year') {
        return { ...prev, decadeStart: prev.decadeStart + 10, year: prev.decadeStart + 10 }
      }
      return { ...prev, decadeStart: prev.decadeStart + 30 }
    })
  }, [])

  const handleSelectDay = useCallback(
    (day: number) => {
      onSelect(formatEditionDate(view.year, view.month, day))
      onClose()
    },
    [onClose, onSelect, view.month, view.year],
  )

  const handleSelectMonth = useCallback((month: number) => {
    setView((prev) => ({ ...prev, month, level: 'day' }))
  }, [])

  const handleSelectYear = useCallback((year: number) => {
    setView((prev) => ({ ...prev, year, decadeStart: getDecadeStart(year), level: 'month' }))
  }, [])

  const handleSelectDecade = useCallback((decadeStart: number) => {
    setView((prev) => ({ ...prev, decadeStart, year: decadeStart, level: 'year' }))
  }, [])

  const handleJumpToday = useCallback(() => {
    const parts = getTodayParts()
    onSelect(formatEditionDateFromParts(parts))
    onClose()
  }, [onClose, onSelect])

  const dayCells = useMemo(() => {
    const viewParts = partsFromSignedYear(view.year, view.month, 1)
    const daysInMonth = getDaysInMonth(viewParts.era, viewParts.year, viewParts.month)
    const firstWeekday = weekdayIndexForInstant(
      normalizeCalendarInstant({ era: viewParts.era, year: viewParts.year, month: viewParts.month, day: 1 }),
    )
    const cells: Array<{ day: number; inMonth: boolean }> = []

    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push({ day: 0, inMonth: false })
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push({ day, inMonth: true })
    }
    while (cells.length % 7 !== 0) {
      cells.push({ day: 0, inMonth: false })
    }
    return cells
  }, [view.month, view.year])

  const decadeItems = useMemo(() => {
    const start = view.decadeStart - 10
    return Array.from({ length: 9 }, (_, index) => start + index * 10)
  }, [view.decadeStart])

  const selectedSignedYear = partsToSignedYear(selected)
  const todaySignedYear = partsToSignedYear(today)

  if (!open) {
    return undefined
  }

  return (
    <div class="news-date-picker" role="presentation">
      <button type="button" class="news-date-picker__backdrop" aria-label="关闭日期选择" onClick={onClose} />
      <div
        class="news-date-picker__panel"
        role="dialog"
        aria-modal="true"
        aria-label="选择日期"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="news-date-picker__header">
          <button type="button" class="news-date-picker__header-btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            class={`news-date-picker__title ${canDrillUp ? 'news-date-picker__title--drill' : ''}`}
            onClick={canDrillUp ? handleDrillUp : undefined}
            disabled={!canDrillUp}
          >
            {headerTitle}
            {canDrillUp && <span class="news-date-picker__title-caret" aria-hidden="true">▾</span>}
          </button>
          <button type="button" class="news-date-picker__header-btn news-date-picker__header-btn--accent" onClick={handleJumpToday}>
            今天
          </button>
        </header>

        <div class="news-date-picker__content">
          <div class="news-date-picker__nav-row">
            <button type="button" class="news-date-picker__nav" onClick={handlePrev} aria-label="上一页">
              <BackIcon size={14} />
            </button>
            <div class="news-date-picker__viewport">
              {view.level === 'day' && (
                <div class="news-date-picker__day-view">
                  <div class="news-date-picker__weekdays">
                    {WEEKDAY_LABELS.map((label) => (
                      <span key={label} class="news-date-picker__weekday">
                        {label}
                      </span>
                    ))}
                  </div>
                  <div class="news-date-picker__day-grid">
                    {dayCells.map((cell, index) => {
                      if (!cell.inMonth) {
                        return <span key={`empty-${index}`} class="news-date-picker__day-spacer" />
                      }
                      const isSelected =
                        selectedSignedYear === view.year &&
                        selected.month === view.month &&
                        selected.day === cell.day
                      const isToday =
                        todaySignedYear === view.year && today.month === view.month && today.day === cell.day
                      return (
                        <button
                          key={cell.day}
                          type="button"
                          class={`news-date-picker__day ${
                            isSelected ? 'news-date-picker__day--selected' : ''
                          } ${isToday ? 'news-date-picker__day--today' : ''}`}
                          onClick={() => handleSelectDay(cell.day)}
                        >
                          {cell.day}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {view.level === 'month' && (
                <div class="news-date-picker__month-grid">
                  {MONTH_LABELS.map((label, index) => {
                    const month = index + 1
                    const isSelected = selectedSignedYear === view.year && selected.month === month
                    const isTodayMonth = todaySignedYear === view.year && today.month === month
                    return (
                      <button
                        key={label}
                        type="button"
                        class={`news-date-picker__month ${
                          isSelected ? 'news-date-picker__month--selected' : ''
                        } ${isTodayMonth ? 'news-date-picker__month--today' : ''}`}
                        onClick={() => handleSelectMonth(month)}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              )}

              {view.level === 'year' && (
                <div class="news-date-picker__year-grid">
                  {Array.from({ length: 12 }, (_, index) => {
                    const year = view.decadeStart - 1 + index
                    const isSelected = selectedSignedYear === year
                    const isTodayYear = todaySignedYear === year
                    return (
                      <button
                        key={year}
                        type="button"
                        class={`news-date-picker__year ${
                          isSelected ? 'news-date-picker__year--selected' : ''
                        } ${isTodayYear ? 'news-date-picker__year--today' : ''}`}
                        onClick={() => handleSelectYear(year)}
                      >
                        {formatPickerYear(year)}
                      </button>
                    )
                  })}
                </div>
              )}

              {view.level === 'decade' && (
                <div class="news-date-picker__decade-grid">
                  {decadeItems.map((decadeStart) => {
                    const isSelected =
                      selectedSignedYear >= decadeStart && selectedSignedYear <= decadeStart + 9
                    const isTodayDecade =
                      todaySignedYear >= decadeStart && todaySignedYear <= decadeStart + 9
                    return (
                      <button
                        key={decadeStart}
                        type="button"
                        class={`news-date-picker__decade ${
                          isSelected ? 'news-date-picker__decade--selected' : ''
                        } ${isTodayDecade ? 'news-date-picker__decade--today' : ''}`}
                        onClick={() => handleSelectDecade(decadeStart)}
                      >
                        {decadeStart}–{decadeStart + 9}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <button type="button" class="news-date-picker__nav" onClick={handleNext} aria-label="下一页">
              <ForwardIcon size={14} />
            </button>
          </div>
        </div>

        <footer class="news-date-picker__footer">
          <span class="news-date-picker__hint">
            {view.level === 'day' && '点选日期；点标题可切换月份'}
            {view.level === 'month' && '点选月份；点标题可切换年份'}
            {view.level === 'year' && '点选年份；点标题可切换年代'}
            {view.level === 'decade' && '点选年代范围'}
          </span>
        </footer>
      </div>
    </div>
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
  const { month, day } = parseEditionDate(dateStr)
  return `${month}月${day}日`
}

export { formatEditionDate, parseEditionDate }
