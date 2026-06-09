import {
  AI_PROVIDER_PRESETS,
  findAiProviderPreset,
  isCustomProvider,
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
  const isCustom = isCustomProvider(draft.providerId)
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

      <label class={fieldClass}>
        <span class={labelClass}>模型</span>
        {isCustom ? (
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
        ) : (
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
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        )}
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

      {layout === 'settings' && draft.providerId === 'deepseek' && (
        <label class={fieldClass}>
          <span class={labelClass}>思考模式</span>
          <span class="settings__checkbox">
            <input
              type="checkbox"
              checked={draft.thinkingEnabled}
              onChange={(event) =>
                onChange({
                  ...draft,
                  thinkingEnabled: (event.currentTarget as HTMLInputElement).checked,
                })
              }
            />
            <span class="settings__checkbox-label">开启思考链</span>
          </span>
        </label>
      )}
    </>
  )
}
