import { createPortal } from 'preact/compat'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { ForwardIcon } from '../icons/app-icons.tsx'
import { useOverlayPresence } from './use-overlay-presence.ts'
import './overlay-presence.css'

type SettingsStepperRowProps = {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** 展示在数字旁的单位，如 "px" */
  unit?: string
  formatValue?: (value: number) => string
  disabled?: boolean
  /** 模态内允许直接输入；默认 true */
  editable?: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function resolveOverlayHost(from: HTMLElement | null): HTMLElement | null {
  if (!from) return null
  return (
    from.closest('.settings') ??
    from.closest('.vscode__settings') ??
    from.closest('.ui-kit-demo__variant') ??
    null
  )
}

const STEPPER_HOLD_DELAY_MS = 360
const STEPPER_HOLD_INTERVAL_MS = 60

function SettingsStepperControls({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  editable,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step: number
  unit?: string
  editable: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const valueRef = useRef(value)
  const holdTimerRef = useRef<number | undefined>(undefined)
  const holdIntervalRef = useRef<number | undefined>(undefined)
  const [draft, setDraft] = useState(String(value))
  const [editing, setEditing] = useState(false)
  const atMin = value <= min
  const atMax = value >= max

  valueRef.current = value

  useEffect(() => {
    if (!editing) setDraft(String(value))
  }, [editing, value])

  useEffect(() => {
    return () => {
      if (holdTimerRef.current !== undefined) window.clearTimeout(holdTimerRef.current)
      if (holdIntervalRef.current !== undefined) window.clearInterval(holdIntervalRef.current)
    }
  }, [])

  const commit = (raw: number) => {
    if (!Number.isFinite(raw)) return
    const next = clamp(Math.round(raw / step) * step, min, max)
    if (next !== valueRef.current) onChange(next)
    setDraft(String(next))
    valueRef.current = next
  }

  const stopHold = () => {
    if (holdTimerRef.current !== undefined) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = undefined
    }
    if (holdIntervalRef.current !== undefined) {
      window.clearInterval(holdIntervalRef.current)
      holdIntervalRef.current = undefined
    }
  }

  const startHold = (delta: number) => {
    setEditing(false)
    stopHold()
    commit(valueRef.current + delta)
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = undefined
      holdIntervalRef.current = window.setInterval(() => {
        const current = valueRef.current
        const next = clamp(Math.round((current + delta) / step) * step, min, max)
        if (next === current) {
          stopHold()
          return
        }
        commit(next)
      }, STEPPER_HOLD_INTERVAL_MS)
    }, STEPPER_HOLD_DELAY_MS)
  }

  const commitDraft = () => {
    const text = draft.trim()
    if (text === '' || text === '-' || text === '+') {
      setDraft(String(value))
      return
    }
    const next = Number(text)
    if (!Number.isFinite(next)) {
      setDraft(String(value))
      return
    }
    commit(next)
  }

  return (
    <div class="settings-stepper-modal__control" role="group" aria-label={label}>
      <button
        type="button"
        class="settings-stepper-modal__btn"
        aria-label={`减少${label}`}
        disabled={atMin}
        onPointerDown={(event) => {
          if (event.button !== 0 || atMin) return
          event.preventDefault()
          ;(event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId)
          startHold(-step)
        }}
        onPointerUp={stopHold}
        onPointerCancel={stopHold}
        onLostPointerCapture={stopHold}
      >
        <span class="settings-stepper-modal__glyph settings-stepper-modal__glyph--minus" aria-hidden="true" />
      </button>

      <div class="settings-stepper-modal__value">
        {editable ? (
          <input
            ref={inputRef}
            class="settings-stepper-modal__input"
            type="text"
            inputMode="numeric"
            autocomplete="off"
            spellcheck={false}
            value={editing ? draft : String(value)}
            aria-label={label}
            onFocus={() => {
              setEditing(true)
              setDraft(String(value))
              requestAnimationFrame(() => inputRef.current?.select())
            }}
            onBlur={() => {
              commitDraft()
              setEditing(false)
            }}
            onInput={(event) => {
              const text = (event.target as HTMLInputElement).value
              if (text !== '' && !/^-?\d*$/.test(text)) return
              setDraft(text)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                commit(value + step)
              } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                commit(value - step)
              } else if (event.key === 'Enter') {
                event.preventDefault()
                commitDraft()
                ;(event.target as HTMLInputElement).blur()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setDraft(String(value))
                setEditing(false)
                ;(event.target as HTMLInputElement).blur()
              }
            }}
          />
        ) : (
          <span class="settings-stepper-modal__digit">{value}</span>
        )}
        {unit ? <span class="settings-stepper-modal__unit">{unit}</span> : undefined}
      </div>

      <button
        type="button"
        class="settings-stepper-modal__btn"
        aria-label={`增加${label}`}
        disabled={atMax}
        onPointerDown={(event) => {
          if (event.button !== 0 || atMax) return
          event.preventDefault()
          ;(event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId)
          startHold(step)
        }}
        onPointerUp={stopHold}
        onPointerCancel={stopHold}
        onLostPointerCapture={stopHold}
      >
        <span class="settings-stepper-modal__glyph settings-stepper-modal__glyph--plus" aria-hidden="true" />
      </button>
    </div>
  )
}

