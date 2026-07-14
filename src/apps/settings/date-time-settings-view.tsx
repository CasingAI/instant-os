import { useEffect, useMemo, useState } from 'preact/hooks'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import {
  formatCalendarInstantLabel,
  getDaysInMonth,
  normalizeCalendarInstant,
  type CalendarEra,
  type CalendarInstant,
} from '../../os/calendar-instant.ts'
import {
  applyOsManualDateTime,
  applyOsSystemDateTime,
  calendarInstantFromSystemNow,
  getOsNowInstant,
  isOsUsingSystemTime,
  loadDateTimeSettings,
  OS_CLOCK_CHANGED_EVENT,
} from '../../os/os-clock.ts'
import './date-time-settings-view.css'

type DateTimeSettingsViewProps = {
  onBack: () => void
}

function cloneInstant(instant: CalendarInstant): CalendarInstant {
  return { ...instant }
}

export function DateTimeSettingsView({ onBack }: DateTimeSettingsViewProps) {
  const initialSettings = useMemo(() => loadDateTimeSettings(), [])
  const [useSystemTime, setUseSystemTime] = useState(() => initialSettings.useSystemTime)
  const [draft, setDraft] = useState<CalendarInstant>(() =>
    initialSettings.useSystemTime
      ? calendarInstantFromSystemNow()
      : cloneInstant(getOsNowInstant()),
  )
  const [previewInstant, setPreviewInstant] = useState(() => getOsNowInstant())
  const [saveError, setSaveError] = useState(false)

  useEffect(() => {
    const syncPreview = () => setPreviewInstant(getOsNowInstant())
    syncPreview()
    const intervalId = window.setInterval(syncPreview, 1000)
    window.addEventListener(OS_CLOCK_CHANGED_EVENT, syncPreview)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener(OS_CLOCK_CHANGED_EVENT, syncPreview)
    }
  }, [useSystemTime, draft])

  const maxDay = getDaysInMonth(draft.era, draft.year, draft.month)

  const handleToggleSystemTime = (checked: boolean) => {
    setSaveError(false)
    if (checked) {
      const saved = applyOsSystemDateTime()
      if (!saved) {
        setSaveError(true)
        return
      }
      setUseSystemTime(true)
      setDraft(calendarInstantFromSystemNow())
      return
    }

    const nextDraft = calendarInstantFromSystemNow()
    const saved = applyOsManualDateTime(nextDraft)
    if (!saved) {
      setSaveError(true)
      return
    }
    setUseSystemTime(false)
    setDraft(nextDraft)
  }

  const handleApplyManual = () => {
    setSaveError(false)
    const normalized = normalizeCalendarInstant(draft)
    const saved = applyOsManualDateTime(normalized)
    if (!saved) {
      setSaveError(true)
      return
    }
    setUseSystemTime(false)
    setDraft(normalized)
  }

  const handleUseSystemNow = () => {
    setSaveError(false)
    const systemNow = calendarInstantFromSystemNow()
    const saved = applyOsManualDateTime(systemNow)
    if (!saved) {
      setSaveError(true)
      return
    }
    setUseSystemTime(false)
    setDraft(systemNow)
  }

  const updateDraft = (patch: Partial<CalendarInstant>) => {
    setDraft((current) => normalizeCalendarInstant({ ...current, ...patch }))
  }

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">日期与时间</h2>
          <p class="settings__section-subtitle">
            手动设置后，系统界面与 AI 生成内容都会以这里的日期与时间为准；可设置到公元前。
          </p>

          <div class="settings__list">
            <div class="settings__toggle-row">
              <span class="settings__toggle-row-label">自动设置</span>
              <IosSwitch
                checked={useSystemTime}
                onChange={handleToggleSystemTime}
                label="自动设置日期与时间"
              />
            </div>
          </div>

          <div class="date-time-settings__preview">
            <span class="date-time-settings__preview-label">当前系统时间</span>
            <strong class="date-time-settings__preview-value">
              {formatCalendarInstantLabel(previewInstant)}
            </strong>
          </div>

          {!useSystemTime && (
            <div class="settings__box date-time-settings__editor">
              <div class="date-time-settings__field-row">
                <label class="settings__field date-time-settings__field">
                  <span class="settings__field-label">纪年</span>
                  <select
                    class="settings__input"
                    value={draft.era}
                    onChange={(event) =>
                      updateDraft({
                        era: (event.currentTarget as HTMLSelectElement).value as CalendarEra,
                      })
                    }
                  >
                    <option value="AD">公元</option>
                    <option value="BC">公元前</option>
                  </select>
                </label>
                <label class="settings__field date-time-settings__field">
                  <span class="settings__field-label">年</span>
                  <input
                    class="settings__input"
                    type="number"
                    min={1}
                    step={1}
                    value={draft.year}
                    onInput={(event) =>
                      updateDraft({
                        year: Number((event.currentTarget as HTMLInputElement).value),
                      })
                    }
                  />
                </label>
              </div>

              <div class="date-time-settings__field-row">
                <label class="settings__field date-time-settings__field">
                  <span class="settings__field-label">月</span>
                  <input
                    class="settings__input"
                    type="number"
                    min={1}
                    max={12}
                    value={draft.month}
                    onInput={(event) =>
                      updateDraft({
                        month: Number((event.currentTarget as HTMLInputElement).value),
                      })
                    }
                  />
                </label>
                <label class="settings__field date-time-settings__field">
                  <span class="settings__field-label">日</span>
                  <input
                    class="settings__input"
                    type="number"
                    min={1}
                    max={maxDay}
                    value={draft.day}
                    onInput={(event) =>
                      updateDraft({
                        day: Number((event.currentTarget as HTMLInputElement).value),
                      })
                    }
                  />
                </label>
              </div>

              <div class="date-time-settings__field-row">
                <label class="settings__field date-time-settings__field">
                  <span class="settings__field-label">时</span>
                  <input
                    class="settings__input"
                    type="number"
                    min={0}
                    max={23}
                    value={draft.hour}
                    onInput={(event) =>
                      updateDraft({
                        hour: Number((event.currentTarget as HTMLInputElement).value),
                      })
                    }
                  />
                </label>
                <label class="settings__field date-time-settings__field">
                  <span class="settings__field-label">分</span>
                  <input
                    class="settings__input"
                    type="number"
                    min={0}
                    max={59}
                    value={draft.minute}
                    onInput={(event) =>
                      updateDraft({
                        minute: Number((event.currentTarget as HTMLInputElement).value),
                      })
                    }
                  />
                </label>
              </div>

              <div class="settings__actions settings__actions--in-box">
                <button
                  type="button"
                  class="settings__btn settings__btn--default"
                  onClick={handleApplyManual}
                >
                  应用日期与时间
                </button>
                <button
                  type="button"
                  class="settings__btn"
                  onClick={handleUseSystemNow}
                >
                  使用当前真实时间
                </button>
              </div>
            </div>
          )}

          {saveError && (
            <p class="settings__section-footnote settings__form-status--error">
              保存失败，请检查设备存储空间。
            </p>
          )}

          {!useSystemTime && (
            <p class="settings__section-footnote">
              手动模式下时间仍会随真实秒针走动；应用后会以你设定的时刻为起点继续计时。
              {isOsUsingSystemTime() ? '' : ' 当前已启用手动日期。'}
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
