import {
  DEFAULT_AI_PROVIDER_ID,
  findAiProviderPreset,
  getDefaultThinkingEnabled,
  isCustomProvider,
  isKnownModel,
  normalizeStoredModel,
  resolveProviderBaseURL,
  type AiProviderId,
} from '../ai/ai-providers.ts'
import { notifyOpenAiConfigChange } from '../ai/openai-config-events.ts'
import { clearOpenAiClientCache } from '../ai/openai-client.ts'
import {
  assertDeviceStorageCapacity,
  DEVICE_STORAGE_KEYS,
  writeLocalStorageItem,
} from './device-storage.ts'
import type { OpenAiConfig } from '../ai/openai-config.ts'

export type AccountSettings = {
  providerId: AiProviderId
  apiKey: string
  model: string
  baseURL?: string
  thinkingEnabled: boolean
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.accountSettings

function normalizeProviderId(value: unknown): AiProviderId {
  if (value === 'openai' || value === 'deepseek' || value === 'mimo' || value === 'custom') {
    return value
  }
  return DEFAULT_AI_PROVIDER_ID
}

function normalizeAccountSettings(raw: unknown): AccountSettings | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }

  const record = raw as Record<string, unknown>
  const providerId = normalizeProviderId(record.providerId)
  const apiKey = typeof record.apiKey === 'string' ? record.apiKey.trim() : ''
  const modelRaw = typeof record.model === 'string' ? record.model.trim() : ''
  const baseURL = typeof record.baseURL === 'string' ? record.baseURL.trim() : ''

  if (!apiKey || !modelRaw) {
    return undefined
  }

  if (isCustomProvider(providerId)) {
    if (!baseURL) {
      return undefined
    }
    return {
      providerId,
      apiKey,
      model: modelRaw,
      baseURL,
      thinkingEnabled: false,
    }
  }

  const thinkingEnabled =
    typeof record.thinkingEnabled === 'boolean' ? record.thinkingEnabled : getDefaultThinkingEnabled(providerId)

  return {
    providerId,
    apiKey,
    model: normalizeStoredModel(providerId, modelRaw),
    thinkingEnabled,
  }
}

export function loadAccountSettings(): AccountSettings | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return undefined
    }
    return normalizeAccountSettings(JSON.parse(raw))
  } catch {
    return undefined
  }
}

export function saveAccountSettings(settings: AccountSettings): boolean {
  if (!isAccountSettingsValid(settings)) {
    return false
  }

  const payload: AccountSettings = {
    providerId: settings.providerId,
    apiKey: settings.apiKey.trim(),
    model: settings.model.trim(),
    thinkingEnabled: settings.thinkingEnabled,
    ...(isCustomProvider(settings.providerId)
      ? { baseURL: settings.baseURL?.trim() }
      : {}),
  }

  const serialized = JSON.stringify(payload)

  try {
    assertDeviceStorageCapacity(STORAGE_KEY, serialized)
  } catch {
    return false
  }

  if (!writeLocalStorageItem(STORAGE_KEY, serialized)) {
    return false
  }

  clearOpenAiClientCache()
  notifyOpenAiConfigChange()
  return true
}

export function clearAccountSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    return
  }
  clearOpenAiClientCache()
  notifyOpenAiConfigChange()
}

export function accountSettingsToOpenAiConfig(
  settings: AccountSettings,
): Partial<OpenAiConfig> {
  const baseURL = isCustomProvider(settings.providerId)
    ? settings.baseURL?.trim()
    : resolveProviderBaseURL(settings.providerId)

  return {
    apiKey: settings.apiKey,
    baseURL: baseURL || undefined,
    defaultModel: settings.model,
    providerId: settings.providerId,
    thinkingEnabled: settings.thinkingEnabled,
  }
}

export function defaultAccountSettings(
  providerId: AiProviderId = DEFAULT_AI_PROVIDER_ID,
): AccountSettings {
  if (isCustomProvider(providerId)) {
    return {
      providerId,
      apiKey: '',
      model: '',
      baseURL: '',
      thinkingEnabled: false,
    }
  }

  const preset = findAiProviderPreset(providerId)
  return {
    providerId,
    apiKey: '',
    model: preset?.defaultModel ?? '',
    thinkingEnabled: getDefaultThinkingEnabled(providerId),
  }
}

export function isAccountSettingsValid(settings: AccountSettings): boolean {
  const hasCredentials = Boolean(settings.apiKey.trim() && settings.model.trim())
  if (isCustomProvider(settings.providerId)) {
    return hasCredentials && Boolean(settings.baseURL?.trim())
  }
  return hasCredentials
}

export function mergeAccountSettings(
  stored: AccountSettings | undefined,
  providerId: AiProviderId,
): AccountSettings {
  const base = stored ?? defaultAccountSettings(providerId)

  if (isCustomProvider(providerId)) {
    const wasCustom = isCustomProvider(base.providerId)
    return {
      providerId,
      apiKey: base.apiKey,
      model: wasCustom ? base.model : '',
      baseURL: wasCustom ? (base.baseURL ?? '') : '',
      thinkingEnabled: false,
    }
  }

  const preset = findAiProviderPreset(providerId)
  const model = normalizeStoredModel(providerId, base.model)

  return {
    providerId,
    apiKey: base.apiKey,
    model: preset && isKnownModel(providerId, model) ? model : preset?.defaultModel ?? model,
    thinkingEnabled: base.thinkingEnabled,
  }
}
