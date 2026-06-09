import { useState } from 'preact/hooks'
import { BackIcon } from '../../icons/app-icons.tsx'
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
          <div class="settings__box">
            <label class="settings__form-row settings__form-row--toggle">
              <span>
                <span class="settings__row-name">启用 iCode</span>
                <span class="settings__section-subtitle settings__section-subtitle--inline">
                  在桌面与程序坞显示 iCode 内部开发环境。
                </span>
              </span>
              <span class="settings__checkbox">
                <input
                  type="checkbox"
                  checked={icodeEnabled}
                  onChange={(event) =>
                    handleToggleIcode((event.currentTarget as HTMLInputElement).checked)
                  }
                />
                <span class="settings__checkbox-label">{icodeEnabled ? '已启用' : '已关闭'}</span>
              </span>
            </label>
          </div>
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
