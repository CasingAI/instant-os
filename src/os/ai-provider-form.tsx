import { useState } from 'preact/hooks'
import {
  AI_PROVIDER_PRESETS,
  buildCustomModelCapabilities,
  defaultProviderEntry,
  findAiProviderPreset,
  isCustomProvider,
  normalizeCustomModelCapabilities,
  providerRequiresProxy,
  resolveModelCapabilities,
  type AiModelCapability,
  type AiModelEntry,
  type AiProviderEntry,
  type AiProviderId,
} from '../ai/ai-providers.ts'
import { SettingsChoiceField } from '../ui/settings-choice-field.tsx'
import { SettingsInlineInputRow } from '../ui/settings-inline-input-row.tsx'
import { SettingsSwitchRow } from '../ui/settings-switch-row.tsx'
import { IosNavBackButton } from '../ui/ios-nav-back-button.tsx'
import { IosCheckToggle } from '../ui/ios-check-toggle.tsx'
import { AiModelCapabilityTags } from '../ui/ai-model-capability-tags.tsx'
import '../ui/ios-check-toggle.css'
import '../ui/ai-model-capability-tags.css'

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
  const [customModelInput, setCustomModelInput] = useState('')
  const [customModelSupportsVision, setCustomModelSupportsVision] = useState(false)
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
    newEntry.useProxy = providerRequiresProxy(providerId)
      ? true
      : entry.useProxy
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

    const nextDefaultModel = nextModels.some((m) => m.modelId === entry.defaultModel)
      ? entry.defaultModel
      : nextModels[0]?.modelId ?? ''

    onChange({ ...entry, enabledModels: nextModels, defaultModel: nextDefaultModel })
  }

  const handleAddCustomModel = () => {
    const modelId = customModelInput.trim()
    if (!modelId) {
      return
    }
    if (entry.enabledModels.some((m) => m.modelId === modelId)) {
      return
    }
    onChange({
      ...entry,
      enabledModels: [
        ...entry.enabledModels,
        {
          modelId,
          name: modelId,
          capabilities: buildCustomModelCapabilities(customModelSupportsVision),
        },
      ],
      defaultModel: entry.defaultModel || modelId,
    })
    setCustomModelInput('')
    setCustomModelSupportsVision(false)
  }

  const handleRemoveCustomModel = (modelId: string) => {
    const nextModels = entry.enabledModels.filter((m) => m.modelId !== modelId)
    const nextDefaultModel = nextModels.some((m) => m.modelId === entry.defaultModel)
      ? entry.defaultModel
      : nextModels[0]?.modelId ?? ''
    onChange({ ...entry, enabledModels: nextModels, defaultModel: nextDefaultModel })
  }

  const renderModelSection = () => {
    const rows: Array<{
      modelId: string
      name: string
      enabled: boolean
      isFromPreset: boolean
      capabilities: readonly AiModelCapability[]
    }> = []

    if (isCustom) {
      for (const model of entry.enabledModels) {
        rows.push({
          modelId: model.modelId,
          name: model.name,
          enabled: true,
          isFromPreset: false,
          capabilities: normalizeCustomModelCapabilities(model.capabilities),
        })
      }
    } else {
      const seen = new Set<string>()
      for (const pm of preset?.models ?? []) {
        seen.add(pm.id)
        rows.push({
          modelId: pm.id,
          name: pm.name,
          enabled: entry.enabledModels.some((m) => m.modelId === pm.id),
          isFromPreset: true,
          capabilities: resolveModelCapabilities(entry.providerId, pm.id),
        })
      }
      for (const em of entry.enabledModels) {
        if (seen.has(em.modelId)) continue
        rows.push({
          modelId: em.modelId,
          name: em.name,
          enabled: true,
          isFromPreset: false,
          capabilities: normalizeCustomModelCapabilities(em.capabilities),
        })
      }
    }

    const addCapabilities = buildCustomModelCapabilities(customModelSupportsVision)

    return (
      <div class={fieldClass}>
        <span class={labelClass}>模型</span>
        <div class="ai-model-cards">
          {rows.map((row) => {
            return (
              <div
                key={row.modelId}
                class={`ai-model-card${!row.enabled ? ' ai-model-card--disabled' : ''}`}
              >
                <div class="ai-model-card__header">
                  {!isCustom && (
                    <IosCheckToggle
                      checked={row.enabled}
                      label={row.enabled ? `禁用 ${row.name}` : `启用 ${row.name}`}
                      onChange={() => handleModelToggle(row.modelId, row.name)}
                    />
                  )}
                  <span class="ai-model-card__title">{row.name}</span>
                  {!row.isFromPreset && (
                    <div class="ai-model-card__actions">
                      <button
                        type="button"
                        class="ai-provider-model-remove-btn"
                        onClick={() => handleRemoveCustomModel(row.modelId)}
                      >
                        移除
                      </button>
                    </div>
                  )}
                </div>
                <AiModelCapabilityTags capabilities={row.capabilities} />
              </div>
            )
          })}
          <div class="ai-model-card ai-model-card--add">
            <div class="ai-model-card__header">
              <input
                type="text"
                class={`${inputClass} ai-provider-custom-model-text ai-model-card__title-input`}
                value={customModelInput}
                placeholder="添加模型..."
                autoComplete="off"
                onInput={(e) =>
                  setCustomModelInput((e.currentTarget as HTMLInputElement).value)
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleAddCustomModel()
                  }
                }}
              />
              <div class="ai-model-card__actions">
                <button
                  type="button"
                  class="settings__btn settings__btn--small"
                  disabled={!customModelInput.trim()}
                  onClick={handleAddCustomModel}
                >
                  添加
                </button>
              </div>
            </div>
            <AiModelCapabilityTags
              capabilities={addCapabilities}
              visionEditable
              onVisionChange={setCustomModelSupportsVision}
            />
          </div>
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

      <SettingsSwitchRow
        label="思考模式"
        checked={entry.thinkingEnabled}
        onChange={(thinkingEnabled) => onChange({ ...entry, thinkingEnabled })}
      />

      <SettingsSwitchRow
        label="使用代理服务器访问"
        checked={providerRequiresProxy(entry.providerId) ? true : entry.useProxy}
        disabled={providerRequiresProxy(entry.providerId)}
        detail={
          providerRequiresProxy(entry.providerId)
            ? '该供应商需经代理服务器访问，无法关闭。'
            : undefined
        }
        onChange={(useProxy) => {
          if (providerRequiresProxy(entry.providerId)) return
          onChange({ ...entry, useProxy })
        }}
      />
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
