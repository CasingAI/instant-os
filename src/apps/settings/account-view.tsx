import { useMemo, useState } from 'preact/hooks'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { AccountSettingsForm } from '../../os/account-settings-form.tsx'
import {
  defaultAccountSettings,
  loadAccountSettings,
  saveAccountSettings,
  type AccountSettings,
} from '../../os/account-settings-storage.ts'
type AccountViewProps = {
  onBack: () => void
}

type SaveState = 'idle' | 'saved' | 'error'

export function AccountView({ onBack }: AccountViewProps) {
  const initial = useMemo(() => {
    const stored = loadAccountSettings()
    if (stored) {
      return stored
    }
    return defaultAccountSettings()
  }, [])

  const [draft, setDraft] = useState<AccountSettings>(initial)
  const [saveState, setSaveState] = useState<SaveState>('idle')

  const handleSave = () => {
    if (saveAccountSettings(draft)) {
      setSaveState('saved')
      return
    }
    setSaveState('error')
  }

  const handleChange = (next: AccountSettings) => {
    setSaveState('idle')
    setDraft(next)
  }

  return (
    <div class="settings">
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">AI 账户</h2>
          <div class="settings__box settings__form">
            <AccountSettingsForm draft={draft} onChange={handleChange} layout="settings" />
          </div>
          <p class="settings__section-footnote">
            配置将保存在本机 localStorage，供应用集市、网络浏览器等 AI 功能使用。
          </p>
        </section>

        <div class="settings__actions settings__actions--form">
          <div class="settings__form-status" aria-live="polite">
            {saveState === 'saved' && <span class="settings__form-status--ok">已保存</span>}
            {saveState === 'error' && (
              <span class="settings__form-status--error">保存失败，请检查填写是否完整</span>
            )}
          </div>
          <button type="button" class="settings__btn settings__btn--default" onClick={handleSave}>
            存储
          </button>
        </div>
      </div>
    </div>
  )
}

