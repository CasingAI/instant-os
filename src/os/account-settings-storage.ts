import {
  DEFAULT_AI_PROVIDER_ID,
  findAiProviderPreset,
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
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.accountSettings

function normalizeProviderId(value: unknown): AiProviderId {
  if (value === 'openai' || value === 'deepseek') {
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

  if (!apiKey || !modelRaw) {
    return undefined
  }

  return {
    providerId,
    apiKey,
    model: normalizeStoredModel(providerId, modelRaw),
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
  const payload: AccountSettings = {
    providerId: settings.providerId,
    apiKey: settings.apiKey.trim(),
    model: settings.model.trim(),
  }

  if (!payload.apiKey || !payload.model) {
    return false
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
  return {
    apiKey: settings.apiKey,
    baseURL: resolveProviderBaseURL(settings.providerId),
    defaultModel: settings.model,
  }
}

export function defaultAccountSettings(
  providerId: AiProviderId = DEFAULT_AI_PROVIDER_ID,
): AccountSettings {
  const preset = findAiProviderPreset(providerId)
  return {
    providerId,
    apiKey: '',
    model: preset?.defaultModel ?? '',
  }
}

export function isAccountSettingsValid(settings: AccountSettings): boolean {
  return Boolean(settings.apiKey.trim() && settings.model.trim())
}

export function mergeAccountSettings(
  stored: AccountSettings | undefined,
  providerId: AiProviderId,
): AccountSettings {
  const base = stored ?? defaultAccountSettings(providerId)
  const preset = findAiProviderPreset(providerId)
  const model = normalizeStoredModel(providerId, base.model)

  return {
    providerId,
    apiKey: base.apiKey,
    model: preset?.models.includes(model) ? model : preset?.defaultModel ?? model,
  }
}
