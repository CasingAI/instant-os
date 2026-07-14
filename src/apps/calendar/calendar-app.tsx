import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import {
  formatCalendarYearLabel,
  formatEditionDateKey,
  getDaysInMonth,
  normalizeCalendarInstant,
  parseEditionDateKey,
  weekdayIndexForInstant,
  type CalendarEra,
} from '../../os/calendar-instant.ts'
import { formatChineseDynastySuffix } from '../../os/chinese-dynasty-label.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { getOsNowInstant, OS_CLOCK_CHANGED_EVENT } from '../../os/os-clock.ts'
import { useOs } from '../../os/os-context.tsx'
import {
  findSolarTermOnDay,
  listSolarTermsInMonth,
  type SolarTermOccurrence,
} from '../../os/solar-terms.ts'
import { BackIcon, ForwardIcon } from '../../icons/app-icons.tsx'
import { generateDayMajorEvents } from './calendar-agent.ts'
import {
  CALENDAR_STORE_CHANGED_EVENT,
  getDayDigest,
} from './calendar-storage.ts'
import type { CalendarDayDigest } from './calendar-types.ts'
import './calendar.css'

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const
const WEEKDAY_FULL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const
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

type ViewMonth = {
  era: CalendarEra
  year: number
  month: number
}

type DayCell = {
  day: number
  dayKey: string
  isToday: boolean
  isWeekend: boolean
  solarTerm?: SolarTermOccurrence
}

function viewMonthFromInstant(instant: {
  era: CalendarEra
  year: number
  month: number
}): ViewMonth {
  return { era: instant.era, year: instant.year, month: instant.month }
}

function shiftMonth(view: ViewMonth, delta: number): ViewMonth {
  let month = view.month + delta
  let year = view.year
  let era = view.era
  while (month < 1) {
    month += 12
    if (era === 'AD') {
      if (year === 1) {
        era = 'BC'
        year = 1
      } else {
        year -= 1
      }
    } else {
      year += 1
    }
  }
  while (month > 12) {
    month -= 12
    if (era === 'BC') {
      if (year === 1) {
        era = 'AD'
        year = 1
      } else {
        year -= 1
      }
    } else {
      year += 1
    }
  }
  return { era, year, month }
}

function formatMonthTitle(view: ViewMonth): string {
  return `${formatCalendarYearLabel(view)}${MONTH_LABELS[view.month - 1]}`
}

/** 返回格子与当月第一天星期偏移。 */
function buildMonthGrid(
  view: ViewMonth,
  todayKey: string,
): { firstWeekday: number; cells: DayCell[] } {
  const daysInMonth = getDaysInMonth(view.era, view.year, view.month)
  const firstWeekday = weekdayIndexForInstant(
    normalizeCalendarInstant({ era: view.era, year: view.year, month: view.month, day: 1 }),
  )
  const terms = listSolarTermsInMonth(view.era, view.year, view.month)
  const termByDay = new Map(terms.map((term) => [term.day, term]))

  const cells: DayCell[] = []
  for (let day = 1; day <= daysInMonth; day++) {
    const instant = normalizeCalendarInstant({
      era: view.era,
      year: view.year,
      month: view.month,
      day,
    })
    const dayKey = formatEditionDateKey(instant)
    const weekday = weekdayIndexForInstant(instant)
    cells.push({
      day,
      dayKey,
      isToday: dayKey === todayKey,
      isWeekend: weekday === 0 || weekday === 6,
      solarTerm: termByDay.get(day),
    })
  }
  return { firstWeekday, cells }
}

