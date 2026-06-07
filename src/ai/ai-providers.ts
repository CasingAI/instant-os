export type AiProviderId = 'openai' | 'deepseek'

export type AiProviderPreset = {
  id: AiProviderId
  name: string
  baseURL: string
  models: readonly string[]
  defaultModel: string
}

export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    defaultModel: 'deepseek-v4-flash',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    models: [
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4o',
      'gpt-4o-mini',
    ],
    defaultModel: 'gpt-5.4-mini',
  },
] as const

export const DEFAULT_AI_PROVIDER_ID: AiProviderId = 'deepseek'

export function findAiProviderPreset(
  providerId: AiProviderId,
): AiProviderPreset | undefined {
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === providerId)
}

export function resolveProviderBaseURL(providerId: AiProviderId): string | undefined {
  return findAiProviderPreset(providerId)?.baseURL
}

export function normalizeStoredModel(providerId: AiProviderId, model: string): string {
  const trimmed = model.trim()
  if (providerId === 'deepseek') {
    if (trimmed === 'deepseek-chat') {
      return 'deepseek-v4-flash'
    }
    if (trimmed === 'deepseek-reasoner') {
      return 'deepseek-v4-pro'
    }
  }

  const preset = findAiProviderPreset(providerId)
  if (preset && !preset.models.includes(trimmed)) {
    return preset.defaultModel
  }

  return trimmed
}
