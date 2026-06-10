import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { SettingsDisclosureIcon } from './settings-disclosure-icon.tsx'

type ExperimentalSettingsViewProps = {
  onBack: () => void
  onOpenDeveloper: () => void
}

export function ExperimentalSettingsView({ onBack, onOpenDeveloper }: ExperimentalSettingsViewProps) {
  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">实验性特性</h2>
          <p class="settings__section-subtitle">这些功能仍在开发中，可能不稳定或随时调整。</p>
          <div class="settings__list">
            <button
              type="button"
              class="settings__row settings__row--button settings__row--nav"
              onClick={onOpenDeveloper}
            >
              <span class="settings__row-name">开发者</span>
              <SettingsDisclosureIcon />
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
