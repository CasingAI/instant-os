import { useState } from 'preact/hooks'
import { BackIcon } from '../../icons/app-icons.tsx'
import { SettingsSwitch } from './settings-switch.tsx'
import {
  loadExperimentalSettings,
  patchExperimentalSettings,
} from '../../os/experimental-settings-storage.ts'
import { useOs } from '../../os/os-context.tsx'

type DeveloperSettingsViewProps = {
  onBack: () => void
}

export function DeveloperSettingsView({ onBack }: DeveloperSettingsViewProps) {
  const { closeWindowsForApp } = useOs()
  const [icodeEnabled, setIcodeEnabled] = useState(() => loadExperimentalSettings().icodeEnabled)
  const [saveError, setSaveError] = useState(false)

  const handleToggleIcode = (nextEnabled: boolean) => {
    if (!patchExperimentalSettings({ icodeEnabled: nextEnabled })) {
      setSaveError(true)
      return
    }

    setSaveError(false)
    setIcodeEnabled(nextEnabled)

    if (!nextEnabled) {
      closeWindowsForApp('icode')
    }
  }

  return (
    <div class="settings">
      <div class="settings__nav">
        <button type="button" class="settings__nav-back" onClick={onBack}>
          <span class="settings__nav-back-icon" aria-hidden="true">
            <BackIcon size={13} />
          </span>
          实验性特性
        </button>
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">开发者</h2>
          <p class="settings__section-subtitle">面向内部开发与调试的工具。</p>
          <div class="settings__list">
            <div class="settings__toggle-row">
              <span class="settings__toggle-row-label">启用 iCode</span>
              <SettingsSwitch
                checked={icodeEnabled}
                label="启用 iCode"
                onChange={handleToggleIcode}
              />
            </div>
          </div>
          <p class="settings__section-footnote">
            在桌面与程序坞显示 iCode 内部开发环境。
          </p>
          {saveError && (
            <p class="settings__section-footnote settings__section-footnote--error">
              无法保存设置，设备存储空间可能已满。
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
