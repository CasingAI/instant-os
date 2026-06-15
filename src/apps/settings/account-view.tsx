import { useEffect, useMemo, useState } from 'preact/hooks'
import { AI_PROVIDER_PRESETS, findAiProviderPreset, isCustomProvider } from '../../ai/ai-providers.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import {
  AccountSettingsForm,
  type AccountSubpageField,
} from '../../os/account-settings-form.tsx'
import {
  defaultAccountSettings,
  loadAccountSettings,
  mergeAccountSettings,
  saveAccountSettings,
  type AccountSettings,
} from '../../os/account-settings-storage.ts'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { SettingsChoicePickerView } from './settings-choice-picker-view.tsx'
import { useSettingsAccountPopoverLayout } from './settings-layout-breakpoints.ts'

type AccountViewProps = {
  onBack: () => void
}

type SaveState = 'idle' | 'saved' | 'error'

const PROVIDER_OPTIONS = AI_PROVIDER_PRESETS.map((item) => ({
  id: item.id,
  label: item.name,
}))

export function AccountView({ onBack }: AccountViewProps) {
  const modal = useWindowModal()
  const { hostRef, usePopover } = useSettingsAccountPopoverLayout()
  const initial = useMemo(() => {
    const stored = loadAccountSettings()
    if (stored) {
      return stored
    }
    return defaultAccountSettings()
  }, [])

  const [draft, setDraft] = useState<AccountSettings>(initial)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [screen, setScreen] = useState<AccountSubpageField | 'main'>('main')

  useEffect(() => {
    if (usePopover && (screen === 'provider' || screen === 'model')) {
      setScreen('main')
    }
  }, [usePopover, screen])

  useEffect(() => {
    if (screen === 'model' && isCustomProvider(draft.providerId)) {
      setScreen('main')
    }
  }, [draft.providerId, screen])

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

  const backToMain = () => setScreen('main')

  const handleEditApiKey = async () => {
    const apiKey = await modal.prompt({
      title: 'API Key',
      label: '密钥',
      placeholder: 'sk-...',
      initialValue: draft.apiKey,
      inputType: 'password',
      requireValue: false,
      confirmLabel: '确定',
    })
    if (apiKey !== undefined) {
      handleChange({ ...draft, apiKey })
    }
  }

  const handleEditBaseURL = async () => {
    const baseURL = await modal.prompt({
      title: 'Base URL',
      label: '接口地址',
      placeholder: 'https://api.example.com/v1',
      initialValue: draft.baseURL ?? '',
      requireValue: false,
      confirmLabel: '确定',
    })
    if (baseURL !== undefined) {
      handleChange({ ...draft, baseURL })
    }
  }

  const handleEditModel = async () => {
    const model = await modal.prompt({
      title: '模型',
      label: '模型名称',
      placeholder: 'model-name',
      initialValue: draft.model,
      requireValue: false,
      confirmLabel: '确定',
    })
    if (model !== undefined) {
      handleChange({ ...draft, model })
    }
  }

  const preset = findAiProviderPreset(draft.providerId)
  const modelOptions =
    preset?.models.map((model) => ({ id: model.id, label: model.name })) ?? []

  const subpageContent = (() => {
    switch (screen) {
      case 'provider':
        return (
          <SettingsChoicePickerView
            title="供应商"
            backLabel="AI 账户"
            options={PROVIDER_OPTIONS}
            value={draft.providerId}
            onChange={(providerId) =>
              handleChange(mergeAccountSettings(draft, providerId as AccountSettings['providerId']))
            }
            onBack={backToMain}
          />
        )
      case 'model':
        return (
          <SettingsChoicePickerView
            title="模型"
            backLabel="AI 账户"
            options={modelOptions}
            value={draft.model}
            onChange={(model) => handleChange({ ...draft, model })}
            onBack={backToMain}
          />
        )
      default:
        return undefined
    }
  })()

  if (subpageContent) {
    return (
      <div class="settings" ref={hostRef} data-settings-subpage>
        {subpageContent}
      </div>
    )
  }

  return (
    <div class="settings" ref={hostRef}>
      <div class="settings__nav">
        <IosNavBackButton label="显示全部" onClick={onBack} />
      </div>
      <div class="settings__content settings__content--compact">
        <section class="settings__section">
          <h2 class="settings__section-title">AI 账户</h2>
          <AccountSettingsForm
            draft={draft}
            onChange={handleChange}
            layout="settings"
            wideLayout={usePopover}
            onOpenSubpage={setScreen}
            onEditModel={handleEditModel}
            onEditApiKey={handleEditApiKey}
            onEditBaseURL={handleEditBaseURL}
          />
          <p class="settings__section-footnote">
            API Key 仅可由系统访问，其他应用无法读取。
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
