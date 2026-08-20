type IosCheckToggleSize = 'default' | 'small'

type IosCheckToggleProps = {
  checked: boolean
  disabled?: boolean
  label: string
  size?: IosCheckToggleSize
  onChange?: (checked: boolean) => void
}

export function IosCheckToggle({
  checked,
  disabled = false,
  label,
  size = 'default',
  onChange,
}: IosCheckToggleProps) {
  return (
    <button
      type="button"
      class={`ios-check-toggle${size === 'small' ? ' ios-check-toggle--small' : ''}${
        checked ? ' ios-check-toggle--on' : ''
      }${disabled ? ' ios-check-toggle--disabled' : ''}`}
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
        <span class="ios-check-toggle__mark" aria-hidden="true">
          ✓
        </span>
      )}
    </button>
  )
}
