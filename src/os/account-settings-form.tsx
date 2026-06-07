import {
  AI_PROVIDER_PRESETS,
  findAiProviderPreset,
  type AiProviderId,
} from '../ai/ai-providers.ts'
import { mergeAccountSettings, type AccountSettings } from './account-settings-storage.ts'

type AccountSettingsFormProps = {
  draft: AccountSettings
  onChange: (next: AccountSettings) => void
  layout?: 'settings' | 'setup'
}

export function AccountSettingsForm({
  draft,
  onChange,
  layout = 'settings',
}: AccountSettingsFormProps) {
  const preset = findAiProviderPreset(draft.providerId)
  const modelOptions = preset?.models ?? []
  const fieldClass = layout === 'setup' ? 'setup-form__field' : 'settings__field'
  const labelClass = layout === 'setup' ? 'setup-form__label' : 'settings__field-label'
  const inputClass = layout === 'setup' ? 'setup-form__input' : 'settings__input'
  const selectClass = layout === 'setup' ? 'setup-form__select' : 'settings__select'

  const handleProviderChange = (providerId: AiProviderId) => {
    onChange(mergeAccountSettings(draft, providerId))
  }

  return (
    <>
      <label class={fieldClass}>
        <span class={labelClass}>供应商</span>
        <select
          class={selectClass}
          value={draft.providerId}
          onChange={(event) =>
            handleProviderChange((event.currentTarget as HTMLSelectElement).value as AiProviderId)
          }
        >
          {AI_PROVIDER_PRESETS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>

      <label class={fieldClass}>
        <span class={labelClass}>模型</span>
        <select
          class={selectClass}
          value={draft.model}
          onChange={(event) =>
            onChange({
              ...draft,
              model: (event.currentTarget as HTMLSelectElement).value,
            })
          }
        >
          {modelOptions.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </label>

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
