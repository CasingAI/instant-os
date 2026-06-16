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

type ExperimentalFeatureProps = {
  title: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function ExperimentalFeature({ title, description, checked, onChange }: ExperimentalFeatureProps) {
  return (
    <div class="settings__experimental-feature">
      <div class="settings__list">
        <div class="settings__toggle-row">
          <span class="settings__toggle-row-label">{title}</span>
          <IosSwitch checked={checked} onChange={onChange} label={title} />
        </div>
      </div>
      <p class="settings__section-footnote">{description}</p>
    </div>
  )
}

export function ExperimentalSettingsView({ onBack }: ExperimentalSettingsViewProps) {
  const [fullscreenImmersiveChrome, setFullscreenImmersiveChrome] = useState(
    () => loadExperimentalSettings().fullscreenImmersiveChrome,
  )
  const [speechApp, setSpeechApp] = useState(
    () => loadExperimentalSettings().speechApp,
  )
  const [generatedAppLegacyLoading, setGeneratedAppLegacyLoading] = useState(
    () => !loadExperimentalSettings().generatedAppProcessIsolation,
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

  const handleToggleGeneratedAppLegacyLoading = (checked: boolean) => {
    if (!patchExperimentalSettings({ generatedAppProcessIsolation: !checked })) {
      setSaveError(true)
      return
    }

    setSaveError(false)
    setGeneratedAppLegacyLoading(checked)
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
          <div class="settings__experimental-features">
            <ExperimentalFeature
              title="全屏沉浸顶栏"
              description="开启后，窗口进入全屏时会隐藏菜单栏与标题栏；将指针移至屏幕顶部 5 像素内时，会以悬浮方式唤出菜单栏与当前窗口标题栏。"
              checked={fullscreenImmersiveChrome}
              onChange={handleToggleImmersiveChrome}
            />
            <ExperimentalFeature
              title="语音识别"
              description="开启后，语音识别应用会出现在桌面和程序坞中。"
              checked={speechApp}
              onChange={handleToggleSpeechApp}
            />
            <ExperimentalFeature
              title="停用窗口合成器加速"
              description="非系统应用默认在 sandbox 中通过 Blob URL 加载（不含同源权限）。开启后改回同源 iframe 写入，便于排查兼容问题，但子应用异常时可能拖死系统界面。切换后会重新加载已打开的非系统应用窗口。"
              checked={generatedAppLegacyLoading}
              onChange={handleToggleGeneratedAppLegacyLoading}
            />
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
