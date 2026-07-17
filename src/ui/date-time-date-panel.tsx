import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  formatCalendarYearLabel,
  getDaysInMonth,
  normalizeCalendarInstant,
  weekdayIndexForInstant,
  type CalendarEra,
  type CalendarInstant,
} from '../os/calendar-instant.ts'
import { BackIcon, ForwardIcon } from '../icons/app-icons.tsx'
import { SettingsChoiceField } from './settings-choice-field.tsx'
import type { SettingsChoiceOption } from './settings-choice-option-list.tsx'
import { DateTimePanelPortal } from './date-time-panel-portal.tsx'
import { useOverlayPresence } from './use-overlay-presence.ts'
import './date-time-panel.css'

/** 标题栏与选中态主题色；可传具体色值或宿主 CSS 变量（如 `var(--news-accent)`）。 */
export type DateTimeDatePanelTheme = {
  accent: string
  accentLight?: string
  accentDeep?: string
}

export type DateTimeDatePanelProps = {
  open: boolean
  initial: CalendarInstant
  onCancel: () => void
  onConfirm: (next: CalendarInstant) => void
  hostSelector?: string
  theme?: DateTimeDatePanelTheme
  title?: string
  confirmLabel?: string
}

function themeToStyle(theme: DateTimeDatePanelTheme | undefined): Record<string, string> | undefined {
  if (!theme) {
    return undefined
  }
  const style: Record<string, string> = {
    '--dtp-accent': theme.accent,
    '--dtp-accent-light':
      theme.accentLight ?? `color-mix(in srgb, ${theme.accent} 68%, white)`,
    '--dtp-accent-deep':
      theme.accentDeep ?? `color-mix(in srgb, ${theme.accent} 72%, black)`,
  }
  return style
}

type PickerLevel = 'day' | 'month' | 'year' | 'decade'

const ERA_OPTIONS: readonly SettingsChoiceOption[] = [
  { id: 'AD', label: '公元' },
  { id: 'BC', label: '公元前' },
]

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

function toSignedYear(era: CalendarEra, year: number): number {
  return era === 'BC' ? -year : year
}

function fromSignedYear(signed: number): { era: CalendarEra; year: number } {
  if (signed < 0) {
    return { era: 'BC', year: -signed }
  }
  return { era: 'AD', year: Math.max(1, signed) }
}

function decadeStartOf(signedYear: number): number {
  return Math.floor(signedYear / 10) * 10
}

function formatSignedYear(signed: number): string {
  if (signed < 0) {
    return `前${-signed}`
  }
  if (signed < 10_000) {
    return String(signed).padStart(4, '0')
  }
  return String(signed)
}

function skipZeroYear(signed: number, direction: 1 | -1): number {
  return signed === 0 ? direction : signed
}

