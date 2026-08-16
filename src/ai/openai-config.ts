import { accountSettingsToOpenAiConfig, loadAccountSettings } from '../os/account-settings-storage.ts'
import { loadProxyServerSettings } from '../os/proxy-server-settings-storage.ts'
import {
  getDefaultThinkingEnabled,
  providerRequiresProxy,
  resolveModelFriendlyName,
  resolvePreferredModelRef,
  type AiModelCapability,
  type AiProviderId,
} from './ai-providers.ts'
import type { AiReasoningEffort } from './ai-thinking.ts'
import { notifyOpenAiConfigChange, subscribeOpenAiConfig } from './openai-config-events.ts'

export type OpenAiConfig = {
  apiKey: string
  baseURL?: string
  defaultModel: string
  providerId: AiProviderId
  thinkingEnabled: boolean
  /**
   * OpenAI reasoning_effort；缺省不传（模型默认）。
   * 仅在 thinkingEnabled 时有意义。
   */
  thinkingEffort?: AiReasoningEffort
  /** 是否经代理服务器（WebView 后端 Worker）访问 */
  useProxy?: boolean
}

const DEFAULT_MODEL = 'deepseek-v4-flash'

/**
 * 优先级：overrides > 本机钥匙串 > env。
 */
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

/** 是否启用「Instant 免费额度」网关（经 PoW 代理，无需真实 key） */
export function isInstantFreeProxy(): boolean {
  return loadProxyServerSettings().preset === 'instant-free'
}

export function mergeOpenAiConfig(
  overrides?: Partial<OpenAiConfig>,
  capability: AiModelCapability = 'text',
): OpenAiConfig {
  const stored = readStoredConfig(capability)
  const env = readEnvConfig()
  const freeTier = isInstantFreeProxy()

  const apiKey = freeTier
    ? 'instant-free'
    : (overrides?.apiKey ?? stored?.apiKey ?? env.apiKey)
  const baseURL = overrides?.baseURL ?? stored?.baseURL ?? env.baseURL
  const defaultModel =
    overrides?.defaultModel ??
    stored?.defaultModel ??
    env.defaultModel ??
    DEFAULT_MODEL
  const providerId =
    overrides?.providerId ?? stored?.providerId ?? env.providerId ?? 'deepseek'
  const thinkingEnabled =
    overrides?.thinkingEnabled ??
    stored?.thinkingEnabled ??
    getDefaultThinkingEnabled(providerId)
  const useProxy = freeTier
    ? true
    : providerRequiresProxy(providerId)
      ? true
      : (overrides?.useProxy ?? stored?.useProxy ?? false)
  const thinkingEffort = overrides?.thinkingEffort

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
    ...(thinkingEffort ? { thinkingEffort } : {}),
    useProxy,
  }
}

export function hasOpenAiApiKey(): boolean {
  if (isInstantFreeProxy()) {
    // 免费额度网关不需要用户自带 key
    return true
  }
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
  if (isInstantFreeProxy()) {
    // 免费额度网关仅放行白名单便宜模型
    return DEFAULT_MODEL
  }
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
