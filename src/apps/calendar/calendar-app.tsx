import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import {
  formatCalendarYearLabel,
  formatChineseMonthLabel,
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
import { BackIcon, ForwardIcon, ReloadIcon } from '../../icons/app-icons.tsx'
import { DateTimeDatePanel } from '../../ui/date-time-date-panel.tsx'
import { generateMonthMarkers } from './calendar-agent.ts'
import {
  formatMonthKey,
  readCalendarStore,
  subscribeCalendarStore,
} from './calendar-storage.ts'
import { requestNewsEdition } from '../news/news-edition-request.ts'
import {
  CALENDAR_MARKER_KIND_LABEL,
  type CalendarDayMarker,
  type CalendarMarkerKind,
  type CalendarStore,
} from './calendar-types.ts'
import './calendar.css'

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const
const WEEKDAY_FULL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

const CALENDAR_DATE_PANEL_THEME = {
  accent: 'var(--cal-leather-mid)',
  accentLight: 'var(--cal-leather-top)',
  accentDeep: 'var(--cal-leather-bottom)',
} as const

const MARKER_PRIORITY: Record<CalendarMarkerKind, number> = {
  holiday: 0,
  'solar-term': 1,
  special: 2,
  weather: 3,
}

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
  markerLabel?: string
  hasHoliday?: boolean
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
  return `${formatCalendarYearLabel(view)}${formatChineseMonthLabel(view.month)}`
}

function pickCellLabel(
  markers: CalendarDayMarker[] | undefined,
  solarTerm: SolarTermOccurrence | undefined,
): { markerLabel?: string; hasHoliday?: boolean } {
  if (markers && markers.length > 0) {
    const sorted = [...markers].sort(
      (a, b) => MARKER_PRIORITY[a.kind] - MARKER_PRIORITY[b.kind],
    )
    const top = sorted[0]
    return {
      markerLabel: top?.name,
      hasHoliday: markers.some((item) => item.kind === 'holiday'),
    }
  }
  if (solarTerm) {
    return { markerLabel: solarTerm.name }
  }
  return {}
}

/** 供新闻生成参考的当日记事上下文。 */
function buildNewsDayContext(
  markers: CalendarDayMarker[],
  solarTerm: SolarTermOccurrence | undefined,
): string | undefined {
  const lines: string[] = []
  for (const marker of markers) {
    const label = CALENDAR_MARKER_KIND_LABEL[marker.kind]
    lines.push(marker.note ? `${label}：${marker.name}（${marker.note}）` : `${label}：${marker.name}`)
  }
  if (solarTerm && !markers.some((marker) => marker.name === solarTerm.name)) {
    lines.push(
      solarTerm.blurb ? `节气：${solarTerm.name}（${solarTerm.blurb}）` : `节气：${solarTerm.name}`,
    )
  }
  if (lines.length === 0) {
    return undefined
  }
  return lines.join('\n')
}

/** 返回格子与当月第一天星期偏移。 */
function buildMonthGrid(
  view: ViewMonth,
  todayKey: string,
  markersByDay: Map<number, CalendarDayMarker[]>,
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
    const solarTerm = termByDay.get(day)
    const { markerLabel, hasHoliday } = pickCellLabel(markersByDay.get(day), solarTerm)
    cells.push({
      day,
      dayKey,
      isToday: dayKey === todayKey,
      isWeekend: weekday === 0 || weekday === 6,
      solarTerm,
      markerLabel,
      hasHoliday,
    })
  }
  return { firstWeekday, cells }
}

