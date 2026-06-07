import { useMemo, useState } from 'preact/hooks'
import { BackIcon } from '../../icons/app-icons.tsx'
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
        <button type="button" class="settings__nav-back" onClick={onBack}>
          <span class="settings__nav-back-icon" aria-hidden="true">
            <BackIcon size={13} />
          </span>
          显示全部
        </button>
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">AI 账户</h2>
          <div class="settings__box settings__form">
            <AccountSettingsForm draft={draft} onChange={handleChange} layout="settings" />
          </div>
          <p class="settings__section-footnote">
            配置将保存在本机 localStorage，供 App Store、Safari 等 AI 功能使用。
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

function AccountPaneIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <circle cx="17" cy="12" r="6" fill="#8ec96a" stroke="#5a9a3a" stroke-width="1" />
      <path
        d="M8 28 C8 22 12 19 17 19 C22 19 26 22 26 28"
        fill="#6aa3e8"
        stroke="#2f6fd0"
        stroke-width="1"
      />
    </svg>
  )
}

export { AccountPaneIcon }
