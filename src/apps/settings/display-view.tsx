import { useMemo } from 'preact/hooks'
import { BackIcon } from '../../icons/app-icons.tsx'
import { SettingsDisclosureIcon } from './settings-disclosure-icon.tsx'
import { emojiFontLabel, loadDisplaySettings } from '../../os/display-settings-storage.ts'
type DisplayViewProps = {
  onBack: () => void
  onOpenEmoji: () => void
}

export function DisplayView({ onBack, onOpenEmoji }: DisplayViewProps) {
  const emojiFontMode = useMemo(() => loadDisplaySettings().emojiFontMode, [])

  return (
    <div class="settings">
      <div class="settings__nav">
        <button type="button" class="settings__nav-back" onClick={onBack}>
          <span class="settings__nav-back-icon" aria-hidden="true">
            <BackIcon size={13} />
          </span>
          显示全部
        </button>
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">显示</h2>
          <div class="settings__list">
            <button
              type="button"
              class="settings__row settings__row--button settings__row--nav"
              onClick={onOpenEmoji}
            >
              <span class="settings__row-name">表情符号</span>
              <span class="settings__row-size">{emojiFontLabel(emojiFontMode)}</span>
              <SettingsDisclosureIcon />
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
