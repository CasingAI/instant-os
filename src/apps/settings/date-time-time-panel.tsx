import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  normalizeCalendarInstant,
  type CalendarInstant,
} from '../../os/calendar-instant.ts'
import { DateTimePanelPortal } from '../../ui/date-time-panel-portal.tsx'
import { useOverlayPresence } from '../../ui/use-overlay-presence.ts'
import '../../ui/date-time-panel.css'
import { DateTimeWheelColumn } from './date-time-wheel-column.tsx'

type DateTimeTimePanelProps = {
  open: boolean
  initial: CalendarInstant
  onCancel: () => void
  onConfirm: (next: CalendarInstant) => void
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function DateTimeTimePanel({
  open,
  initial,
  onCancel,
  onConfirm,
}: DateTimeTimePanelProps) {
  const { mounted, exiting } = useOverlayPresence(open)
  const [draft, setDraft] = useState(() => normalizeCalendarInstant(initial))
  const [hourText, setHourText] = useState(pad2(initial.hour))
  const [minuteText, setMinuteText] = useState(pad2(initial.minute))

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), [])
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, i) => i), [])

  const initialRef = useRef(initial)
  initialRef.current = initial

  useEffect(() => {
    if (!open) {
      return
    }
    const next = normalizeCalendarInstant(initialRef.current)
    setDraft(next)
    setHourText(pad2(next.hour))
    setMinuteText(pad2(next.minute))
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
    const next = normalizeCalendarInstant({ ...draft, ...patch })
    setDraft(next)
    setHourText(pad2(next.hour))
    setMinuteText(pad2(next.minute))
    return next
  }

  const applyFieldTexts = () => {
    const hour = Number(hourText)
    const minute = Number(minuteText)
    const patch: Partial<CalendarInstant> = { second: 0, millisecond: 0 }
    if (Number.isFinite(hour)) {
      patch.hour = hour
    }
    if (Number.isFinite(minute)) {
      patch.minute = minute
    }
    if (patch.hour === undefined && patch.minute === undefined) {
      setHourText(pad2(draft.hour))
      setMinuteText(pad2(draft.minute))
      return
    }
    commitDraft(patch)
  }

  const handleConfirm = () => {
    const hour = Number(hourText)
    const minute = Number(minuteText)
    const next = normalizeCalendarInstant({
      ...draft,
      hour: Number.isFinite(hour) ? hour : draft.hour,
      minute: Number.isFinite(minute) ? minute : draft.minute,
      second: 0,
      millisecond: 0,
    })
    onConfirm(next)
  }

  if (!mounted) {
    return undefined
  }

  return (
    <DateTimePanelPortal>
      <div class="date-time-panel" role="presentation">
        <button
          type="button"
          class={`date-time-panel__backdrop${exiting ? ' date-time-panel__backdrop--exiting' : ''}`}
          aria-label="关闭"
          onClick={exiting ? undefined : onCancel}
        />
        <div
          class={`date-time-panel__sheet date-time-panel__sheet--time${exiting ? ' date-time-panel__sheet--exiting' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label="设定时间"
          onClick={(event) => event.stopPropagation()}
        >
          <header class="date-time-panel__header">
            <button type="button" class="date-time-panel__header-btn" onClick={onCancel}>
              取消
            </button>
            <span class="date-time-panel__header-title">设定时间</span>
            <button
              type="button"
              class="date-time-panel__header-btn date-time-panel__header-btn--accent"
              onClick={handleConfirm}
            >
              设定
            </button>
          </header>

          <div class="date-time-panel__inputs date-time-panel__inputs--time">
            <label class="date-time-panel__field date-time-panel__field--grow">
              <span class="date-time-panel__field-label">时</span>
              <input
                class="date-time-panel__control date-time-panel__control--center"
                type="text"
                inputMode="numeric"
                value={hourText}
                onInput={(event) => setHourText((event.currentTarget as HTMLInputElement).value)}
                onBlur={applyFieldTexts}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    applyFieldTexts()
                  }
                }}
              />
            </label>
            <span class="date-time-panel__colon" aria-hidden="true">
              :
            </span>
            <label class="date-time-panel__field date-time-panel__field--grow">
              <span class="date-time-panel__field-label">分</span>
              <input
                class="date-time-panel__control date-time-panel__control--center"
                type="text"
                inputMode="numeric"
                value={minuteText}
                onInput={(event) => setMinuteText((event.currentTarget as HTMLInputElement).value)}
                onBlur={applyFieldTexts}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    applyFieldTexts()
                  }
                }}
              />
            </label>
          </div>

          <div class="date-time-panel__wheels date-time-panel__wheels--time">
            <DateTimeWheelColumn
              label="时"
              values={hours}
              value={draft.hour}
              formatValue={pad2}
              onChange={(hour) => commitDraft({ hour, second: 0, millisecond: 0 })}
            />
            <DateTimeWheelColumn
              label="分"
              values={minutes}
              value={draft.minute}
              formatValue={pad2}
              onChange={(minute) => commitDraft({ minute, second: 0, millisecond: 0 })}
            />
          </div>

          <p class="date-time-panel__hint">可直接输入时/分，或拨动滚轮选择。</p>
        </div>
      </div>
    </DateTimePanelPortal>
  )
}
