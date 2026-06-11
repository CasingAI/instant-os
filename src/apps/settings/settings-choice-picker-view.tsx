import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import {
  SettingsChoiceOptionList,
  type SettingsChoiceOption,
} from '../../ui/settings-choice-option-list.tsx'

type SettingsChoicePickerViewProps = {
  title: string
  backLabel: string
  options: readonly SettingsChoiceOption[]
  value: string
  onChange: (value: string) => void
  onBack: () => void
  footnote?: string
}

export function SettingsChoicePickerView({
  title,
  backLabel,
  options,
  value,
  onChange,
  onBack,
  footnote,
}: SettingsChoicePickerViewProps) {
  return (
    <>
      <div class="settings__nav">
        <IosNavBackButton label={backLabel} onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">{title}</h2>
          <SettingsChoiceOptionList
            options={options}
            value={value}
            onChange={onChange}
            ariaLabel={title}
          />
          {footnote && <p class="settings__section-footnote">{footnote}</p>}
        </section>
      </div>
    </>
  )
}
