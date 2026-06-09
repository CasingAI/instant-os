type SettingsSwitchProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}

export function SettingsSwitch({ checked, onChange, label }: SettingsSwitchProps) {
  return (
    <label class="settings__switch">
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(event) => onChange((event.currentTarget as HTMLInputElement).checked)}
      />
      <span class="settings__switch-track" aria-hidden="true">
        <span class="settings__switch-caption settings__switch-caption--on">ON</span>
        <span class="settings__switch-caption settings__switch-caption--off">OFF</span>
        <span class="settings__switch-knob" />
      </span>
    </label>
  )
}
