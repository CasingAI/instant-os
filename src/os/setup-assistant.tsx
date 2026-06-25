import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { InstantLogoIcon } from '../icons/app-icons.tsx'
import { SetupAiAccountForm } from './setup-ai-account-form.tsx'
import { SetupCompleteView } from './setup-complete-view.tsx'
import {
  defaultAccountSettingsV2,
  isAccountSettingsValid,
  saveAccountSettings,
  type AccountSettingsV2,
} from './account-settings-storage.ts'
import type { AiProviderEntry } from '../ai/ai-providers.ts'
import './setup-assistant.css'

const STEP_COUNT = 3

type SetupStep = 0 | 1 | 2

type SetupAssistantProps = {
  onLaunch?: () => void
  launching?: boolean
}

export function SetupAssistant({ onLaunch, launching = false }: SetupAssistantProps) {
  const [step, setStep] = useState<SetupStep>(0)
  const [stepDirection, setStepDirection] = useState<'forward' | 'back'>('forward')
  const stepContentRef = useRef<HTMLDivElement>(null)
  const [bodyTransitionReady, setBodyTransitionReady] = useState(false)
  const [bodyHeight, setBodyHeight] = useState<number | undefined>(undefined)
  const [settings, setSettings] = useState<AccountSettingsV2>(() => {
    const defaults = defaultAccountSettingsV2()
    const entry = defaults.providers[0]
    return {
      ...defaults,
      providers: [
        {
          ...entry,
          defaultModel: '',
          enabledModels: [],
        },
      ],
    }
  })
  const [saveError, setSaveError] = useState(false)
  const [completeRevealed, setCompleteRevealed] = useState(false)

  const providerEntry = settings.providers[0]

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
    (step === 1 && isAccountSettingsValid(settings)) ||
    (step === 2 && completeRevealed)

  const goToStep = useCallback((next: SetupStep) => {
    setStepDirection(next > step ? 'forward' : 'back')
    setStep(next)
  }, [step])

  useEffect(() => {
    setBodyTransitionReady(true)
  }, [])

  useLayoutEffect(() => {
    const content = stepContentRef.current
    if (!content) {
      return
    }

    const measure = () => {
      setBodyHeight(content.scrollHeight)
    }

    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(content)

    return () => {
      observer.disconnect()
    }
  }, [step, saveError, settings])

  const handleContinue = () => {
    if (step === 0) {
      goToStep(1)
      return
    }

    if (step === 1) {
      if (!isAccountSettingsValid(settings)) {
        return
      }
      setSaveError(false)
      goToStep(2)
      return
    }

    if (!saveAccountSettings(settings)) {
      setSaveError(true)
      goToStep(1)
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
    goToStep((step - 1) as SetupStep)
  }

  const updateProvider = useCallback((entry: AiProviderEntry) => {
    setSettings((prev) => ({
      ...prev,
      providers: [entry],
      preferredIndex: 0,
    }))
  }, [])

  return (
    <div class="setup-assistant">
      <div
        class={`setup-assistant__panel${step === 2 ? ' setup-assistant__panel--complete' : ''}`}
      >
        <div
          class={`setup-assistant__body${
            bodyTransitionReady ? '' : ' setup-assistant__body--instant'
          }${step === 2 ? ' setup-assistant__body--complete' : ''}`}
          style={bodyHeight === undefined ? undefined : { height: `${bodyHeight}px` }}
        >
          <div
            ref={stepContentRef}
            key={step}
            class={`setup-assistant__step setup-assistant__step--${stepDirection}`}
          >
            {step === 0 && (
              <div class="setup-assistant__hero">
                <div class="setup-assistant__logo" aria-hidden="true">
                  <InstantLogoIcon size={56} />
                </div>
                <h1 class="setup-assistant__title">欢迎使用 Instant OS</h1>
                <p class="setup-assistant__subtitle">
                  这是一个由 AI 驱动的桌面环境。开始之前，需要先配置 AI
                  账户，以便使用应用集市、网络浏览器等功能。
                </p>
              </div>
            )}

            {step === 1 && providerEntry && (
              <>
                <header class="setup-assistant__step-head">
                  <h1 class="setup-assistant__title">配置 AI 钥匙串</h1>
                  <p class="setup-assistant__subtitle">
                    选择供应商、填写 API Key，并挑选一个模型。配置保存在本机，不会上传到服务器。
                  </p>
                </header>
                <SetupAiAccountForm entry={providerEntry} onChange={updateProvider} />
                {saveError && (
                  <p class="setup-assistant__error" role="alert">
                    保存失败，请检查填写是否完整，或设备存储是否已满。
                  </p>
                )}
                <p class="setup-assistant__footnote">
                  也可稍后在「钥匙串」中添加更多供应商和模型；如需开启思考模式，可在钥匙串中修改。
                </p>
              </>
            )}

            {step === 2 && (
              <SetupCompleteView
                saveError={saveError}
                onRevealComplete={handleRevealComplete}
              />
            )}
          </div>
        </div>

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
