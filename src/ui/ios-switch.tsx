import './ios-switch.css'

type IosSwitchProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}

/** iOS 6 风格 UISwitch（ON/OFF 滑块） */
export function IosSwitch({ checked, onChange, label }: IosSwitchProps) {
  return (
    <label class="ios-switch">
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(event) => onChange((event.currentTarget as HTMLInputElement).checked)}
      />
      <span class="ios-switch__track" aria-hidden="true">
        <span class="ios-switch__caption ios-switch__caption--on">ON</span>
        <span class="ios-switch__caption ios-switch__caption--off">OFF</span>
        <span class="ios-switch__knob" />
      </span>
    </label>
  )
}
