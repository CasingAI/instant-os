import { useEffect, useMemo, useState } from 'preact/hooks'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { Switch } from '../../ui/switch.tsx'
import {
  formatCalendarYearLabel,
  normalizeCalendarInstant,
  type CalendarInstant,
} from '../../os/calendar-instant.ts'
import { formatOsClockHm, formatOsClockParts } from '../../os/format-os-datetime.ts'
import {
  applyOs24HourTime,
  applyOsManualDateTime,
  applyOsSystemDateTime,
  calendarInstantFromSystemNow,
  getOsNowInstant,
  loadDateTimeSettings,
  OS_CLOCK_CHANGED_EVENT,
} from '../../os/os-clock.ts'
import { SettingsDisclosureIcon } from './settings-disclosure-icon.tsx'
import { DateTimeDatePanel } from '../../ui/date-time-date-panel.tsx'
import { DateTimeTimePanel } from './date-time-time-panel.tsx'
import './date-time-settings-view.css'

type DateTimeSettingsViewProps = {
  onBack: () => void
}

type EditorKind = 'date' | 'time'

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatDateRowLabel(instant: CalendarInstant): string {
  return `${formatCalendarYearLabel(instant)}${instant.month}月${instant.day}日`
}

function formatTimeRowLabel(instant: CalendarInstant, use24HourTime: boolean): string {
  return formatOsClockHm(instant.hour, instant.minute, use24HourTime)
}

export function DateTimeSettingsView({ onBack }: DateTimeSettingsViewProps) {
  const initialSettings = useMemo(() => loadDateTimeSettings(), [])
  const [useSystemTime, setUseSystemTime] = useState(() => initialSettings.useSystemTime)
  const [use24HourTime, setUse24HourTime] = useState(() => initialSettings.use24HourTime !== false)
  const [previewInstant, setPreviewInstant] = useState(() => getOsNowInstant())
  const [saveError, setSaveError] = useState(false)
  const [editor, setEditor] = useState<EditorKind | undefined>(undefined)

  useEffect(() => {
    const syncPreview = () => {
      const settings = loadDateTimeSettings()
      setPreviewInstant(getOsNowInstant())
      setUseSystemTime(settings.useSystemTime)
      setUse24HourTime(settings.use24HourTime !== false)
    }
    syncPreview()
    const intervalId = window.setInterval(syncPreview, 1000)
    window.addEventListener(OS_CLOCK_CHANGED_EVENT, syncPreview)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener(OS_CLOCK_CHANGED_EVENT, syncPreview)
    }
  }, [])

  const handleToggleSystemTime = (checked: boolean) => {
    setSaveError(false)
    setEditor(undefined)
    if (checked) {
      if (!applyOsSystemDateTime()) {
        setSaveError(true)
        return
      }
      setUseSystemTime(true)
      return
    }

    const next = calendarInstantFromSystemNow()
    if (!applyOsManualDateTime(next)) {
      setSaveError(true)
      return
    }
    setUseSystemTime(false)
  }

  const handleToggle24HourTime = (checked: boolean) => {
    setSaveError(false)
    if (!applyOs24HourTime(checked)) {
      setSaveError(true)
      return
    }
    setUse24HourTime(checked)
  }

  const handleConfirmDate = (datePart: CalendarInstant) => {
    setSaveError(false)
    const current = getOsNowInstant()
    const next = normalizeCalendarInstant({
      ...current,
      era: datePart.era,
      year: datePart.year,
      month: datePart.month,
      day: datePart.day,
    })
    if (!applyOsManualDateTime(next)) {
      setSaveError(true)
      return
    }
    setUseSystemTime(false)
    setEditor(undefined)
  }

  const handleConfirmTime = (timePart: CalendarInstant) => {
    setSaveError(false)
    const current = getOsNowInstant()
    const next = normalizeCalendarInstant({
      ...current,
      hour: timePart.hour,
      minute: timePart.minute,
      second: 0,
      millisecond: 0,
    })
    if (!applyOsManualDateTime(next)) {
      setSaveError(true)
      return
    }
    setUseSystemTime(false)
    setEditor(undefined)
  }

  const previewClock = formatOsClockParts(
    previewInstant.hour,
    previewInstant.minute,
    use24HourTime,
  )

  return (
    <div class={`settings${editor ? ' date-time-settings--editing' : ''}`}>
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">日期与时间</h2>
          <p class="settings__section-subtitle">
            手动设定后，系统界面与 AI 生成内容都会以这里为准；可设到公元前。
          </p>

          <div class="date-time-settings__clock" aria-live="polite">
            <div class="date-time-settings__clock-face">
              <span class="date-time-settings__clock-time">
                {previewClock.digits}
                <span class="date-time-settings__clock-seconds">
                  :{pad2(previewInstant.second)}
                </span>
                {previewClock.period && (
                  <span class="date-time-settings__clock-period">{previewClock.period}</span>
                )}
              </span>
              <span class="date-time-settings__clock-date">
                {formatDateRowLabel(previewInstant)}
              </span>
              <span class="date-time-settings__clock-mode">
                {useSystemTime ? '跟随设备时间' : '手动设定'}
              </span>
            </div>
          </div>

          <div class="settings__list">
            <div class="settings__toggle-row">
              <span class="settings__toggle-row-label">自动设置</span>
              <Switch
                checked={useSystemTime}
                onChange={handleToggleSystemTime}
                label="自动设置日期与时间"
              />
            </div>
            <div class="settings__toggle-row">
              <span class="settings__toggle-row-label">24 小时制</span>
              <Switch
                checked={use24HourTime}
                onChange={handleToggle24HourTime}
                label="24 小时制"
              />
            </div>
          </div>

          {!useSystemTime && (
            <>
              <div class="settings__list date-time-settings__rows">
                <button
                  type="button"
                  class="settings__row settings__row--button settings__row--nav"
                  onClick={() => setEditor('date')}
                >
                  <span class="settings__row-name">设置日期</span>
                  <span class="settings__row-size">{formatDateRowLabel(previewInstant)}</span>
                  <SettingsDisclosureIcon />
                </button>
                <button
                  type="button"
                  class="settings__row settings__row--button settings__row--nav"
                  onClick={() => setEditor('time')}
                >
                  <span class="settings__row-name">设置时间</span>
                  <span class="settings__row-size">
                    {formatTimeRowLabel(previewInstant, use24HourTime)}
                  </span>
                  <SettingsDisclosureIcon />
                </button>
              </div>

              <p class="settings__section-footnote">
                手动模式下时间仍会随真实秒针走动；设定后会以该时刻为起点继续计时。
              </p>
            </>
          )}

          {saveError && (
            <p class="settings__section-footnote settings__form-status--error">
              保存失败，请检查设备存储空间。
            </p>
          )}
        </section>
      </div>

      <DateTimeDatePanel
        open={editor === 'date'}
        initial={previewInstant}
        onCancel={() => setEditor(undefined)}
        onConfirm={handleConfirmDate}
      />
      <DateTimeTimePanel
        open={editor === 'time'}
        initial={previewInstant}
        onCancel={() => setEditor(undefined)}
        onConfirm={handleConfirmTime}
      />
    </div>
  )
}
