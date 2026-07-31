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
  /** 允许点击数值直接输入；默认 true */
  editable?: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 设置列表内的数字步进器：标签 + [−] 值 [+] */
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
  const display =
    formatValue?.(value) ?? (unit ? `${value} ${unit}` : String(value))
  const atMin = value <= min
  const atMax = value >= max

  const commit = (raw: number) => {
    if (!Number.isFinite(raw)) return
    const next = clamp(Math.round(raw / step) * step, min, max)
    if (next !== value) onChange(next)
  }

  return (
    <div class="settings__row settings__row--static settings__row--stepper">
      <span class="settings__row-name">{label}</span>
      <div class="settings__stepper" role="group" aria-label={label}>
        <button
          type="button"
          class="settings__stepper-btn"
          aria-label={`减少${label}`}
          disabled={disabled || atMin}
          onClick={() => commit(value - step)}
        >
          −
        </button>
        {editable ? (
          <input
            class="settings__stepper-input"
            type="number"
            inputMode="numeric"
            min={Number.isFinite(min) ? min : undefined}
            max={Number.isFinite(max) ? max : undefined}
            step={step}
            value={value}
            disabled={disabled}
            aria-label={label}
            onInput={(event) => {
              const text = (event.target as HTMLInputElement).value.trim()
              if (text === '' || text === '-' || text === '+') return
              const next = Number(text)
              if (!Number.isFinite(next)) return
              commit(next)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                commit(value + step)
              } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                commit(value - step)
              }
            }}
          />
        ) : (
          <span class="settings__stepper-value">{display}</span>
        )}
        <button
          type="button"
          class="settings__stepper-btn"
          aria-label={`增加${label}`}
          disabled={disabled || atMax}
          onClick={() => commit(value + step)}
        >
          +
        </button>
      </div>
    </div>
  )
}
