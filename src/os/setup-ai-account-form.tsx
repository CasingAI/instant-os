import { useState } from 'preact/hooks'
import {
  AI_PROVIDER_PRESETS,
  buildCustomModelCapabilities,
  buildEnabledModelsFromPreset,
  defaultProviderEntry,
  findAiProviderPreset,
  isCustomProvider,
  normalizeCustomModelCapabilities,
  resolveModelCapabilities,
  type AiProviderEntry,
  type AiProviderId,
} from '../ai/ai-providers.ts'
import { SettingsChoiceField } from '../ui/settings-choice-field.tsx'
import { AiModelCapabilityTags } from '../ui/ai-model-capability-tags.tsx'
import '../ui/ai-model-capability-tags.css'

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

  const handleSelectModel = (modelId: string, name: string) => {
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

  const presetModels = preset?.models ?? []
  const customCapabilities = buildCustomModelCapabilities(customSupportsVision)

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
        <span class="setup-ai-form__label">模型</span>
        {isCustom ? (
          <div class="setup-ai-form__model-cards">
            <div class="ai-model-card ai-model-card--add">
              <div class="ai-model-card__header">
                <input
                  class="setup-ai-form__input ai-model-card__title-input"
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
              </div>
              <AiModelCapabilityTags
                capabilities={customCapabilities}
                visionEditable
                onVisionChange={handleCustomVisionChange}
              />
            </div>
          </div>
        ) : (
          <div class="setup-ai-form__model-cards">
            <div class="ai-model-cards">
              {presetModels.map((model) => {
                const selected = entry.defaultModel === model.id
                const caps = resolveModelCapabilities(entry.providerId, model.id)
                return (
                  <button
                    key={model.id}
                    type="button"
                    class={`ai-model-card ai-model-card--selectable${
                      selected ? ' ai-model-card--selected' : ''
                    }`}
                    onClick={() => handleSelectModel(model.id, model.name)}
                  >
                    <div class="ai-model-card__header">
                      <span class="ai-model-card__title">{model.name}</span>
                      {selected && (
                        <span class="ai-model-card__check" aria-hidden="true">
                          ✓
                        </span>
                      )}
                    </div>
                    <AiModelCapabilityTags capabilities={caps} />
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
