export type AiProviderId = 'openai' | 'deepseek' | 'mimo' | 'mimo-token-plan' | 'custom'

export type AiModelPreset = {
  id: string
  name: string
}

export type AiProviderPreset = {
  id: AiProviderId
  name: string
  baseURL: string
  models: readonly AiModelPreset[]
  defaultModel: string
}

// --- V2 multi-provider types ---

export type AiModelEntry = {
  modelId: string
  name: string
}

export type AiProviderEntry = {
  id: string
  providerId: AiProviderId
  name?: string
  apiKey: string
  baseURL?: string
  enabledModels: AiModelEntry[]
  defaultModel: string
  thinkingEnabled: boolean
}

export type AccountSettingsV2 = {
  version: 2
  providers: AiProviderEntry[]
  preferredIndex: number
}

export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
    ],
    defaultModel: 'deepseek-v4-flash',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-5.5', name: 'GPT-5.5' },
      { id: 'gpt-5.4', name: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini' },
      { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano' },
      { id: 'gpt-4.1', name: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    ],
    defaultModel: 'gpt-5.4-mini',
  },
  {
    id: 'mimo',
    name: '小米 MiMo (API)',
    baseURL: 'https://api.xiaomimimo.com/v1',
    models: [
      { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro' },
      { id: 'mimo-v2.5-pro-ultraspeed', name: 'MiMo V2.5 Pro UltraSpeed' },
      { id: 'mimo-v2-pro', name: 'MiMo V2 Pro' },
      { id: 'mimo-v2.5', name: 'MiMo V2.5' },
      { id: 'mimo-v2-omni', name: 'MiMo V2 Omni' },
      { id: 'mimo-v2-flash', name: 'MiMo V2 Flash' },
    ],
    defaultModel: 'mimo-v2-flash',
  },
  {
    id: 'mimo-token-plan',
    name: '小米 MiMo (Token Plan)',
    baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
    models: [
      { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro' },
      { id: 'mimo-v2.5', name: 'MiMo V2.5' },
    ],
    defaultModel: 'mimo-v2.5-pro',
  },
  {
    id: 'custom',
    name: '自定义',
    baseURL: '',
    models: [],
    defaultModel: '',
  },
] as const

export const DEFAULT_AI_PROVIDER_ID: AiProviderId = 'deepseek'

export function findAiProviderPreset(
  providerId: AiProviderId,
): AiProviderPreset | undefined {
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === providerId)
}

export function findAiModelPreset(
  providerId: AiProviderId,
  modelId: string,
): AiModelPreset | undefined {
  return findAiProviderPreset(providerId)?.models.find((model) => model.id === modelId)
}

export function isKnownModel(providerId: AiProviderId, modelId: string): boolean {
  return findAiModelPreset(providerId, modelId) !== undefined
}

export function resolveModelFriendlyName(
  modelId: string,
  providerId?: AiProviderId,
): string {
  if (providerId && isCustomProvider(providerId)) {
    return modelId
  }

  if (providerId) {
    const match = findAiModelPreset(providerId, modelId)
    if (match) {
      return match.name
    }
  }

  for (const preset of AI_PROVIDER_PRESETS) {
    const match = preset.models.find((model) => model.id === modelId)
    if (match) {
      return match.name
    }
  }

  return modelId
}

export function resolveProviderBaseURL(providerId: AiProviderId): string | undefined {
  return findAiProviderPreset(providerId)?.baseURL
}

export function isCustomProvider(providerId: AiProviderId): boolean {
  return providerId === 'custom'
}

export function isMimoUltraSpeedModel(modelId: string): boolean {
  return modelId.trim() === 'mimo-v2.5-pro-ultraspeed'
}

export function normalizeStoredModel(providerId: AiProviderId, model: string): string {
  const trimmed = model.trim()
  if (providerId === 'custom') {
    return trimmed
  }
  if (providerId === 'deepseek') {
    if (trimmed === 'deepseek-chat') {
      return 'deepseek-v4-flash'
    }
    if (trimmed === 'deepseek-reasoner') {
      return 'deepseek-v4-pro'
    }
  }
  const preset = findAiProviderPreset(providerId)
  if (preset && !isKnownModel(providerId, trimmed)) {
    return preset.defaultModel
  }

  return trimmed
}

export function getDefaultThinkingEnabled(_providerId: AiProviderId): boolean {
  return false
}

export function generateProviderEntryId(): string {
  return crypto.randomUUID()
}

export function buildEnabledModelsFromPreset(
  providerId: AiProviderId,
): AiModelEntry[] {
  const preset = findAiProviderPreset(providerId)
  if (!preset) {
    return []
  }
  return preset.models.map((model) => ({
    modelId: model.id,
    name: model.name,
  }))
}

export function defaultProviderEntry(
  providerId: AiProviderId = DEFAULT_AI_PROVIDER_ID,
): AiProviderEntry {
  if (isCustomProvider(providerId)) {
    return {
      id: generateProviderEntryId(),
      providerId,
      apiKey: '',
      enabledModels: [],
      defaultModel: '',
      thinkingEnabled: false,
    }
  }

  const preset = findAiProviderPreset(providerId)
  return {
    id: generateProviderEntryId(),
    providerId,
    apiKey: '',
    enabledModels: buildEnabledModelsFromPreset(providerId),
    defaultModel: preset?.defaultModel ?? '',
    thinkingEnabled: getDefaultThinkingEnabled(providerId),
  }
}

export function isProviderEntryValid(entry: AiProviderEntry): boolean {
  const hasCredentials = Boolean(entry.apiKey.trim() && entry.defaultModel.trim())
  const hasModels = entry.enabledModels.some(
    (model) => model.modelId.trim() === entry.defaultModel.trim(),
  )
  if (!hasCredentials || !hasModels) {
    return false
  }
  if (isCustomProvider(entry.providerId)) {
    return Boolean(entry.baseURL?.trim())
  }
  return true
}

export function resolveProviderEntryBaseURL(entry: AiProviderEntry): string | undefined {
  if (entry.baseURL?.trim()) {
    return entry.baseURL.trim()
  }
  if (isCustomProvider(entry.providerId)) {
    return undefined
  }
  return resolveProviderBaseURL(entry.providerId)
}