export function DateTimeDatePanel({
  open,
  initial,
  onCancel,
  onConfirm,
  hostSelector,
  theme,
  title = '设定日期',
  confirmLabel = '设定',
}: DateTimeDatePanelProps) {
  const { mounted, exiting } = useOverlayPresence(open)
  const themeStyle = themeToStyle(theme)
  const [draft, setDraft] = useState(() => normalizeCalendarInstant(initial))
  const [yearText, setYearText] = useState(String(initial.year))
  const [monthText, setMonthText] = useState(String(initial.month))
  const [dayText, setDayText] = useState(String(initial.day))
  const [level, setLevel] = useState<PickerLevel>('day')
  const [viewSignedYear, setViewSignedYear] = useState(() =>
    toSignedYear(initial.era, initial.year),
  )
  const [viewMonth, setViewMonth] = useState(initial.month)
  const [decadeStart, setDecadeStart] = useState(() =>
    decadeStartOf(toSignedYear(initial.era, initial.year)),
  )

  const syncFieldTexts = (next: CalendarInstant) => {
    setYearText(String(next.year))
    setMonthText(String(next.month))
    setDayText(String(next.day))
  }

  const initialRef = useRef(initial)
  initialRef.current = initial

  useEffect(() => {
    if (!open) {
      return
    }
    const next = normalizeCalendarInstant(initialRef.current)
    const signed = toSignedYear(next.era, next.year)
    setDraft(next)
    syncFieldTexts(next)
    setLevel('day')
    setViewSignedYear(signed)
    setViewMonth(next.month)
    setDecadeStart(decadeStartOf(signed))
  }, [open])

  useEffect(() => {
    if (!mounted || exiting) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [exiting, mounted, onCancel])

  const commitDraft = (patch: Partial<CalendarInstant>) => {
    setDraft((current) => {
      const next = normalizeCalendarInstant({ ...current, ...patch })
      return next
    })
  }

  useEffect(() => {
    syncFieldTexts(draft)
    setViewSignedYear(toSignedYear(draft.era, draft.year))
    setViewMonth(draft.month)
    setDecadeStart(decadeStartOf(toSignedYear(draft.era, draft.year)))
    setLevel('day')
  }, [draft.era, draft.year, draft.month, draft.day])

  const applyFieldTexts = () => {
    const year = Number(yearText)
    const month = Number(monthText)
    const day = Number(dayText)
    const patch: Partial<CalendarInstant> = {}
    if (Number.isFinite(year)) {
      patch.year = year
    }
    if (Number.isFinite(month)) {
      patch.month = month
    }
    if (Number.isFinite(day)) {
      patch.day = day
    }
    if (Object.keys(patch).length === 0) {
      syncFieldTexts(draft)
      return
    }
    commitDraft(patch)
  }

  const headerTitle = useMemo(() => {
    if (level === 'day') {
      const parts = fromSignedYear(viewSignedYear)
      return `${formatCalendarYearLabel(parts)}${viewMonth}月`
    }
    if (level === 'month') {
      return formatCalendarYearLabel(fromSignedYear(viewSignedYear))
    }
    if (level === 'year') {
      return `${formatSignedYear(decadeStart)}–${formatSignedYear(decadeStart + 9)}`
    }
    return '选择年代'
  }, [decadeStart, level, viewMonth, viewSignedYear])

  const canDrillUp = level !== 'decade'

  const handleDrillUp = () => {
    if (level === 'day') {
      setLevel('month')
      return
    }
    if (level === 'month') {
      setDecadeStart(decadeStartOf(viewSignedYear))
      setLevel('year')
      return
    }
    if (level === 'year') {
      setLevel('decade')
    }
  }

  const handlePrev = () => {
    if (level === 'day') {
      const month = viewMonth === 1 ? 12 : viewMonth - 1
      const year = skipZeroYear(viewMonth === 1 ? viewSignedYear - 1 : viewSignedYear, -1)
      setViewMonth(month)
      setViewSignedYear(year)
      setDecadeStart(decadeStartOf(year))
      return
    }
    if (level === 'month') {
      const year = skipZeroYear(viewSignedYear - 1, -1)
      setViewSignedYear(year)
      setDecadeStart(decadeStartOf(year))
      return
    }
    if (level === 'year') {
      setDecadeStart((current) => current - 10)
      return
    }
    setDecadeStart((current) => current - 30)
  }

  const handleNext = () => {
    if (level === 'day') {
      const month = viewMonth === 12 ? 1 : viewMonth + 1
      const year = skipZeroYear(viewMonth === 12 ? viewSignedYear + 1 : viewSignedYear, 1)
      setViewMonth(month)
      setViewSignedYear(year)
      setDecadeStart(decadeStartOf(year))
      return
    }
    if (level === 'month') {
      const year = skipZeroYear(viewSignedYear + 1, 1)
      setViewSignedYear(year)
      setDecadeStart(decadeStartOf(year))
      return
    }
    if (level === 'year') {
      setDecadeStart((current) => current + 10)
      return
    }
    setDecadeStart((current) => current + 30)
  }

  const dayCells = useMemo(() => {
    const parts = fromSignedYear(viewSignedYear)
    const daysInMonth = getDaysInMonth(parts.era, parts.year, viewMonth)
    const firstWeekday = weekdayIndexForInstant(
      normalizeCalendarInstant({
        era: parts.era,
        year: parts.year,
        month: viewMonth,
        day: 1,
      }),
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
  }, [viewMonth, viewSignedYear])

  const decadeItems = useMemo(() => {
    const start = decadeStart - 10
    return Array.from({ length: 9 }, (_, index) => start + index * 10)
  }, [decadeStart])

  const selectedSigned = toSignedYear(draft.era, draft.year)

  const handleConfirm = () => {
    const year = Number(yearText)
    const month = Number(monthText)
    const day = Number(dayText)
    const next = normalizeCalendarInstant({
      ...draft,
      year: Number.isFinite(year) ? year : draft.year,
      month: Number.isFinite(month) ? month : draft.month,
      day: Number.isFinite(day) ? day : draft.day,
    })
    onConfirm(next)
  }

  if (!mounted) {
    return undefined
  }

  return (
    <DateTimePanelPortal hostSelector={hostSelector}>
      <div class="date-time-panel" role="presentation" style={themeStyle}>
        <button
          type="button"
          class={`date-time-panel__backdrop${exiting ? ' date-time-panel__backdrop--exiting' : ''}`}
          aria-label="关闭"
          onClick={exiting ? undefined : onCancel}
        />
        <div
          class={`date-time-panel__sheet${exiting ? ' date-time-panel__sheet--exiting' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(event) => event.stopPropagation()}
        >
          <header class="date-time-panel__header">
            <button type="button" class="date-time-panel__header-btn" onClick={onCancel}>
              取消
            </button>
            <span class="date-time-panel__header-title">{title}</span>
            <button
              type="button"
              class="date-time-panel__header-btn date-time-panel__header-btn--accent"
              onClick={handleConfirm}
            >
              {confirmLabel}
            </button>
          </header>

          <div class="date-time-panel__inputs">
            <SettingsChoiceField
              label="纪年"
              value={draft.era}
              options={ERA_OPTIONS}
              onChange={(value) => commitDraft({ era: value as CalendarEra })}
              wideLayout
              presentation="form"
              fieldClass="date-time-panel__field date-time-panel__field--era"
              labelClass="date-time-panel__field-label"
            />
            <label class="date-time-panel__field date-time-panel__field--grow">
              <span class="date-time-panel__field-label">年</span>
              <input
                class="date-time-panel__control"
                type="text"
                inputMode="numeric"
                value={yearText}
                onInput={(event) => setYearText((event.currentTarget as HTMLInputElement).value)}
                onBlur={applyFieldTexts}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    applyFieldTexts()
                  }
                }}
              />
            </label>
            <label class="date-time-panel__field">
              <span class="date-time-panel__field-label">月</span>
              <input
                class="date-time-panel__control"
                type="text"
                inputMode="numeric"
                value={monthText}
                onInput={(event) => setMonthText((event.currentTarget as HTMLInputElement).value)}
                onBlur={applyFieldTexts}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    applyFieldTexts()
                  }
                }}
              />
            </label>
            <label class="date-time-panel__field">
              <span class="date-time-panel__field-label">日</span>
              <input
                class="date-time-panel__control"
                type="text"
                inputMode="numeric"
                value={dayText}
                onInput={(event) => setDayText((event.currentTarget as HTMLInputElement).value)}
                onBlur={applyFieldTexts}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    applyFieldTexts()
                  }
                }}
              />
            </label>
          </div>

          <div class="date-time-panel__calendar">
            <div class="date-time-panel__calendar-nav">
              <button type="button" class="date-time-panel__nav-btn" onClick={handlePrev} aria-label="上一页">
                <BackIcon size={14} />
              </button>
              <button
                type="button"
                class={`date-time-panel__calendar-title${canDrillUp ? ' date-time-panel__calendar-title--drill' : ''}`}
                onClick={canDrillUp ? handleDrillUp : undefined}
                disabled={!canDrillUp}
              >
                {headerTitle}
                {canDrillUp && <span aria-hidden="true"> ▾</span>}
              </button>
              <button type="button" class="date-time-panel__nav-btn" onClick={handleNext} aria-label="下一页">
                <ForwardIcon size={14} />
              </button>
            </div>

            {level === 'day' && (
              <div class="date-time-panel__day-view">
                <div class="date-time-panel__weekdays">
                  {WEEKDAY_LABELS.map((label) => (
                    <span key={label} class="date-time-panel__weekday">
                      {label}
                    </span>
                  ))}
                </div>
                <div class="date-time-panel__day-grid">
                  {dayCells.map((cell, index) => {
                    if (!cell.inMonth) {
                      return <span key={`empty-${index}`} class="date-time-panel__day-spacer" />
                    }
                    const isSelected =
                      selectedSigned === viewSignedYear &&
                      draft.month === viewMonth &&
                      draft.day === cell.day
                    return (
                      <button
                        key={cell.day}
                        type="button"
                        class={`date-time-panel__day${isSelected ? ' date-time-panel__day--selected' : ''}`}
                        onClick={() => {
                          const parts = fromSignedYear(viewSignedYear)
                          commitDraft({
                            era: parts.era,
                            year: parts.year,
                            month: viewMonth,
                            day: cell.day,
                          })
                        }}
                      >
                        {cell.day}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {level === 'month' && (
              <div class="date-time-panel__month-grid">
                {MONTH_LABELS.map((label, index) => {
                  const month = index + 1
                  const isSelected = selectedSigned === viewSignedYear && draft.month === month
                  return (
                    <button
                      key={label}
                      type="button"
                      class={`date-time-panel__chip${isSelected ? ' date-time-panel__chip--selected' : ''}`}
                      onClick={() => {
                        setViewMonth(month)
                        setLevel('day')
                      }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            )}

            {level === 'year' && (
              <div class="date-time-panel__month-grid">
                {Array.from({ length: 12 }, (_, index) => {
                  const year = decadeStart - 1 + index
                  const display = skipZeroYear(year, year < 0 ? -1 : 1)
                  const isSelected = selectedSigned === display
                  return (
                    <button
                      key={display}
                      type="button"
                      class={`date-time-panel__chip${isSelected ? ' date-time-panel__chip--selected' : ''}`}
                      onClick={() => {
                        setViewSignedYear(display)
                        setDecadeStart(decadeStartOf(display))
                        setLevel('month')
                      }}
                    >
                      {formatSignedYear(display)}
                    </button>
                  )
                })}
              </div>
            )}

            {level === 'decade' && (
              <div class="date-time-panel__month-grid">
                {decadeItems.map((start) => {
                  const isSelected = selectedSigned >= start && selectedSigned <= start + 9
                  return (
                    <button
                      key={start}
                      type="button"
                      class={`date-time-panel__chip${isSelected ? ' date-time-panel__chip--selected' : ''}`}
                      onClick={() => {
                        setDecadeStart(start)
                        setViewSignedYear(skipZeroYear(start, start < 0 ? -1 : 1))
                        setLevel('year')
                      }}
                    >
                      {formatSignedYear(start)}–{formatSignedYear(start + 9)}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <p class="date-time-panel__hint">可直接输入年/月/日，或点日历选择；点标题可切换月/年/年代。</p>
        </div>
      </div>
    </DateTimePanelPortal>
  )
}
