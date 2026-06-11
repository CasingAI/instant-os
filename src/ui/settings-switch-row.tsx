import { IosSwitch } from './ios-switch.tsx'

type SettingsSwitchRowProps = {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

export function SettingsSwitchRow({ label, checked, onChange }: SettingsSwitchRowProps) {
  return (
    <div class="settings__row settings__row--static settings__row--switch">
      <span class="settings__row-name">{label}</span>
      <IosSwitch checked={checked} onChange={onChange} label={label} />
    </div>
  )
}
