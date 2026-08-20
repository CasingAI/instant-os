import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  listSpeechVoices,
  readSpeechSystemStatus,
  type AsrLanguage,
} from '../../ai/speech-api.ts'
import { subscribeOpenAiConfig } from '../../ai/openai-config-events.ts'
import {
  loadSpeechSettings,
  patchSpeechSettings,
  subscribeSpeechSettings,
} from '../../os/speech-settings-storage.ts'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'
import { SettingsNavRow } from '../../ui/settings-nav-row.tsx'
import { SETTINGS_WIDE_LAYOUT_MIN_WIDTH } from './settings-layout-breakpoints.ts'
import { SettingsChoicePickerView } from './settings-choice-picker-view.tsx'

type SpeechSettingsViewProps = {
  onBack: () => void
  onOpenKeychain: () => void
}

type PickerKind = 'language' | 'voice'

const ASR_LANGUAGE_OPTIONS = [
  { id: 'auto', label: '自动检测' },
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
] as const

export function SpeechSettingsView({ onBack, onOpenKeychain }: SpeechSettingsViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [wideLayout, setWideLayout] = useState(true)
  const [picker, setPicker] = useState<PickerKind | undefined>(undefined)
  const [saveError, setSaveError] = useState(false)

  const [asrModelLabel, setAsrModelLabel] = useState(
    () => readSpeechSystemStatus().asrModelLabel,
  )
  const [ttsModelLabel, setTtsModelLabel] = useState(
    () => readSpeechSystemStatus().ttsModelLabel,
  )
  const [defaultAsrLanguage, setDefaultAsrLanguage] = useState<AsrLanguage>(
    () => loadSpeechSettings().defaultAsrLanguage,
  )
  const [defaultVoice, setDefaultVoice] = useState(
    () => readSpeechSystemStatus().defaultVoice,
  )

  const voiceOptions = useMemo(() => listSpeechVoices().map((v) => ({ id: v.id, label: v.label })), [
    ttsModelLabel,
  ])

  const refreshModels = () => {
    const status = readSpeechSystemStatus()
    setAsrModelLabel(status.asrModelLabel)
    setTtsModelLabel(status.ttsModelLabel)
    setDefaultVoice(status.defaultVoice)
    setDefaultAsrLanguage(status.defaultAsrLanguage)
  }

  useEffect(() => {
    refreshModels()
    const unsubConfig = subscribeOpenAiConfig(refreshModels)
    const unsubSpeech = subscribeSpeechSettings(refreshModels)
    return () => {
      unsubConfig()
      unsubSpeech()
    }
  }, [])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const sync = () => {
      setWideLayout(host.clientWidth >= SETTINGS_WIDE_LAYOUT_MIN_WIDTH)
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const commitLanguage = (value: string) => {
    const next = value as AsrLanguage
    if (!patchSpeechSettings({ defaultAsrLanguage: next })) {
      setSaveError(true)
      return
    }
    setSaveError(false)
    setDefaultAsrLanguage(next)
    setPicker(undefined)
  }

  const commitVoice = (value: string) => {
    if (!patchSpeechSettings({ defaultVoice: value })) {
      setSaveError(true)
      return
    }
    setSaveError(false)
    setDefaultVoice(value)
    setPicker(undefined)
  }

  if (picker === 'language') {
    return (
      <div class="settings" ref={hostRef} data-settings-subpage>
        <SettingsChoicePickerView
          title="默认识别语种"
          backLabel="语音"
          options={ASR_LANGUAGE_OPTIONS}
          value={defaultAsrLanguage}
          onChange={commitLanguage}
          onBack={() => setPicker(undefined)}
        />
      </div>
    )
  }

  if (picker === 'voice') {
    return (
      <div class="settings" ref={hostRef} data-settings-subpage>
        <SettingsChoicePickerView
          title="默认音色"
          backLabel="语音"
          options={voiceOptions}
          value={defaultVoice}
          onChange={commitVoice}
          onBack={() => setPicker(undefined)}
          footnote={
            voiceOptions.length === 0
              ? '当前合成首选供应商尚无可用音色表。'
              : undefined
          }
        />
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
          <h2 class="settings__section-title">语音</h2>
          <p class="settings__section-subtitle">
            系统语音服务的默认行为。识别与合成使用的模型在钥匙串中按能力选择；此处只调整语种与音色。
          </p>

          <div class="settings__list">
            <SettingsNavRow
              label="语音识别模型"
              value={asrModelLabel}
              onClick={onOpenKeychain}
            />
            <SettingsNavRow
              label="语音合成模型"
              value={ttsModelLabel}
              onClick={onOpenKeychain}
            />
          </div>
          <p class="settings__section-footnote">点击模型行可打开钥匙串调整首选。</p>
        </section>

        <section class="settings__section">
          <h2 class="settings__section-title">默认偏好</h2>
          <div class="settings__list">
            <SettingsChoiceField
              label="识别语种"
              value={defaultAsrLanguage}
              options={ASR_LANGUAGE_OPTIONS}
              onChange={commitLanguage}
              wideLayout={wideLayout}
              onNavigate={() => setPicker('language')}
            />
            <SettingsChoiceField
              label="合成音色"
              value={defaultVoice}
              options={voiceOptions}
              onChange={commitVoice}
              wideLayout={wideLayout}
              onNavigate={() => setPicker('voice')}
              disabled={voiceOptions.length === 0}
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
