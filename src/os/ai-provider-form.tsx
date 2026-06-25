import { useCallback, useState } from 'preact/hooks'
import {
  AI_PROVIDER_PRESETS,
  defaultProviderEntry,
  findAiProviderPreset,
  isCustomProvider,
  type AiModelEntry,
  type AiProviderEntry,
  type AiProviderId,
} from '../ai/ai-providers.ts'
import { SettingsChoiceField } from '../ui/settings-choice-field.tsx'
import { SettingsInlineInputRow } from '../ui/settings-inline-input-row.tsx'
import { SettingsSwitchRow } from '../ui/settings-switch-row.tsx'
import { IosNavBackButton } from '../ui/ios-nav-back-button.tsx'

const PROVIDER_OPTIONS = AI_PROVIDER_PRESETS.map((item) => ({
  id: item.id,
  label: item.name,
}))

type AiProviderFormProps = {
  entry: AiProviderEntry
  onChange: (entry: AiProviderEntry) => void
  layout: 'settings' | 'setup'
  wideLayout?: boolean
  showBackButton?: boolean
  backLabel?: string
  onBack?: () => void
}

export function AiProviderForm({
  entry,
  onChange,
  layout = 'settings',
  wideLayout = true,
  showBackButton = false,
  backLabel = '返回',
  onBack,
}: AiProviderFormProps) {
  const isCustom = isCustomProvider(entry.providerId)
  const preset = findAiProviderPreset(entry.providerId)
  const providerLabel = preset?.name ?? entry.providerId
  const fieldClass = layout === 'setup' ? 'setup-form__field' : 'settings__field'
  const labelClass = layout === 'setup' ? 'setup-form__label' : 'settings__field-label'
  const inputClass = layout === 'setup' ? 'setup-form__input' : 'settings__input'

  const handleProviderChange = (providerId: AiProviderId) => {
    if (providerId === entry.providerId) {
      return
    }
    const newEntry = defaultProviderEntry(providerId)
    newEntry.id = entry.id
    newEntry.name = entry.name
    newEntry.apiKey = entry.apiKey
    if (entry.baseURL) {
      newEntry.baseURL = entry.baseURL
    }
    onChange(newEntry)
  }

  const handleModelToggle = (modelId: string, name: string) => {
    const isEnabled = entry.enabledModels.some((m) => m.modelId === modelId)
    let nextModels: AiModelEntry[]

    if (isEnabled) {
      nextModels = entry.enabledModels.filter((m) => m.modelId !== modelId)
    } else {
      nextModels = [...entry.enabledModels, { modelId, name }]
    }

    const nextDefaultModel =
      entry.defaultModel === modelId && isEnabled
        ? nextModels[0]?.modelId ?? ''
        : entry.defaultModel

    onChange({ ...entry, enabledModels: nextModels, defaultModel: nextDefaultModel })
  }

  const handleAddCustomModel = (rawValue: string) => {
    const modelId = rawValue.trim()
    if (!modelId) {
      return
    }
    if (entry.enabledModels.some((m) => m.modelId === modelId)) {
      return
    }
    onChange({
      ...entry,
      enabledModels: [...entry.enabledModels, { modelId, name: modelId }],
    })
  }

  const handleRemoveCustomModel = (modelId: string) => {
    const nextModels = entry.enabledModels.filter((m) => m.modelId !== modelId)
    const nextDefaultModel =
      entry.defaultModel === modelId ? nextModels[0]?.modelId ?? '' : entry.defaultModel
    onChange({ ...entry, enabledModels: nextModels, defaultModel: nextDefaultModel })
  }

  const showThinkingSwitch =
    entry.providerId === 'deepseek' || entry.providerId === 'mimo' || entry.providerId === 'mimo-token-plan'

  const renderModelSection = () => {
    if (isCustom) {
      return (
        <SettingsInlineInputRow
          label="模型"
          type="text"
          value={entry.defaultModel}
          placeholder="model-name"
          onChange={(model) => onChange({ ...entry, defaultModel: model })}
        />
      )
    }

    return (
      <div class={fieldClass}>
        <span class={labelClass}>模型</span>
        <div class="ai-provider-models">
          {preset?.models.map((model) => {
            const isEnabled = entry.enabledModels.some((m) => m.modelId === model.id)
            const isDefault = entry.defaultModel === model.id
            return (
              <div key={model.id} class="ai-provider-model-row">
                <label class="ai-provider-model-check">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={() => handleModelToggle(model.id, model.name)}
                  />
                  <span class="ai-provider-model-name">{model.name}</span>
                </label>
                {isEnabled && (
                  <button
                    type="button"
                    class={`ai-provider-model-default-btn${isDefault ? ' ai-provider-model-default-btn--active' : ''}`}
                    onClick={() => onChange({ ...entry, defaultModel: model.id })}
                  >
                    {isDefault ? '默认' : '设为默认'}
                  </button>
                )}
              </div>
            )
          })}

          {entry.enabledModels
            .filter((m) => !preset?.models.some((p) => p.id === m.modelId))
            .map((m) => {
              const isDefault = entry.defaultModel === m.modelId
              return (
                <div key={m.modelId} class="ai-provider-model-row ai-provider-model-row--custom">
                  <span class="ai-provider-model-name">{m.name}</span>
                  <div class="ai-provider-model-actions">
                    <button
                      type="button"
                      class={`ai-provider-model-default-btn${isDefault ? ' ai-provider-model-default-btn--active' : ''}`}
                      onClick={() => onChange({ ...entry, defaultModel: m.modelId })}
                    >
                      {isDefault ? '默认' : '设为默认'}
                    </button>
                    <button
                      type="button"
                      class="ai-provider-model-remove-btn"
                      onClick={() => handleRemoveCustomModel(m.modelId)}
                    >
                      移除
                    </button>
                  </div>
                </div>
              )
            })}

          <AddCustomModelInput onAdd={handleAddCustomModel} />
        </div>
      </div>
    )
  }

  const content = (
    <>
      <SettingsChoiceField
        label="供应商"
        value={entry.providerId}
        displayValue={providerLabel}
        options={PROVIDER_OPTIONS}
        onChange={(value) => handleProviderChange(value as AiProviderId)}
        wideLayout={wideLayout}
        presentation={layout === 'setup' ? 'form' : 'list'}
        fieldClass={fieldClass}
        labelClass={labelClass}
      />

      {wideLayout ? (
        <SettingsInlineInputRow
          label="名称"
          type="text"
          value={entry.name ?? ''}
          placeholder="可选"
          onChange={(name) => onChange({ ...entry, name: name || undefined })}
        />
      ) : (
        <div class={fieldClass}>
          <span class={labelClass}>名称</span>
          <input
            class={inputClass}
            type="text"
            value={entry.name ?? ''}
            placeholder="可选"
            autoComplete="off"
            onInput={(event) => {
              const name = (event.currentTarget as HTMLInputElement).value
              onChange({ ...entry, name: name || undefined })
            }}
          />
        </div>
      )}

      {isCustom &&
        (wideLayout ? (
          <SettingsInlineInputRow
            label="Base URL"
            type="url"
            value={entry.baseURL ?? ''}
            placeholder="https://api.example.com/v1"
            onChange={(baseURL) => onChange({ ...entry, baseURL: baseURL || undefined })}
          />
        ) : (
          <div class={fieldClass}>
            <span class={labelClass}>Base URL</span>
            <input
              class={inputClass}
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
        ))}

      {renderModelSection()}

      {wideLayout ? (
        <SettingsInlineInputRow
          label="API Key"
          type="password"
          value={entry.apiKey}
          placeholder="sk-..."
          onChange={(apiKey) => onChange({ ...entry, apiKey })}
        />
      ) : (
        <div class={fieldClass}>
          <span class={labelClass}>API Key</span>
          <input
            class={inputClass}
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
      )}

      {showThinkingSwitch && (
        <SettingsSwitchRow
          label="思考模式"
          checked={entry.thinkingEnabled}
          onChange={(thinkingEnabled) => onChange({ ...entry, thinkingEnabled })}
        />
      )}
    </>
  )

  if (layout === 'setup') {
    return <>{content}</>
  }

  return (
    <div class="settings__list settings__list--account">
      {showBackButton && onBack && (
        <div class="settings__nav">
          <IosNavBackButton label={backLabel} onClick={onBack} />
        </div>
      )}
      {content}
    </div>
  )
}

function AddCustomModelInput({ onAdd }: { onAdd: (value: string) => void }) {
  const [value, setValue] = useState('')

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (trimmed) {
      onAdd(trimmed)
      setValue('')
    }
  }, [value, onAdd])

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      handleSubmit()
    }
  }

  return (
    <div class="ai-provider-custom-model-input">
      <input
        type="text"
        class="settings__input ai-provider-custom-model-text"
        value={value}
        placeholder="添加自定义模型..."
        autoComplete="off"
        onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        class="settings__btn settings__btn--small"
        disabled={!value.trim()}
        onClick={handleSubmit}
      >
        添加
      </button>
    </div>
  )
}
