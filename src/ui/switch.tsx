import './switch.css'

type SwitchProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}

/** ON/OFF 滑块开关 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: SwitchProps) {
  return (
    <label class={`switch${disabled ? ' switch--disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          if (disabled) return
          onChange((event.currentTarget as HTMLInputElement).checked)
        }}
      />
      <span class="switch__track" aria-hidden="true">
        <span class="switch__caption switch__caption--on">ON</span>
        <span class="switch__caption switch__caption--off">OFF</span>
        <span class="switch__knob" />
      </span>
    </label>
  )
}
