import { useState } from 'preact/hooks'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import {
  loadExperimentalSettings,
  patchExperimentalSettings,
} from '../../os/experimental-settings-storage.ts'

type ExperimentalSettingsViewProps = {
  onBack: () => void
}

export function ExperimentalSettingsView({ onBack }: ExperimentalSettingsViewProps) {
  const [fullscreenImmersiveChrome, setFullscreenImmersiveChrome] = useState(
    () => loadExperimentalSettings().fullscreenImmersiveChrome,
  )
  const [speechApp, setSpeechApp] = useState(
    () => loadExperimentalSettings().speechApp,
  )
  const [saveError, setSaveError] = useState(false)

  const handleToggleImmersiveChrome = (checked: boolean) => {
    if (!patchExperimentalSettings({ fullscreenImmersiveChrome: checked })) {
      setSaveError(true)
      return
    }

    setSaveError(false)
    setFullscreenImmersiveChrome(checked)
  }

  const handleToggleSpeechApp = (checked: boolean) => {
    if (!patchExperimentalSettings({ speechApp: checked })) {
      setSaveError(true)
      return
    }

    setSaveError(false)
    setSpeechApp(checked)
  }

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
            <div class="settings__toggle-row">
              <span class="settings__toggle-row-label">全屏沉浸顶栏</span>
              <IosSwitch
                checked={fullscreenImmersiveChrome}
                onChange={handleToggleImmersiveChrome}
                label="全屏沉浸顶栏"
              />
            </div>
            <div class="settings__toggle-row">
              <span class="settings__toggle-row-label">语音识别</span>
              <IosSwitch
                checked={speechApp}
                onChange={handleToggleSpeechApp}
                label="语音识别"
              />
            </div>
          </div>
          <p class="settings__section-footnote">
            开启后，窗口进入全屏时会隐藏菜单栏与标题栏；将指针移至屏幕顶部 5
            像素内时，会以悬浮方式唤出菜单栏与当前窗口标题栏。
          </p>
          <p class="settings__section-footnote">
            开启后，语音识别应用会出现在桌面和程序坞中。
          </p>
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
