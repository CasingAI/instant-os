import { IosSwitch } from '../../ui/ios-switch.tsx'

type SettingsSwitchProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}

export function SettingsSwitch({ checked, onChange, label }: SettingsSwitchProps) {
  return <IosSwitch checked={checked} onChange={onChange} label={label} />
}
