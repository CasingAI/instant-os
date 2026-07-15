import type { ComponentChildren } from 'preact'
import {
  formatCalendarYearLabel,
  weekdayLabelForInstant,
} from './calendar-instant.ts'
import { formatOsClockParts } from './format-os-datetime.ts'
import type { NotificationStockSnapshot, NotificationWeather } from './notification-center-widget-types.ts'
import { isOsUsing24HourTime } from './os-clock.ts'
import { useOsNowInstant } from './use-os-clock.ts'

type WidgetFrameProps = {
  loading: boolean
  onOpen?: () => void
  openLabel?: string
  children: ComponentChildren
}

function WidgetFrame({ loading, onOpen, openLabel, children }: WidgetFrameProps) {
  return (
    <div class="notification-center__widget">
      <div
        class={`notification-center__widget-frame notification-center__widget-frame--compact${onOpen ? ' notification-center__widget-frame--clickable' : ''}${loading ? ' notification-center__widget-frame--loading' : ''}`}
      >
        <div class="notification-center__widget-gloss" aria-hidden="true" />
        {onOpen ? (
          <button
            type="button"
            class="notification-center__widget-open"
            aria-label={openLabel ?? '打开应用'}
            onClick={onOpen}
          >
            {children}
          </button>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

type DateTimeWidgetProps = {
  onOpen?: () => void
}

export function DateTimeWidget({ onOpen }: DateTimeWidgetProps) {
  const now = useOsNowInstant()
  const { digits: timeLabel, period } = formatOsClockParts(
    now.hour,
    now.minute,
    isOsUsing24HourTime(),
  )
  const secondsLabel = `:${pad2(now.second)}`
  const weekday = weekdayLabelForInstant(now)
  const dateLabel = `${formatCalendarYearLabel(now)}${now.month}月${now.day}日`

  const content = (
    <div class="notification-center__datetime" aria-live="polite">
      <div class="notification-center__datetime-time">
        {timeLabel}
        <span class="notification-center__datetime-seconds">{secondsLabel}</span>
        {period && (
          <span class="notification-center__datetime-period">{period}</span>
        )}
      </div>
      <div class="notification-center__datetime-date">
        <span class="notification-center__datetime-weekday">{weekday}</span>
        <span class="notification-center__datetime-meta">{dateLabel}</span>
      </div>
    </div>
  )

  if (!onOpen) {
    return content
  }

  return (
    <button
      type="button"
      class="notification-center__datetime-open"
      aria-label="打开月历"
      onClick={onOpen}
    >
      {content}
    </button>
  )
}

type WeatherWidgetProps = {
  weather: NotificationWeather | undefined
  loading: boolean
  error: string | undefined
  onOpen?: () => void
}

export function WeatherWidget({ weather, loading, error, onOpen }: WeatherWidgetProps) {
  return (
    <WidgetFrame loading={loading} onOpen={onOpen} openLabel="打开天气">
      {!weather && loading && <p class="notification-center__widget-placeholder">正在加载</p>}
      {!weather && !loading && error && (
        <p class="notification-center__widget-placeholder notification-center__widget-placeholder--error">
          {error}
        </p>
      )}
      {weather && (
        <div class="notification-center__weather-compact">
          <div class="notification-center__weather-row">
            <span class="notification-center__weather-emoji" aria-hidden="true">
              {weather.emoji}
            </span>
            <span class="notification-center__weather-temp">{weather.temperatureC}°</span>
            <span class="notification-center__weather-city">{weather.city}</span>
            <span class="notification-center__weather-divider" aria-hidden="true">
              ·
            </span>
            <span class="notification-center__weather-condition">{weather.condition}</span>
          </div>
          <p class="notification-center__weather-meta">
            高 {weather.highC}° 低 {weather.lowC}° · 湿度 {weather.humidity}% · {weather.wind}
          </p>
        </div>
      )}
    </WidgetFrame>
  )
}

function formatSigned(value: number, digits = 2): string {
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(digits)}`
}

type StockWidgetProps = {
  snapshot: NotificationStockSnapshot | undefined
  loading: boolean
  error: string | undefined
  onOpen?: () => void
}

export function StockWidget({ snapshot, loading, error, onOpen }: StockWidgetProps) {
  return (
    <WidgetFrame loading={loading} onOpen={onOpen} openLabel="打开股票">
      {!snapshot && loading && <p class="notification-center__widget-placeholder">正在加载</p>}
      {!snapshot && !loading && error && (
        <p class="notification-center__widget-placeholder notification-center__widget-placeholder--error">
          {error}
        </p>
      )}
      {snapshot && (
        <div class="notification-center__stock-compact">
          <p class="notification-center__stock-market">{snapshot.marketName}</p>
          <div
            class="notification-center__stock-carousel"
            aria-label="股票行情，左右滑动查看更多"
          >
            {snapshot.items.map((item) => {
              const rising = item.change >= 0
              return (
                <article key={item.symbol} class="notification-center__stock-slide">
                  <div class="notification-center__stock-name">
                    <span class="notification-center__stock-symbol">{item.symbol}</span>
                    <span class="notification-center__stock-title">{item.name}</span>
                  </div>
                  <div class="notification-center__stock-quote">
                    <span class="notification-center__stock-price">{item.price.toFixed(2)}</span>
                    <span
                      class={
                        rising
                          ? 'notification-center__stock-change notification-center__stock-change--up'
                          : 'notification-center__stock-change notification-center__stock-change--down'
                      }
                    >
                      {formatSigned(item.change)} ({formatSigned(item.changePercent)}%)
                    </span>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      )}
    </WidgetFrame>
  )
}
