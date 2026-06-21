import { useState } from 'preact/hooks'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import {
  ExtAppManifestFetchError,
  useDevExtApps,
} from '../../os/dev-ext-apps-context.tsx'
import {
  loadExperimentalSettings,
  patchExperimentalSettings,
} from '../../os/experimental-settings-storage.ts'

type DeveloperSettingsViewProps = {
  onBack: () => void
}

type DeveloperFeatureProps = {
  title: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function DeveloperFeature({ title, description, checked, onChange }: DeveloperFeatureProps) {
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

export function DeveloperSettingsView({ onBack }: DeveloperSettingsViewProps) {
  const { sessionExtApps, addSessionExtApp, removeSessionExtApp, openSessionExtApp } = useDevExtApps()
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
  const [devUrl, setDevUrl] = useState('http://localhost:6175/')
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState<string | undefined>(undefined)
  const [addSuccess, setAddSuccess] = useState<string | undefined>(undefined)

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

  const handleAddDevExtApp = async () => {
    setAddBusy(true)
    setAddError(undefined)
    setAddSuccess(undefined)

    try {
      const record = await addSessionExtApp(devUrl)
      setAddSuccess(`已添加「${record.manifest.name}」到桌面`)
      window.setTimeout(() => setAddSuccess(undefined), 2500)
    } catch (error) {
      if (error instanceof ExtAppManifestFetchError) {
        setAddError(error.message)
      } else {
        setAddError('添加失败，请稍后重试')
      }
    } finally {
      setAddBusy(false)
    }
  }

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">开发者选项</h2>
          <p class="settings__section-subtitle">
            面向开发与调试的选项。部分功能可能不稳定；外链调试应用仅保存在本次会话，重启后自动消失。
          </p>

          <div class="settings__developer-ext-section">
            <h3 class="settings__section-title settings__section-title--minor">外链应用调试</h3>
            <p class="settings__section-footnote settings__section-footnote--flush">
              输入外链应用模板的本地开发地址（例如 extAppTemplate 的 pnpm dev），系统会读取
              instant-os.manifest.json 并临时添加到桌面。在 Instant OS 内打开后将走宿主真实 AI，而非模板内的
              Mock。
            </p>

            <div class="settings__box">
              <label class="settings__field">
                <span class="settings__field-label">开发服务器地址</span>
                <input
                  class="settings__input"
                  type="url"
                  placeholder="http://localhost:6175/"
                  value={devUrl}
                  disabled={addBusy}
                  onInput={(event) => setDevUrl((event.currentTarget as HTMLInputElement).value)}
                />
              </label>

              <div class="settings__actions settings__actions--in-box">
                <div class="settings__form-status" aria-live="polite">
                  {addError ? (
                    <span class="settings__form-status--error">{addError}</span>
                  ) : addSuccess ? (
                    <span class="settings__form-status--ok">{addSuccess}</span>
                  ) : undefined}
                </div>
                <button
                  type="button"
                  class="settings__btn settings__btn--default"
                  disabled={addBusy || !devUrl.trim()}
                  onClick={() => void handleAddDevExtApp()}
                >
                  {addBusy ? '正在添加…' : '添加到桌面'}
                </button>
              </div>
            </div>

            {sessionExtApps.length > 0 ? (
              <div class="settings__list settings__developer-app-list">
                <div class="settings__list-head settings__list-head--developer-app">
                  <span>应用</span>
                  <span>开发地址</span>
                  <span>操作</span>
                </div>
                <div class="settings__list-body settings__list-body--apps">
                  {sessionExtApps.map((app) => (
                    <div class="settings__row settings__row--static settings__developer-app-row" key={app.id}>
                      <span class="settings__row-name">
                        {app.manifest.name}
                        <span class="settings__row-badge settings__row-badge--dev">DEV</span>
                      </span>
                      <span class="settings__row-hint">{app.devUrl}</span>
                      <div class="settings__developer-app-actions">
                        <button
                          type="button"
                          class="settings__btn settings__btn--small"
                          onClick={() => openSessionExtApp(app.id)}
                        >
                          打开
                        </button>
                        <button
                          type="button"
                          class="settings__btn settings__btn--small settings__btn--danger"
                          onClick={() => removeSessionExtApp(app.id)}
                        >
                          移除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p class="settings__section-footnote settings__section-footnote--flush">
                当前会话尚未添加外链调试应用。
              </p>
            )}
          </div>

          <div class="settings__experimental-features">
            <DeveloperFeature
              title="全屏沉浸顶栏"
              description="开启后，窗口进入全屏时会隐藏菜单栏与标题栏；将指针移至屏幕顶部 5 像素内时，会以悬浮方式唤出菜单栏与当前窗口标题栏。"
              checked={fullscreenImmersiveChrome}
              onChange={handleToggleImmersiveChrome}
            />
            <DeveloperFeature
              title="语音识别"
              description="开启后，语音识别应用会出现在桌面和程序坞中。"
              checked={speechApp}
              onChange={handleToggleSpeechApp}
            />
            <DeveloperFeature
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

/** @deprecated 使用 DeveloperSettingsView */
export const ExperimentalSettingsView = DeveloperSettingsView
