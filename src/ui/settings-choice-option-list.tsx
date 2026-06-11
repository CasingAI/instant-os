export type SettingsChoiceOption = {
  id: string
  label: string
}

type SettingsChoiceOptionListProps = {
  options: readonly SettingsChoiceOption[]
  value: string
  onChange: (value: string) => void
  ariaLabel: string
}

export function SettingsChoiceOptionList({
  options,
  value,
  onChange,
  ariaLabel,
}: SettingsChoiceOptionListProps) {
  return (
    <div class="settings__list" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          class="settings__option-row"
          role="radio"
          aria-checked={value === option.id}
          onClick={() => onChange(option.id)}
        >
          <span class="settings__option-label">{option.label}</span>
          {value === option.id && (
            <span class="settings__option-check" aria-hidden="true">
              ✓
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
