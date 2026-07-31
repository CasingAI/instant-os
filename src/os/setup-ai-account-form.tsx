import { useState } from 'preact/hooks'
import {
  AI_PROVIDER_PRESETS,
  buildCustomModelCapabilities,
  buildEnabledModelsFromPreset,
  defaultProviderEntry,
  findAiProviderPreset,
  isCustomProvider,
  normalizeCustomModelCapabilities,
  type AiProviderEntry,
  type AiProviderId,
} from '../ai/ai-providers.ts'
import { SettingsChoiceField } from '../ui/settings-choice-field.tsx'
import { SettingsChoiceOptionList } from '../ui/settings-choice-option-list.tsx'
import '../apps/settings/settings.css'

const PROVIDER_OPTIONS = AI_PROVIDER_PRESETS.map((item) => ({
  id: item.id,
  label: item.name,
}))

type SetupAiAccountFormProps = {
  entry: AiProviderEntry
  onChange: (entry: AiProviderEntry) => void
}

export function SetupAiAccountForm({ entry, onChange }: SetupAiAccountFormProps) {
  const [customSupportsVision, setCustomSupportsVision] = useState(() =>
    normalizeCustomModelCapabilities(entry.enabledModels[0]?.capabilities).includes(
      'vision',
    ),
  )
  const isCustom = isCustomProvider(entry.providerId)
  const preset = findAiProviderPreset(entry.providerId)
  const providerLabel = preset?.name ?? entry.providerId

  const handleProviderChange = (providerId: AiProviderId) => {
    if (providerId === entry.providerId) {
      return
    }
    const newEntry = defaultProviderEntry(providerId)
    newEntry.id = entry.id
    newEntry.apiKey = entry.apiKey
    if (entry.baseURL) {
      newEntry.baseURL = entry.baseURL
    }
    newEntry.defaultModel = ''
    newEntry.enabledModels = []
    setCustomSupportsVision(false)
    onChange(newEntry)
  }

  const handleSelectModel = (modelId: string) => {
    const name =
      preset?.models.find((model) => model.id === modelId)?.name ?? modelId
    onChange({
      ...entry,
      defaultModel: modelId,
      // 内置供应商默认启用整套预设模型，选中项作为默认
      enabledModels: buildEnabledModelsFromPreset(entry.providerId).map(
        (model) =>
          model.modelId === modelId ? { ...model, name } : model,
      ),
    })
  }

  const handleCustomModelChange = (modelId: string, supportsVision = customSupportsVision) => {
    const trimmed = modelId.trim()
    onChange({
      ...entry,
      defaultModel: trimmed,
      enabledModels: trimmed
        ? [
            {
              modelId: trimmed,
              name: trimmed,
              capabilities: buildCustomModelCapabilities(supportsVision),
            },
          ]
        : [],
    })
  }

  const handleCustomVisionChange = (supportsVision: boolean) => {
    setCustomSupportsVision(supportsVision)
    if (entry.defaultModel.trim()) {
      handleCustomModelChange(entry.defaultModel, supportsVision)
    }
  }

  const modelOptions = (preset?.models ?? []).map((model) => ({
    id: model.id,
    label: model.name,
  }))

  return (
    <div class="setup-ai-form">
      <SettingsChoiceField
        label="供应商"
        value={entry.providerId}
        displayValue={providerLabel}
        options={PROVIDER_OPTIONS}
        onChange={(value) => handleProviderChange(value as AiProviderId)}
        wideLayout
        presentation="form"
        fieldClass="setup-ai-form__field"
        labelClass="setup-ai-form__label"
      />

      {isCustom && (
        <div class="setup-ai-form__field">
          <label class="setup-ai-form__label">Base URL</label>
          <input
            class="setup-ai-form__input"
            type="url"
            value={entry.baseURL ?? ''}
            placeholder="https://api.example.com/v1"
            autoComplete="off"
            onInput={(event) => {
              const baseURL = (event.currentTarget as HTMLInputElement).value
              onChange({ ...entry, baseURL: baseURL || undefined })
            }}
          />
        </div>
      )}

      <div class="setup-ai-form__field">
        <label class="setup-ai-form__label">API Key</label>
        <input
          class="setup-ai-form__input"
          type="password"
          value={entry.apiKey}
          placeholder="sk-..."
          autoComplete="off"
          onInput={(event) =>
            onChange({
              ...entry,
              apiKey: (event.currentTarget as HTMLInputElement).value,
            })
          }
        />
      </div>

      <div class="setup-ai-form__field">
        <span class="setup-ai-form__label">首选模型</span>
        {isCustom ? (
          <div class="setup-ai-form__custom-model">
            <input
              class="setup-ai-form__input"
              type="text"
              value={entry.defaultModel}
              placeholder="model-name"
              autoComplete="off"
              onInput={(event) =>
                handleCustomModelChange(
                  (event.currentTarget as HTMLInputElement).value,
                )
              }
            />
            <label class="setup-ai-form__switch-row">
              <span>支持图像识别</span>
              <input
                type="checkbox"
                checked={customSupportsVision}
                onChange={(event) =>
                  handleCustomVisionChange(
                    (event.currentTarget as HTMLInputElement).checked,
                  )
                }
              />
            </label>
          </div>
        ) : (
          <div class="setup-ai-form__choice settings">
            <SettingsChoiceOptionList
              options={modelOptions}
              value={entry.defaultModel}
              onChange={handleSelectModel}
              ariaLabel="选择首选模型"
            />
          </div>
        )}
      </div>
    </div>
  )
}
