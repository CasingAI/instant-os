import { Switch } from '../../ui/switch.tsx'

type SettingsSwitchProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}

export function SettingsSwitch({ checked, onChange, label }: SettingsSwitchProps) {
  return <Switch checked={checked} onChange={onChange} label={label} />
}
