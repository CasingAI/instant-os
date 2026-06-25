import {
  AI_PROVIDER_PRESETS,
  defaultProviderEntry,
  findAiProviderPreset,
  isCustomProvider,
  type AiProviderEntry,
  type AiProviderId,
} from '../ai/ai-providers.ts'
import { SettingsChoiceField } from '../ui/settings-choice-field.tsx'

const PROVIDER_OPTIONS = AI_PROVIDER_PRESETS.map((item) => ({
  id: item.id,
  label: item.name,
}))

type SetupAiAccountFormProps = {
  entry: AiProviderEntry
  onChange: (entry: AiProviderEntry) => void
}

export function SetupAiAccountForm({ entry, onChange }: SetupAiAccountFormProps) {
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
    onChange(newEntry)
  }

  const handleSelectModel = (modelId: string, name: string) => {
    onChange({
      ...entry,
      defaultModel: modelId,
      enabledModels: [{ modelId, name }],
    })
  }

  const handleCustomModelChange = (modelId: string) => {
    const trimmed = modelId.trim()
    onChange({
      ...entry,
      defaultModel: trimmed,
      enabledModels: trimmed ? [{ modelId: trimmed, name: trimmed }] : [],
    })
  }

  const presetModels = preset?.models ?? []

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
        ) : (
          <div class="setup-ai-form__model-list" role="radiogroup" aria-label="模型">
            {presetModels.map((model) => (
              <button
                key={model.id}
                type="button"
                class="setup-ai-form__model-row"
                role="radio"
                aria-checked={entry.defaultModel === model.id}
                onClick={() => handleSelectModel(model.id, model.name)}
              >
                <span class="setup-ai-form__model-name">{model.name}</span>
                {entry.defaultModel === model.id && (
                  <span class="setup-ai-form__model-check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