export function CalendarApp() {
  const { closeWindowsForApp, minimizeWindow, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()

  const [todayKey, setTodayKey] = useState(() => formatEditionDateKey(getOsNowInstant()))
  const [view, setView] = useState<ViewMonth>(() => viewMonthFromInstant(getOsNowInstant()))
  const [selectedKey, setSelectedKey] = useState(() => formatEditionDateKey(getOsNowInstant()))
  const [digest, setDigest] = useState<CalendarDayDigest | undefined>(() =>
    getDayDigest(formatEditionDateKey(getOsNowInstant())),
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const selectedKeyRef = useRef(selectedKey)
  selectedKeyRef.current = selectedKey

  useEffect(() => {
    const syncToday = () => {
      const now = getOsNowInstant()
      setTodayKey(formatEditionDateKey(now))
    }
    window.addEventListener(OS_CLOCK_CHANGED_EVENT, syncToday)
    return () => window.removeEventListener(OS_CLOCK_CHANGED_EVENT, syncToday)
  }, [])

  useEffect(() => {
    const onStore = () => {
      setDigest(getDayDigest(selectedKey))
    }
    window.addEventListener(CALENDAR_STORE_CHANGED_EVENT, onStore)
    return () => window.removeEventListener(CALENDAR_STORE_CHANGED_EVENT, onStore)
  }, [selectedKey])

  const ensureEvents = useCallback(async (dayKey: string, force = false) => {
    const existing = getDayDigest(dayKey)
    if (existing && !force) {
      setDigest(existing)
      setError(undefined)
      setLoading(false)
      return
    }
    setDigest(force ? getDayDigest(dayKey) : undefined)
    setLoading(true)
    setError(undefined)
    try {
      const next = await generateDayMajorEvents(dayKey)
      if (dayKey === selectedKeyRef.current) {
        setDigest(next)
      }
    } catch (err) {
      if (dayKey !== selectedKeyRef.current) {
        return
      }
      setError(err instanceof Error ? err.message : '重大事件生成失败')
      setDigest(getDayDigest(dayKey))
    } finally {
      if (dayKey === selectedKeyRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void ensureEvents(selectedKey)
  }, [selectedKey, ensureEvents])

  const { firstWeekday, cells } = useMemo(
    () => buildMonthGrid(view, todayKey),
    [view, todayKey],
  )

  const selectedInstant = useMemo(() => parseEditionDateKey(selectedKey), [selectedKey])
  const selectedTerm = useMemo(() => findSolarTermOnDay(selectedInstant), [selectedInstant])
  const dynastySuffix = useMemo(
    () => formatChineseDynastySuffix(selectedInstant),
    [selectedInstant],
  )
  const selectedWeekday =
    WEEKDAY_FULL[weekdayIndexForInstant(selectedInstant)] ?? '周一'

  const goToday = useCallback(() => {
    const now = getOsNowInstant()
    const key = formatEditionDateKey(now)
    setView(viewMonthFromInstant(now))
    setSelectedKey(key)
    setTodayKey(key)
  }, [])

  const selectDay = useCallback((dayKey: string) => {
    setSelectedKey(dayKey)
    const instant = parseEditionDateKey(dayKey)
    setView(viewMonthFromInstant(instant))
  }, [])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === 'calendar' && !window.minimized)

    return [
      {
        label: '日历',
        items: [
          ...aboutAppMenuPrefix('关于 日历', () => showBuiltinAbout('calendar')),
          {
            type: 'action',
            label: '隐藏日历',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出日历',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp('calendar'),
          },
        ],
      },
      {
        label: '前往',
        items: [
          {
            type: 'action',
            label: '今天',
            onClick: goToday,
          },
          {
            type: 'action',
            label: '重新生成当日大事',
            onClick: () => void ensureEvents(selectedKey, true),
          },
        ],
      },
    ]
  }, [
    closeWindowsForApp,
    ensureEvents,
    goToday,
    minimizeWindow,
    selectedKey,
    showBuiltinAbout,
    windows,
  ])

  useAppMenuBar('calendar', menuBar)

  const leadingBlanks = Array.from({ length: firstWeekday }, (_, index) => index)

  return (
    <div class="calendar-app">
      <header class="calendar-app__header">
        <button
          type="button"
          class="calendar-app__nav"
          aria-label="上个月"
          onClick={() => setView((current) => shiftMonth(current, -1))}
        >
          <BackIcon size={14} />
        </button>
        <h1 class="calendar-app__title">{formatMonthTitle(view)}</h1>
        <button
          type="button"
          class="calendar-app__nav"
          aria-label="下个月"
          onClick={() => setView((current) => shiftMonth(current, 1))}
        >
          <ForwardIcon size={14} />
        </button>
        <button type="button" class="calendar-app__today-btn" onClick={goToday}>
          今天
        </button>
      </header>

      <div class="calendar-app__sheet">
        <div class="calendar-app__weekdays" aria-hidden="true">
          {WEEKDAY_LABELS.map((label) => (
            <span key={label} class="calendar-app__weekday">
              {label}
            </span>
          ))}
        </div>

        <div class="calendar-app__grid" role="grid" aria-label={formatMonthTitle(view)}>
          {leadingBlanks.map((index) => (
            <div key={`blank-${index}`} class="calendar-app__cell calendar-app__cell--blank" />
          ))}
          {cells.map((cell) => {
            const selected = cell.dayKey === selectedKey
            return (
              <button
                key={cell.dayKey}
                type="button"
                role="gridcell"
                class={[
                  'calendar-app__cell',
                  cell.isWeekend ? 'calendar-app__cell--weekend' : '',
                  cell.isToday ? 'calendar-app__cell--today' : '',
                  selected ? 'calendar-app__cell--selected' : '',
                  cell.solarTerm ? 'calendar-app__cell--term' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-selected={selected}
                aria-current={cell.isToday ? 'date' : undefined}
                onClick={() => selectDay(cell.dayKey)}
              >
                <span class="calendar-app__day-num">{cell.day}</span>
                {cell.solarTerm && (
                  <span class="calendar-app__day-term">{cell.solarTerm.name}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <section class="calendar-app__detail" aria-live="polite">
        <div class="calendar-app__detail-head">
          <div class="calendar-app__detail-date">
            <strong>
              {selectedInstant.month}月{selectedInstant.day}日
            </strong>
            <span>
              {selectedWeekday}
              {dynastySuffix ? ` ${dynastySuffix}` : ''}
            </span>
          </div>
          <button
            type="button"
            class="calendar-app__regen"
            disabled={loading}
            onClick={() => void ensureEvents(selectedKey, true)}
          >
            {loading ? '生成中…' : '刷新大事'}
          </button>
        </div>

        {selectedTerm && (
          <div class="calendar-app__term-card">
            <span class="calendar-app__term-badge">节气</span>
            <div class="calendar-app__term-copy">
              <h2>{selectedTerm.name}</h2>
              <p>{selectedTerm.blurb}</p>
            </div>
          </div>
        )}

        <div class="calendar-app__events">
          <h3 class="calendar-app__events-title">重大事件</h3>
          {loading && !digest && (
            <div class="calendar-app__loading" role="status">
              <div class="calendar-app__loading-spinner" aria-hidden="true" />
              <p>正在编撰当日大事…</p>
            </div>
          )}
          {error && <p class="calendar-app__error">{error}</p>}
          {digest && digest.events.length > 0 && (
            <ul class="calendar-app__event-list">
              {digest.events.map((event) => (
                <li key={event.id} class="calendar-app__event">
                  <span class="calendar-app__event-cat">{event.category}</span>
                  <div class="calendar-app__event-body">
                    <h4>{event.title}</h4>
                    <p>{event.summary}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!loading && !error && digest && digest.events.length === 0 && (
            <p class="calendar-app__hint">本日暂无大事。可点击「刷新大事」重新生成。</p>
          )}
        </div>
      </section>
    </div>
  )
}
