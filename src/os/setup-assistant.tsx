import { useCallback, useEffect, useState } from 'preact/hooks'
import { InstantLogoIcon } from '../icons/app-icons.tsx'
import { AccountSettingsForm } from './account-settings-form.tsx'
import { SetupCompleteView } from './setup-complete-view.tsx'
import {
  defaultAccountSettings,
  isAccountSettingsValid,
  saveAccountSettings,
  type AccountSettings,
} from './account-settings-storage.ts'
import './setup-assistant.css'

const STEP_COUNT = 3

type SetupStep = 0 | 1 | 2

type SetupAssistantProps = {
  onLaunch?: () => void
  launching?: boolean
}

export function SetupAssistant({ onLaunch, launching = false }: SetupAssistantProps) {
  const [step, setStep] = useState<SetupStep>(0)
  const [draft, setDraft] = useState<AccountSettings>(() => defaultAccountSettings())
  const [saveError, setSaveError] = useState(false)
  const [completeRevealed, setCompleteRevealed] = useState(false)

  useEffect(() => {
    if (step !== 2) {
      setCompleteRevealed(false)
    }
  }, [step])

  const handleRevealComplete = useCallback(() => {
    setCompleteRevealed(true)
  }, [])

  const canContinue =
    step === 0 ||
    (step === 1 && isAccountSettingsValid(draft)) ||
    (step === 2 && completeRevealed)

  const handleContinue = () => {
    if (step === 0) {
      setStep(1)
      return
    }

    if (step === 1) {
      if (!isAccountSettingsValid(draft)) {
        return
      }
      setSaveError(false)
      setStep(2)
      return
    }

    if (!saveAccountSettings(draft)) {
      setSaveError(true)
      setStep(1)
      return
    }
    setSaveError(false)
    onLaunch?.()
  }

  const handleBack = () => {
    if (step === 0) {
      return
    }
    setSaveError(false)
    setStep((current) => (current - 1) as SetupStep)
  }

  return (
    <div class="setup-assistant">
      <div class={`setup-assistant__panel${step === 2 ? ' setup-assistant__panel--complete' : ''}`}>
        {step === 0 && (
          <div class="setup-assistant__hero">
            <div class="setup-assistant__logo" aria-hidden="true">
              <InstantLogoIcon size={56} />
            </div>
            <h1 class="setup-assistant__title">欢迎使用 Instant OS</h1>
            <p class="setup-assistant__subtitle">
              这是一个由 AI 驱动的桌面环境。开始之前，需要先配置 AI
              账户，以便使用 App Store、网络浏览器等功能。
            </p>
          </div>
        )}

        {step === 1 && (
          <>
            <header class="setup-assistant__step-head">
              <h1 class="setup-assistant__title">配置 AI 账户</h1>
              <p class="setup-assistant__subtitle">
                选择模型供应商并填写 API Key。配置保存在本机，不会上传到服务器。
              </p>
            </header>
            <div class="setup-form">
              <AccountSettingsForm draft={draft} onChange={setDraft} layout="setup" />
            </div>
            {saveError && (
              <p class="setup-assistant__error" role="alert">
                保存失败，请检查填写是否完整，或设备存储是否已满。
              </p>
            )}
            <p class="setup-assistant__footnote">
              也可稍后在「系统设置 → 账户」中修改。
            </p>
          </>
        )}

        {step === 2 && (
          <SetupCompleteView saveError={saveError} onRevealComplete={handleRevealComplete} />
        )}

        <footer class="setup-assistant__footer">
          <button
            type="button"
            class="setup-assistant__btn setup-assistant__btn--back"
            onClick={handleBack}
            disabled={step === 0 || launching}
          >
            返回
          </button>
          <button
            type="button"
            class="setup-assistant__btn setup-assistant__btn--primary"
            onClick={handleContinue}
            disabled={!canContinue || launching}
          >
            {step === 2 ? '开始使用' : '继续'}
          </button>
        </footer>
      </div>

      <div class="setup-assistant__dots" aria-hidden="true">
        {Array.from({ length: STEP_COUNT }, (_, index) => (
          <span
            key={index}
            class={`setup-assistant__dot${index === step ? ' setup-assistant__dot--active' : ''}`}
          />
        ))}
      </div>
    </div>
  )
}
