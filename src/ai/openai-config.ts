import { accountSettingsToOpenAiConfig, loadAccountSettings } from '../os/account-settings-storage.ts'
import {
  getDefaultThinkingEnabled,
  resolveModelFriendlyName,
  resolvePreferredModelRef,
  type AiModelCapability,
  type AiProviderId,
} from './ai-providers.ts'
import { notifyOpenAiConfigChange, subscribeOpenAiConfig } from './openai-config-events.ts'

export type OpenAiConfig = {
  apiKey: string
  baseURL?: string
  defaultModel: string
  providerId: AiProviderId
  thinkingEnabled: boolean
}

const DEFAULT_MODEL = 'deepseek-v4-flash'

export { notifyOpenAiConfigChange, subscribeOpenAiConfig }

function readEnvConfig(): Partial<OpenAiConfig> {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY?.trim()
  const baseURL = import.meta.env.VITE_OPENAI_BASE_URL?.trim()
  const defaultModel = import.meta.env.VITE_OPENAI_MODEL?.trim() || DEFAULT_MODEL

  return {
    apiKey: apiKey || undefined,
    baseURL: baseURL || undefined,
    defaultModel,
  }
}

function readStoredConfig(
  capability: AiModelCapability = 'text',
): Partial<OpenAiConfig> | undefined {
  const settings = loadAccountSettings()
  if (!settings) {
    return undefined
  }
  return accountSettingsToOpenAiConfig(settings, capability)
}

export function readOpenAiConfigFromEnv(): OpenAiConfig {
  const config = mergeOpenAiConfig()
  return config
}

export function mergeOpenAiConfig(
  overrides?: Partial<OpenAiConfig>,
  capability: AiModelCapability = 'text',
): OpenAiConfig {
  const stored = readStoredConfig(capability)
  const env = readEnvConfig()

  const apiKey = overrides?.apiKey ?? stored?.apiKey ?? env.apiKey
  const baseURL = overrides?.baseURL ?? stored?.baseURL ?? env.baseURL
  const defaultModel =
    overrides?.defaultModel ?? stored?.defaultModel ?? env.defaultModel ?? DEFAULT_MODEL
  const providerId = overrides?.providerId ?? stored?.providerId ?? 'deepseek'
  const thinkingEnabled =
    overrides?.thinkingEnabled ??
    stored?.thinkingEnabled ??
    getDefaultThinkingEnabled(providerId)

  if (!apiKey) {
    throw new Error(
      '缺少 API Key。请在「系统设置 → 账户」中配置。',
    )
  }

  return {
    apiKey,
    baseURL: baseURL || undefined,
    defaultModel,
    providerId,
    thinkingEnabled,
  }
}

export function hasOpenAiApiKey(): boolean {
  const settings = loadAccountSettings()
  if (settings && settings.providers.length > 0) {
    const preferred =
      settings.providers[settings.preferredIndex] ?? settings.providers[0]
    if (preferred?.apiKey) {
      return true
    }
  }
  return Boolean(import.meta.env.VITE_OPENAI_API_KEY?.trim())
}

export function readDefaultModelId(capability: AiModelCapability = 'text'): string {
  const settings = loadAccountSettings()
  if (settings && settings.providers.length > 0) {
    const ref = resolvePreferredModelRef(settings, capability)
    if (ref?.modelId) {
      return ref.modelId
    }
  }
  return import.meta.env.VITE_OPENAI_MODEL?.trim() || DEFAULT_MODEL
}

export function readDefaultModelFriendlyName(
  capability: AiModelCapability = 'text',
): string {
  const modelId = readDefaultModelId(capability)
  const settings = loadAccountSettings()
  if (settings && settings.providers.length > 0) {
    const ref = resolvePreferredModelRef(settings, capability)
    const entry = ref
      ? settings.providers.find((item) => item.id === ref.providerEntryId)
      : (settings.providers[settings.preferredIndex] ?? settings.providers[0])
    if (entry) {
      return resolveModelFriendlyName(modelId, entry.providerId)
    }
  }
  return resolveModelFriendlyName(modelId)
}
