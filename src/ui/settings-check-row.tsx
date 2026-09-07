type SettingsCheckRowProps = {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

/**
 * iOS 设置风格勾选行：左侧标签、右侧无边框勾，整行点按切换。
 * @deprecated 已弃用，新代码不要再用；仅保留供现有调用方，后续随调用方迁移一并移除。
 */
export function SettingsCheckRow({
  label,
  checked,
  onChange,
  disabled = false,
}: SettingsCheckRowProps) {
  return (
    <button
      type="button"
      class={`settings__row settings__row--button settings__row--check${
        checked ? ' settings__row--check-on' : ''
      }${disabled ? ' settings__row--check-disabled' : ''}`}
      aria-pressed={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (disabled) return
        onChange(!checked)
      }}
    >
      <span class="settings__row-name">{label}</span>
      <span class="settings__row-check" aria-hidden="true">
        {checked ? '✓' : ''}
      </span>
    </button>
  )
}
