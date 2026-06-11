type SettingsInlineInputRowProps = {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'password' | 'url'
  placeholder?: string
}

export function SettingsInlineInputRow({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: SettingsInlineInputRowProps) {
  return (
    <label class="settings__row settings__row--static settings__row--inline-input">
      <span class="settings__row-name">{label}</span>
      <input
        class="settings__input settings__input--list"
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onInput={(event) => onChange((event.currentTarget as HTMLInputElement).value)}
      />
    </label>
  )
}
