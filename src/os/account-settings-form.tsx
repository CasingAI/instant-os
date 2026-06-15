import {
  AI_PROVIDER_PRESETS,
  findAiModelPreset,
  findAiProviderPreset,
  isCustomProvider,
  type AiProviderId,
} from '../ai/ai-providers.ts'
import { SettingsChoiceField } from '../ui/settings-choice-field.tsx'
import { SettingsInlineInputRow } from '../ui/settings-inline-input-row.tsx'
import { SettingsNavRow } from '../ui/settings-nav-row.tsx'
import { SettingsSwitchRow } from '../ui/settings-switch-row.tsx'
import { mergeAccountSettings, type AccountSettings } from './account-settings-storage.ts'

export type AccountSubpageField = 'provider' | 'model'

type AccountSettingsFormProps = {
  draft: AccountSettings
  onChange: (next: AccountSettings) => void
  layout?: 'settings' | 'setup'
  wideLayout?: boolean
  onOpenSubpage?: (field: AccountSubpageField) => void
  onEditModel?: () => void
  onEditApiKey?: () => void
  onEditBaseURL?: () => void
}

const PROVIDER_OPTIONS = AI_PROVIDER_PRESETS.map((item) => ({
  id: item.id,
  label: item.name,
}))

function summarizeText(value: string, placeholder = '未填写'): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return placeholder
  }
  if (trimmed.length <= 28) {
    return trimmed
  }
  return `${trimmed.slice(0, 25)}…`
}

export function AccountSettingsForm({
  draft,
  onChange,
  layout = 'settings',
  wideLayout = true,
  onOpenSubpage,
  onEditModel,
  onEditApiKey,
  onEditBaseURL,
}: AccountSettingsFormProps) {
  const isCustom = isCustomProvider(draft.providerId)
  const preset = findAiProviderPreset(draft.providerId)
  const modelOptions = preset?.models ?? []
  const fieldClass = layout === 'setup' ? 'setup-form__field' : 'settings__field'
  const labelClass = layout === 'setup' ? 'setup-form__label' : 'settings__field-label'
  const inputClass = layout === 'setup' ? 'setup-form__input' : 'settings__input'
  const usePopover = layout === 'setup' || wideLayout
  const providerLabel = findAiProviderPreset(draft.providerId)?.name ?? draft.providerId
  const modelLabel =
    findAiModelPreset(draft.providerId, draft.model)?.name ?? draft.model

  const handleProviderChange = (providerId: AiProviderId) => {
    onChange(mergeAccountSettings(draft, providerId))
  }

  if (layout === 'settings') {
    return (
      <div class="settings__list settings__list--account">
        <SettingsChoiceField
          label="供应商"
          value={draft.providerId}
          displayValue={providerLabel}
          options={PROVIDER_OPTIONS}
          onChange={(value) => handleProviderChange(value as AiProviderId)}
          wideLayout={usePopover}
          onNavigate={() => onOpenSubpage?.('provider')}
        />

        {isCustom ? (
          wideLayout ? (
            <SettingsInlineInputRow
              label="模型"
              type="text"
              value={draft.model}
              placeholder="未填写"
              onChange={(model) => onChange({ ...draft, model })}
            />
          ) : (
            <SettingsNavRow
              label="模型"
              value={summarizeText(draft.model)}
              onClick={() => onEditModel?.()}
            />
          )
        ) : (
          <SettingsChoiceField
            label="模型"
            value={draft.model}
            displayValue={modelLabel}
            options={modelOptions.map((model) => ({ id: model.id, label: model.name }))}
            onChange={(model) => onChange({ ...draft, model })}
            wideLayout={usePopover}
            onNavigate={() => onOpenSubpage?.('model')}
          />
        )}

        {isCustom &&
          (wideLayout ? (
            <SettingsInlineInputRow
              label="Base URL"
              type="text"
              value={draft.baseURL ?? ''}
              placeholder="未填写"
              onChange={(baseURL) => onChange({ ...draft, baseURL })}
            />
          ) : (
            <SettingsNavRow
              label="Base URL"
              value={summarizeText(draft.baseURL ?? '')}
              onClick={() => onEditBaseURL?.()}
            />
          ))}

        {wideLayout ? (
          <SettingsInlineInputRow
            label="API Key"
            type="password"
            value={draft.apiKey}
            placeholder="未填写"
            onChange={(apiKey) => onChange({ ...draft, apiKey })}
          />
        ) : (
          <SettingsNavRow
            label="API Key"
            value="未填写"
            secretLength={draft.apiKey.trim().length || undefined}
            onClick={() => onEditApiKey?.()}
          />
        )}

        {(draft.providerId === 'deepseek' || draft.providerId === 'mimo') && (
          <SettingsSwitchRow
            label="思考模式"
            checked={draft.thinkingEnabled}
            onChange={(thinkingEnabled) => onChange({ ...draft, thinkingEnabled })}
          />
        )}
      </div>
    )
  }

  return (
    <>
      <SettingsChoiceField
        label="供应商"
        value={draft.providerId}
        displayValue={providerLabel}
        options={PROVIDER_OPTIONS}
        onChange={(value) => handleProviderChange(value as AiProviderId)}
        wideLayout={usePopover}
        presentation="form"
        fieldClass={fieldClass}
        labelClass={labelClass}
      />

      {isCustom && (
        <label class={fieldClass}>
          <span class={labelClass}>Base URL</span>
          <input
            class={inputClass}
            type="url"
            value={draft.baseURL ?? ''}
            placeholder="https://api.example.com/v1"
            autoComplete="off"
            onInput={(event) =>
              onChange({
                ...draft,
                baseURL: (event.currentTarget as HTMLInputElement).value,
              })
            }
          />
        </label>
      )}

      {isCustom ? (
        <label class={fieldClass}>
          <span class={labelClass}>模型</span>
          <input
            class={inputClass}
            type="text"
            value={draft.model}
            placeholder="model-name"
            autoComplete="off"
            onInput={(event) =>
              onChange({
                ...draft,
                model: (event.currentTarget as HTMLInputElement).value,
              })
            }
          />
        </label>
      ) : (
        <SettingsChoiceField
          label="模型"
          value={draft.model}
          displayValue={modelLabel}
          options={modelOptions.map((model) => ({ id: model.id, label: model.name }))}
          onChange={(model) => onChange({ ...draft, model })}
          wideLayout={usePopover}
          presentation="form"
          fieldClass={fieldClass}
          labelClass={labelClass}
        />
      )}

      <label class={fieldClass}>
        <span class={labelClass}>API Key</span>
        <input
          class={inputClass}
          type="password"
          value={draft.apiKey}
          placeholder="sk-..."
          autoComplete="off"
          onInput={(event) =>
            onChange({
              ...draft,
              apiKey: (event.currentTarget as HTMLInputElement).value,
            })
          }
        />
      </label>
    </>
  )
}