function SettingsStepperModal({
  host,
  titleId,
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
  editable,
  exiting,
  onClose,
}: {
  host: HTMLElement
  titleId: string
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step: number
  unit?: string
  editable: boolean
  exiting: boolean
  onClose: () => void
}) {
  useEffect(() => {
    if (exiting) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [exiting, onClose])

  return createPortal(
    <div
      class={[
        'settings-stepper-modal__backdrop',
        'overlay-presence__backdrop',
        exiting ? 'overlay-presence__backdrop--exiting' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="presentation"
      onClick={onClose}
    >
      <div
        class={[
          'settings-stepper-modal',
          'overlay-presence__sheet',
          exiting ? 'overlay-presence__sheet--exiting' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header class="settings-stepper-modal__header">
          <h3 class="settings-stepper-modal__title" id={titleId}>
            {label}
          </h3>
        </header>

        <div class="settings-stepper-modal__body">
          <SettingsStepperControls
            label={label}
            value={value}
            onChange={onChange}
            min={min}
            max={max}
            step={step}
            unit={unit}
            editable={editable}
          />
          {Number.isFinite(min) || Number.isFinite(max) ? (
            <p class="settings-stepper-modal__hint">
              {Number.isFinite(min) && Number.isFinite(max)
                ? `${min} – ${max}`
                : Number.isFinite(min)
                  ? `≥ ${min}`
                  : `≤ ${max}`}
            </p>
          ) : undefined}
        </div>

        <footer class="settings-stepper-modal__footer">
          <button
            type="button"
            class="settings-stepper-modal__done"
            onClick={onClose}
          >
            完成
          </button>
        </footer>
      </div>
    </div>,
    host,
  )
}

/** 设置列表数字行：点击后弹出模态，在模态内用步进器调节。 */
export function SettingsStepperRow({
  label,
  value,
  onChange,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  unit,
  formatValue,
  disabled = false,
  editable = true,
}: SettingsStepperRowProps) {
  const titleId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const { mounted, exiting } = useOverlayPresence(open)

  const display =
    formatValue?.(value) ?? (unit ? `${value} ${unit}` : String(value))

  const close = () => setOpen(false)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        class="settings__row settings__row--button settings__row--nav settings__row--stepper"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setHost(resolveOverlayHost(triggerRef.current))
          setOpen(true)
        }}
      >
        <span class="settings__row-name">{label}</span>
        <span class="settings__row-size">{display}</span>
        <span class="settings__disclosure" aria-hidden="true">
          <ForwardIcon size={13} />
        </span>
      </button>

      {mounted && host ? (
        <SettingsStepperModal
          host={host}
          titleId={titleId}
          label={label}
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          step={step}
          unit={unit}
          editable={editable}
          exiting={exiting}
          onClose={close}
        />
      ) : undefined}
    </>
  )
}
