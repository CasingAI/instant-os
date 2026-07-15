import { useState } from 'preact/hooks'
import type { CalendarInstant } from './calendar-instant.ts'
import { calendarInstantFromSystemNow } from './date-time-settings-storage.ts'
import { DateTimeDatePanel } from '../ui/date-time-date-panel.tsx'

type SetupDateTimeStepProps = {
  onSelectSystem: () => void
  onSelectManual: (instant: CalendarInstant) => void
}

export function SetupDateTimeStep({
  onSelectSystem,
  onSelectManual,
}: SetupDateTimeStepProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerInitial, setPickerInitial] = useState<CalendarInstant>(() =>
    calendarInstantFromSystemNow(),
  )

  const openCustomPicker = () => {
    setPickerInitial(calendarInstantFromSystemNow())
    setPickerOpen(true)
  }

  return (
    <>
      <header class="setup-assistant__step-head">
        <h1 class="setup-assistant__title">选择系统时间</h1>
        <p class="setup-assistant__subtitle">
          Instant OS 会按系统时间运行新闻、月历等功能。你可以跟随设备真实时间，也可以设定一个自定义日期。
        </p>
      </header>

      <div class="setup-datetime-cards" role="group" aria-label="系统时间来源">
        <button
          type="button"
          class="setup-datetime-card"
          onClick={onSelectSystem}
        >
          <span class="setup-datetime-card__icon" aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
              <circle cx="18" cy="18" r="13.5" stroke="currentColor" stroke-width="2" />
              <path
                d="M18 11.5V18.2L22.8 21"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
          <span class="setup-datetime-card__copy">
            <span class="setup-datetime-card__title">真实时间</span>
            <span class="setup-datetime-card__desc">跟随本机当前日期与时刻</span>
          </span>
        </button>

        <button
          type="button"
          class="setup-datetime-card"
          onClick={openCustomPicker}
        >
          <span class="setup-datetime-card__icon" aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
              <rect
                x="6.5"
                y="9.5"
                width="23"
                height="20"
                rx="3.5"
                stroke="currentColor"
                stroke-width="2"
              />
              <path
                d="M6.5 15.5H29.5M13 6.5V11.5M23 6.5V11.5"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
              <circle cx="14" cy="21" r="1.4" fill="currentColor" />
              <circle cx="18" cy="21" r="1.4" fill="currentColor" />
              <circle cx="22" cy="21" r="1.4" fill="currentColor" />
            </svg>
          </span>
          <span class="setup-datetime-card__copy">
            <span class="setup-datetime-card__title">自定义时间</span>
            <span class="setup-datetime-card__desc">选择任意日期作为系统起点</span>
          </span>
        </button>
      </div>

      <p class="setup-assistant__footnote">
        之后仍可在「系统设置 → 日期与时间」中随时更改。
      </p>

      {pickerOpen && (
        <DateTimeDatePanel
          hostSelector=".setup-assistant"
          title="选择日期"
          confirmLabel="确定"
          initial={pickerInitial}
          onCancel={() => setPickerOpen(false)}
          onConfirm={(next) => {
            setPickerOpen(false)
            onSelectManual(next)
          }}
        />
      )}
    </>
  )
}
