import { Switch } from './switch.tsx'

type SettingsSwitchRowProps = {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /** 开关下方的说明（如强制代理提示） */
  detail?: string
}

/**
 * @deprecated 已弃用，新代码不要再用；仅保留供现有调用方，后续随调用方迁移一并移除。
 */
export function SettingsSwitchRow({
  label,
  checked,
  onChange,
  disabled = false,
  detail,
}: SettingsSwitchRowProps) {
  return (
    <div
      class={`settings__row settings__row--static settings__row--switch${
        disabled ? ' settings__row--switch-disabled' : ''
      }${detail ? ' settings__row--switch-with-detail' : ''}`}
    >
      <span class="settings__row-name">{label}</span>
      <Switch
        checked={checked}
        onChange={onChange}
        label={label}
        disabled={disabled}
      />
      {detail ? <p class="settings__row-switch-detail">{detail}</p> : undefined}
    </div>
  )
}
