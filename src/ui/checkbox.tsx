import './checkbox.css'

type CheckboxProps = {
  checked: boolean
  onChange?: (checked: boolean) => void
  /** 可见文字，兼作无障碍标签 */
  label?: string
  disabled?: boolean
}

/** macOS Aqua 风格方形勾选框：原生 input + 皮肤，勾选态固定系统蓝、不跟随主题色。 */
export function Checkbox({ checked, onChange, label, disabled = false }: CheckboxProps) {
  return (
    <label class={`checkbox${disabled ? ' checkbox--disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          if (disabled || !onChange) return
          onChange((event.currentTarget as HTMLInputElement).checked)
        }}
      />
      <span class="checkbox__box" aria-hidden="true" />
      {label && <span class="checkbox__text">{label}</span>}
    </label>
  )
}
