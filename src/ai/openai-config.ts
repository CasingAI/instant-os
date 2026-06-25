import { accountSettingsToOpenAiConfig, loadAccountSettings } from '../os/account-settings-storage.ts'
import { getDefaultThinkingEnabled, resolveModelFriendlyName, type AiProviderId } from './ai-providers.ts'
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

function readStoredConfig(): Partial<OpenAiConfig> | undefined {
  const settings = loadAccountSettings()
  if (!settings) {
    return undefined
  }
  return accountSettingsToOpenAiConfig(settings)
}

export function readOpenAiConfigFromEnv(): OpenAiConfig {
  const config = mergeOpenAiConfig()
  return config
}

export function mergeOpenAiConfig(
  overrides?: Partial<OpenAiConfig>,
): OpenAiConfig {
  const stored = readStoredConfig()
  const env = readEnvConfig()

  const apiKey = overrides?.apiKey ?? stored?.apiKey ?? env.apiKey
  const baseURL = overrides?.baseURL ?? stored?.baseURL ?? env.baseURL
  const defaultModel =
    overrides?.defaultModel ?? stored?.defaultModel ?? env.defaultModel ?? DEFAULT_MODEL
  const providerId = overrides?.providerId ?? stored?.providerId ?? 'deepseek'
  const thinkingEnabled = overrides?.thinkingEnabled ?? stored?.thinkingEnabled ?? getDefaultThinkingEnabled(providerId)

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
    const preferred = settings.providers[settings.preferredIndex] ?? settings.providers[0]
    if (preferred?.apiKey) {
      return true
    }
  }
  return Boolean(import.meta.env.VITE_OPENAI_API_KEY?.trim())
}

export function readDefaultModelId(): string {
  const settings = loadAccountSettings()
  if (settings && settings.providers.length > 0) {
    const preferred = settings.providers[settings.preferredIndex] ?? settings.providers[0]
    if (preferred?.defaultModel) {
      return preferred.defaultModel
    }
  }
  return import.meta.env.VITE_OPENAI_MODEL?.trim() || DEFAULT_MODEL
}

export function readDefaultModelFriendlyName(): string {
  const modelId = readDefaultModelId()
  const settings = loadAccountSettings()
  if (settings && settings.providers.length > 0) {
    const preferred = settings.providers[settings.preferredIndex] ?? settings.providers[0]
    if (preferred) {
      return resolveModelFriendlyName(modelId, preferred.providerId)
    }
  }
  return resolveModelFriendlyName(modelId)
}
