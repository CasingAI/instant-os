import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { InstantLogoIcon } from '../icons/app-icons.tsx'
import { SetupAiAccountForm } from './setup-ai-account-form.tsx'
import { SetupCompleteView } from './setup-complete-view.tsx'
import { SetupDateTimeStep } from './setup-date-time-step.tsx'
import {
  defaultAccountSettingsV2,
  isAccountSettingsValid,
  saveAccountSettings,
  type AccountSettingsV2,
} from './account-settings-storage.ts'
import type { AiProviderEntry } from '../ai/ai-providers.ts'
import {
  applyTextPreferredToProviders,
  reconcilePreferredByCapability,
} from '../ai/ai-providers.ts'
import type { CalendarInstant } from './calendar-instant.ts'
import { applyOsManualDateTime, applyOsSystemDateTime } from './os-clock.ts'
import './setup-assistant.css'

const STEP_COUNT = 4

type SetupStep = 0 | 1 | 2 | 3

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
      // 清空默认 Flash 首选，避免选模型时被 reconcile 写回
      preferredByCapability: {},
      preferredIndex: 0,
    }
  })
  const [saveError, setSaveError] = useState(false)
  const [completeRevealed, setCompleteRevealed] = useState(false)

  const providerEntry = settings.providers[0]

  useEffect(() => {
    if (step !== 3) {
      setCompleteRevealed(false)
    }
  }, [step])

  const handleRevealComplete = useCallback(() => {
    setCompleteRevealed(true)
  }, [])

  const canContinue =
    step === 0 ||
    (step === 2 && isAccountSettingsValid(settings)) ||
    (step === 3 && completeRevealed)

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

    // 时间步骤靠卡片推进，不走底部「继续」
    if (step === 1) {
      return
    }

    if (step === 2) {
      if (!isAccountSettingsValid(settings)) {
        return
      }
      setSaveError(false)
      goToStep(3)
      return
    }

    if (!saveAccountSettings(settings)) {
      setSaveError(true)
      goToStep(2)
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

  const handleSelectSystemTime = useCallback(() => {
    applyOsSystemDateTime()
    goToStep(2)
  }, [goToStep])

  const handleSelectManualTime = useCallback(
    (instant: CalendarInstant) => {
      applyOsManualDateTime(instant)
      goToStep(2)
    },
    [goToStep],
  )

  const updateProvider = useCallback((entry: AiProviderEntry) => {
    setSettings((prev) => {
      const providers = [entry]
      // 以当前 defaultModel 为文本首选种子，避免旧首选把选中态盖回去
      const seededPreferred = { ...prev.preferredByCapability }
      const selectedModel = entry.defaultModel.trim()
      if (
        selectedModel &&
        entry.enabledModels.some((model) => model.modelId === selectedModel)
      ) {
        seededPreferred.text = {
          providerEntryId: entry.id,
          modelId: selectedModel,
        }
      }
      const reconciled = reconcilePreferredByCapability(
        providers,
        seededPreferred,
        0,
      )
      return {
        ...prev,
        providers: applyTextPreferredToProviders(
          providers,
          reconciled.preferredByCapability,
        ),
        preferredIndex: reconciled.preferredIndex,
        preferredByCapability: reconciled.preferredByCapability,
      }
    })
  }, [])

  return (
    <div class="setup-assistant">
      <div
        class={`setup-assistant__panel${step === 3 ? ' setup-assistant__panel--complete' : ''}`}
      >
        <div
          class={`setup-assistant__body${
            bodyTransitionReady ? '' : ' setup-assistant__body--instant'
          }${step === 3 ? ' setup-assistant__body--complete' : ''}`}
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
                  这是一个由 AI 驱动的桌面环境。开始之前，需要先设定系统时间并配置 AI
                  账户，以便使用应用集市、网页浏览器等功能。
                </p>
              </div>
            )}

            {step === 1 && (
              <SetupDateTimeStep
                onSelectSystem={handleSelectSystemTime}
                onSelectManual={handleSelectManualTime}
              />
            )}

            {step === 2 && providerEntry && (
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

            {step === 3 && (
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
          {step === 1 ? (
            <span class="setup-assistant__footer-hint">请选择一种时间方式</span>
          ) : (
            <button
              type="button"
              class="setup-assistant__btn setup-assistant__btn--primary"
              onClick={handleContinue}
              disabled={!canContinue || launching}
            >
              {step === 3 ? '开始使用' : '继续'}
            </button>
          )}
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
