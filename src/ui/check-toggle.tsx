type CheckToggleSize = 'default' | 'small'

type CheckToggleProps = {
  checked: boolean
  disabled?: boolean
  label: string
  size?: CheckToggleSize
  onChange?: (checked: boolean) => void
}

/**
 * @deprecated 已弃用，新代码不要再用；仅保留供现有调用方，后续随调用方迁移一并移除。
 */
export function CheckToggle({
  checked,
  disabled = false,
  label,
  size = 'default',
  onChange,
}: CheckToggleProps) {
  return (
    <button
      type="button"
      class={`check-toggle${size === 'small' ? ' check-toggle--small' : ''}${
        checked ? ' check-toggle--on' : ''
      }${disabled ? ' check-toggle--disabled' : ''}`}
      aria-pressed={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        if (disabled || !onChange) {
          return
        }
        onChange(!checked)
      }}
    >
      {checked && (
        <span class="check-toggle__mark" aria-hidden="true">
          ✓
        </span>
      )}
    </button>
  )
}