export function CalendarApp() {
  const { closeWindowsForApp, minimizeWindow, openApp, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()

  const [todayKey, setTodayKey] = useState(() => formatEditionDateKey(getOsNowInstant()))
  const [view, setView] = useState<ViewMonth>(() => viewMonthFromInstant(getOsNowInstant()))
  const [selectedKey, setSelectedKey] = useState(() => formatEditionDateKey(getOsNowInstant()))
  const [store, setStore] = useState<CalendarStore | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const viewMonthKey = formatMonthKey(view)
  const monthDigest = store?.digestsByMonth[viewMonthKey]
  const viewRef = useRef(view)
  viewRef.current = view

  useEffect(() => {
    const syncToday = () => {
      const now = getOsNowInstant()
      setTodayKey(formatEditionDateKey(now))
    }
    window.addEventListener(OS_CLOCK_CHANGED_EVENT, syncToday)
    return () => window.removeEventListener(OS_CLOCK_CHANGED_EVENT, syncToday)
  }, [])

  useEffect(() => {
    let alive = true
    const load = () => {
      readCalendarStore().then((next) => {
        if (alive) {
          setStore(next)
        }
      })
    }
    load()
    const unsubscribe = subscribeCalendarStore(load)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const ensureMonthMarkers = useCallback(async (target: ViewMonth, force = false) => {
    const monthKey = formatMonthKey(target)
    const current = await readCalendarStore()
    const existing = current.digestsByMonth[monthKey]
    if (existing && !force) {
      if (formatMonthKey(viewRef.current) === monthKey) {
        setStore(current)
        setError(undefined)
        setLoading(false)
      }
      return
    }
    if (formatMonthKey(viewRef.current) === monthKey) {
      setLoading(true)
      setError(undefined)
    }
    try {
      const next = await generateMonthMarkers(target)
      if (formatMonthKey(viewRef.current) === monthKey) {
        setStore((prev) => ({
          digestsByMonth: {
            ...(prev?.digestsByMonth ?? {}),
            [monthKey]: next,
          },
        }))
      }
    } catch (err) {
      if (formatMonthKey(viewRef.current) !== monthKey) {
        return
      }
      setError(err instanceof Error ? err.message : '特殊日期加载失败')
      const fallback = await readCalendarStore()
      if (formatMonthKey(viewRef.current) === monthKey) {
        setStore(fallback)
      }
    } finally {
      if (formatMonthKey(viewRef.current) === monthKey) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void ensureMonthMarkers(view)
  }, [view, ensureMonthMarkers])

  const markersByDay = useMemo(() => {
    const map = new Map<number, CalendarDayMarker[]>()
    for (const marker of monthDigest?.markers ?? []) {
      const list = map.get(marker.day)
      if (list) {
        list.push(marker)
      } else {
        map.set(marker.day, [marker])
      }
    }
    return map
  }, [monthDigest])

  const { firstWeekday, cells } = useMemo(
    () => buildMonthGrid(view, todayKey, markersByDay),
    [view, todayKey, markersByDay],
  )

  const selectedInstant = useMemo(() => parseEditionDateKey(selectedKey), [selectedKey])
  const selectedTerm = useMemo(() => findSolarTermOnDay(selectedInstant), [selectedInstant])
  const selectedMarkers = useMemo(() => {
    return (monthDigest?.markers ?? [])
      .filter((marker) => marker.dayKey === selectedKey)
      .sort((a, b) => MARKER_PRIORITY[a.kind] - MARKER_PRIORITY[b.kind])
  }, [monthDigest, selectedKey])
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

  const openDatePicker = useCallback(() => {
    setDatePickerOpen(true)
  }, [])

  const closeDatePicker = useCallback(() => {
    setDatePickerOpen(false)
  }, [])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === 'calendar' && !window.minimized)

    return [
      {
        label: '月历',
        items: [
          ...aboutAppMenuPrefix('关于 月历', () => showBuiltinAbout('calendar')),
          {
            type: 'action',
            label: '隐藏月历',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出月历',
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
            label: '选择日期…',
            onClick: openDatePicker,
          },
          {
            type: 'action',
            label: '刷新本月标记',
            onClick: () => void ensureMonthMarkers(view, true),
          },
        ],
      },
    ]
  }, [
    closeWindowsForApp,
    ensureMonthMarkers,
    goToday,
    minimizeWindow,
    openDatePicker,
    showBuiltinAbout,
    view,
    windows,
  ])

  useAppMenuBar('calendar', menuBar)

  const weekCount = Math.ceil((firstWeekday + cells.length) / 7)
  const leadingBlanks = Array.from({ length: firstWeekday }, (_, index) => index)
  const trailingBlankCount = Math.max(
    0,
    weekCount * 7 - leadingBlanks.length - cells.length,
  )
  const trailingBlanks = Array.from({ length: trailingBlankCount }, (_, index) => index)
  const selectedInView =
    selectedInstant.era === view.era &&
    selectedInstant.year === view.year &&
    selectedInstant.month === view.month

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
        <button
          type="button"
          class="calendar-app__title"
          aria-expanded={datePickerOpen}
          aria-label={`选择日期，当前 ${formatMonthTitle(view)}`}
          onClick={openDatePicker}
        >
          {formatMonthTitle(view)}
        </button>
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

      <DateTimeDatePanel
        open={datePickerOpen}
        hostSelector=".calendar-app"
        theme={CALENDAR_DATE_PANEL_THEME}
        title="选择日期"
        confirmLabel="确定"
        initial={selectedInstant}
        onCancel={closeDatePicker}
        onConfirm={(next) => {
          selectDay(formatEditionDateKey(next))
          closeDatePicker()
        }}
      />

      <div class="calendar-app__body">
      <div class="calendar-app__sheet">
        <div class="calendar-app__weekdays" aria-hidden="true">
          {WEEKDAY_LABELS.map((label) => (
            <span key={label} class="calendar-app__weekday">
              {label}
            </span>
          ))}
        </div>

        <div
          class="calendar-app__grid"
          role="grid"
          aria-label={formatMonthTitle(view)}
          style={{ '--cal-week-rows': weekCount } as Record<string, number>}
        >
          {leadingBlanks.map((index) => (
            <div key={`blank-lead-${index}`} class="calendar-app__cell calendar-app__cell--blank" />
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
                  cell.markerLabel ? 'calendar-app__cell--marked' : '',
                  cell.hasHoliday ? 'calendar-app__cell--holiday' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-selected={selected}
                aria-current={cell.isToday ? 'date' : undefined}
                aria-label={
                  cell.markerLabel
                    ? `${cell.day}日，${cell.markerLabel}`
                    : undefined
                }
                onClick={() => selectDay(cell.dayKey)}
              >
                <span class="calendar-app__day-num">{cell.day}</span>
                {cell.markerLabel && (
                  <>
                    <span class="calendar-app__day-term">{cell.markerLabel}</span>
                    <span
                      class={[
                        'calendar-app__day-mark',
                        cell.hasHoliday
                          ? 'calendar-app__day-mark--holiday'
                          : cell.solarTerm
                            ? 'calendar-app__day-mark--term'
                            : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-hidden="true"
                    />
                  </>
                )}
              </button>
            )
          })}
          {trailingBlanks.map((index) => (
            <div
              key={`blank-trail-${index}`}
              class="calendar-app__cell calendar-app__cell--blank"
            />
          ))}
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
          <div class="calendar-app__detail-actions">
            <button
              type="button"
              class="calendar-app__icon-btn"
              disabled={loading}
              title="刷新本月节日"
              aria-label={loading ? '加载中' : '刷新'}
              onClick={() => void ensureMonthMarkers(view, true)}
            >
              <ReloadIcon size={14} />
            </button>
            <button
              type="button"
              class="calendar-app__text-btn"
              title="打开当天新闻"
              aria-label="新闻"
              onClick={() => {
                requestNewsEdition({
                  editionDate: formatEditionDateKey(selectedInstant),
                  dayContext: buildNewsDayContext(selectedMarkers, selectedTerm),
                  forceGenerate: true,
                })
                openApp('news')
              }}
            >
              新闻
            </button>
          </div>
        </div>

        {selectedInView && selectedTerm && (
          <div class="calendar-app__term-card">
            <span class="calendar-app__term-badge">节气</span>
            <div class="calendar-app__term-copy">
              <h2>{selectedTerm.name}</h2>
              <p>{selectedTerm.blurb}</p>
            </div>
          </div>
        )}

        <div class="calendar-app__events">
          <h3 class="calendar-app__events-title">当日标记</h3>
          {store === undefined && (
            <div class="calendar-app__loading" role="status">
              <div class="calendar-app__loading-spinner" aria-hidden="true" />
              <p>正在加载</p>
            </div>
          )}
          {store !== undefined && loading && !monthDigest && (
            <div class="calendar-app__loading" role="status">
              <div class="calendar-app__loading-spinner" aria-hidden="true" />
              <p>正在加载当月特殊日期…</p>
            </div>
          )}
          {error && <p class="calendar-app__error">{error}</p>}
          {selectedInView && selectedMarkers.length > 0 && (
            <ul class="calendar-app__event-list">
              {selectedMarkers.map((marker) => (
                <li
                  key={marker.id}
                  class={[
                    'calendar-app__event',
                    `calendar-app__event--${marker.kind}`,
                  ].join(' ')}
                >
                  <span class="calendar-app__event-cat">
                    {CALENDAR_MARKER_KIND_LABEL[marker.kind]}
                  </span>
                  <div class="calendar-app__event-body">
                    <h4>{marker.name}</h4>
                    {marker.note && <p>{marker.note}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!loading &&
            !error &&
            monthDigest &&
            selectedInView &&
            selectedMarkers.length === 0 && (
              <p class="calendar-app__hint">这一天没有特殊标记。可点刷新换一批本月节日。</p>
            )}
          {!selectedInView && (
            <p class="calendar-app__hint">选中本月中的一天，查看假期与节令说明。</p>
          )}
        </div>
      </section>
      </div>
    </div>
  )
}
