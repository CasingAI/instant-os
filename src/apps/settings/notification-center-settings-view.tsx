import { useState } from 'preact/hooks'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import {
  loadNotificationCenterSettings,
  patchNotificationCenterSettings,
} from '../../os/notification-center-settings-storage.ts'

type NotificationCenterSettingsViewProps = {
  onBack: () => void
}

export function NotificationCenterSettingsView({ onBack }: NotificationCenterSettingsViewProps) {
  const [showWeather, setShowWeather] = useState(
    () => loadNotificationCenterSettings().showWeather,
  )
  const [showStocks, setShowStocks] = useState(() => loadNotificationCenterSettings().showStocks)
  const [saveError, setSaveError] = useState(false)

  const handleToggle =
    (key: 'showWeather' | 'showStocks', setter: (value: boolean) => void) =>
    (checked: boolean) => {
      if (!patchNotificationCenterSettings({ [key]: checked })) {
        setSaveError(true)
        return
      }
      setSaveError(false)
      setter(checked)
    }

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">通知中心</h2>
          <p class="settings__section-subtitle">选择在通知中心顶部显示的内容。</p>

          <div class="settings__list">
            <div class="settings__toggle-row">
              <span class="settings__toggle-row-label">天气</span>
              <IosSwitch
                checked={showWeather}
                onChange={handleToggle('showWeather', setShowWeather)}
                label="显示天气"
              />
            </div>
            <div class="settings__toggle-row">
              <span class="settings__toggle-row-label">股票</span>
              <IosSwitch
                checked={showStocks}
                onChange={handleToggle('showStocks', setShowStocks)}
                label="显示股票"
              />
            </div>
          </div>

          {saveError && (
            <p class="settings__section-footnote settings__form-status--error">
              保存失败，请检查设备存储空间。
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
