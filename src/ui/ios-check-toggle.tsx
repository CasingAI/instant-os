type IosCheckToggleProps = {
  checked: boolean
  disabled?: boolean
  label: string
  onChange?: (checked: boolean) => void
}

export function IosCheckToggle({
  checked,
  disabled = false,
  label,
  onChange,
}: IosCheckToggleProps) {
  return (
    <button
      type="button"
      class={`ios-check-toggle${checked ? ' ios-check-toggle--on' : ''}${
        disabled ? ' ios-check-toggle--disabled' : ''
      }`}
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
