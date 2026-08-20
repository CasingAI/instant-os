import { accountSettingsToOpenAiConfig, loadAccountSettings } from '../os/account-settings-storage.ts'
import {
  getDefaultThinkingEnabled,
  isInstantFreeProvider,
  isOpencodeZenProvider,
  providerRequiresProxy,
  resolveModelFriendlyName,
  resolvePreferredModelRef,
  type AiModelCapability,
  type AiProviderId,
} from './ai-providers.ts'
import type { AiReasoningEffort } from './ai-thinking.ts'
import { INSTANT_FREE_PROVIDER_BASE_URL } from './instant-free-gateway.ts'
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
/** 免费额度档的默认模型：网关对外暴露的多候选模型名（auto） */
const FREE_TIER_DEFAULT_MODEL = 'auto'
/** 无任何配置时的兜底供应商：免费额度，保证开箱即用 */
const DEFAULT_MODEL_PROVIDER_ID: AiProviderId = 'instant-free'

/**
 * OpenCode Zen 未填 key 时的占位值：满足 SDK 构造要求（apiKey 非空），
 * 实际发送时由 openai-client 移除 Authorization 头（zen 免费模型匿名可用）。
 */
export const OPCODE_ZEN_PLACEHOLDER_API_KEY = 'opencode-zen'

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

/** 当前生效（首选）供应商是否为「Instant 免费额度」 */
export function isActiveProviderInstantFree(
  capability: AiModelCapability = 'text',
): boolean {
  const settings = loadAccountSettings()
  if (!settings || settings.providers.length === 0) {
    // 无任何配置：mergeOpenAiConfig 兜底 instant-free，免费档生效
    return true
  }
  const ref = resolvePreferredModelRef(settings, capability)
  const entry = ref
    ? settings.providers.find((item) => item.id === ref.providerEntryId)
    : (settings.providers[settings.preferredIndex] ?? settings.providers[0])
  return isInstantFreeProvider(entry?.providerId)
}

export function mergeOpenAiConfig(
  overrides?: Partial<OpenAiConfig>,
  capability: AiModelCapability = 'text',
): OpenAiConfig {
  const stored = readStoredConfig(capability)
  const env = readEnvConfig()
  const providerId =
    overrides?.providerId ??
    stored?.providerId ??
    env.providerId ??
    DEFAULT_MODEL_PROVIDER_ID
  const freeTier = isInstantFreeProvider(providerId)
  const zenTier = isOpencodeZenProvider(providerId)

  const apiKey = freeTier
    ? 'instant-free'
    : zenTier && !(overrides?.apiKey ?? stored?.apiKey ?? env.apiKey)
      ? OPCODE_ZEN_PLACEHOLDER_API_KEY
      : (overrides?.apiKey ?? stored?.apiKey ?? env.apiKey)
  const baseURL = freeTier
    ? INSTANT_FREE_PROVIDER_BASE_URL
    : (overrides?.baseURL ?? stored?.baseURL ?? env.baseURL)
  const defaultModel = freeTier
    ? FREE_TIER_DEFAULT_MODEL
    : (overrides?.defaultModel ??
      stored?.defaultModel ??
      env.defaultModel ??
      DEFAULT_MODEL)
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
  if (isActiveProviderInstantFree()) {
    // 免费额度网关不需要用户自带 key
    return true
  }
  const settings = loadAccountSettings()
  if (settings && settings.providers.length > 0) {
    const preferred =
      settings.providers[settings.preferredIndex] ?? settings.providers[0]
    // OpenCode Zen 免费模型无需 key
    if (isOpencodeZenProvider(preferred?.providerId)) {
      return true
    }
    if (preferred?.apiKey) {
      return true
    }
  }
  return Boolean(import.meta.env.VITE_OPENAI_API_KEY?.trim())
}

export function readDefaultModelId(capability: AiModelCapability = 'text'): string {
  if (isActiveProviderInstantFree(capability)) {
    // 免费额度网关仅放行白名单便宜模型
    return FREE_TIER_DEFAULT_MODEL
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
