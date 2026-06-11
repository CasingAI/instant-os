import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'

type AccountTextFieldSubpageProps = {
  title: string
  backLabel: string
  fieldLabel: string
  value: string
  onChange: (value: string) => void
  onBack: () => void
  type?: 'text' | 'password' | 'url'
  placeholder?: string
  footnote?: string
}

export function AccountTextFieldSubpage({
  title,
  backLabel,
  fieldLabel,
  value,
  onChange,
  onBack,
  type = 'text',
  placeholder,
  footnote,
}: AccountTextFieldSubpageProps) {
  return (
    <>
      <div class="settings__nav">
        <IosNavBackButton label={backLabel} onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">{title}</h2>
          <div class="settings__box settings__form">
            <label class="settings__field settings__field--stacked">
              <span class="settings__field-label">{fieldLabel}</span>
              <input
                class="settings__input"
                type={type}
                value={value}
                placeholder={placeholder}
                autoComplete="off"
                onInput={(event) =>
                  onChange((event.currentTarget as HTMLInputElement).value)
                }
              />
            </label>
          </div>
          {footnote && <p class="settings__section-footnote">{footnote}</p>}
        </section>
      </div>
    </>
  )
}
