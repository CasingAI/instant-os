import {
  DEFAULT_AI_PROVIDER_ID,
  defaultProviderEntry,
  isCustomProvider,
  isProviderEntryValid,
  normalizeStoredModel,
  resolveProviderEntryBaseURL,
  type AccountSettingsV2,
  type AiProviderEntry,
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
import { getBridgeStorageOverride } from '../bridge/bridge-storage-context.ts'

// Legacy single-provider type for migration
type LegacyAccountSettings = {
  providerId: AiProviderId
  apiKey: string
  model: string
  baseURL?: string
  thinkingEnabled: boolean
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.accountSettings

function isV2Settings(
  raw: Record<string, unknown>,
): raw is AccountSettingsV2 {
  return raw.version === 2
}

function migrateLegacySettings(
  raw: LegacyAccountSettings,
): AccountSettingsV2 {
  const entry = defaultProviderEntry(raw.providerId)
  entry.apiKey = raw.apiKey
  if (raw.baseURL) {
    entry.baseURL = raw.baseURL
  }
  if (raw.model) {
    const normalizedModel = isCustomProvider(raw.providerId)
      ? raw.model
      : normalizeStoredModel(raw.providerId, raw.model)
    entry.defaultModel = normalizedModel

    if (
      !isCustomProvider(raw.providerId) &&
      !entry.enabledModels.some((m) => m.modelId === normalizedModel)
    ) {
      entry.enabledModels.push({
        modelId: normalizedModel,
        name: normalizedModel,
      })
    }
  }
  entry.thinkingEnabled = raw.thinkingEnabled

  return {
    version: 2,
    providers: [entry],
    preferredIndex: 0,
  }
}

function normalizeProviderId(value: unknown): AiProviderId {
  if (
    value === 'openai' ||
    value === 'deepseek' ||
    value === 'mimo' ||
    value === 'mimo-token-plan' ||
    value === 'custom'
  ) {
    return value
  }
  return DEFAULT_AI_PROVIDER_ID
}

function normalizeProviderEntry(raw: unknown): AiProviderEntry | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const record = raw as Record<string, unknown>
  const providerId = normalizeProviderId(record.providerId)
  const apiKey =
    typeof record.apiKey === 'string' ? record.apiKey.trim() : ''
  const defaultModel =
    typeof record.defaultModel === 'string'
      ? record.defaultModel.trim()
      : ''
  const thinkingEnabled =
    typeof record.thinkingEnabled === 'boolean'
      ? record.thinkingEnabled
      : false
  const baseURL =
    typeof record.baseURL === 'string' ? record.baseURL.trim() : ''
  const id =
    typeof record.id === 'string' && record.id.trim()
      ? record.id.trim()
      : crypto.randomUUID()

  const enabledModels: AiProviderEntry['enabledModels'] = []
  if (Array.isArray(record.enabledModels)) {
    for (const item of record.enabledModels) {
      if (item && typeof item === 'object') {
        const modelRecord = item as Record<string, unknown>
        const modelId =
          typeof modelRecord.modelId === 'string'
            ? modelRecord.modelId.trim()
            : ''
        const name =
          typeof modelRecord.name === 'string'
            ? modelRecord.name.trim()
            : modelId
        if (modelId) {
          enabledModels.push({ modelId, name })
        }
      }
    }
  }

  if (!apiKey) {
    return undefined
  }

  return {
    id,
    providerId,
    apiKey,
    baseURL: baseURL || undefined,
    enabledModels,
    defaultModel,
    thinkingEnabled,
  }
}

function normalizeV2Settings(
  raw: unknown,
): AccountSettingsV2 | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const record = raw as Record<string, unknown>

  if (!isV2Settings(record)) {
    return undefined
  }

  const rawProviders = Array.isArray(record.providers)
    ? record.providers
    : []
  const providers: AiProviderEntry[] = []
  for (const rawEntry of rawProviders) {
    const entry = normalizeProviderEntry(rawEntry)
    if (entry) {
      providers.push(entry)
    }
  }

  if (providers.length === 0) {
    return undefined
  }

  const preferredIndex =
    typeof record.preferredIndex === 'number'
      ? Math.max(0, Math.min(record.preferredIndex, providers.length - 1))
      : 0

  return {
    version: 2,
    providers,
    preferredIndex,
  }
}

function normalizeLegacySettings(
  raw: unknown,
): LegacyAccountSettings | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const record = raw as Record<string, unknown>

  if ('version' in record) {
    return undefined
  }

  const providerId = normalizeProviderId(record.providerId)
  const apiKey =
    typeof record.apiKey === 'string' ? record.apiKey.trim() : ''
  const modelRaw =
    typeof record.model === 'string' ? record.model.trim() : ''
  const baseURL =
    typeof record.baseURL === 'string' ? record.baseURL.trim() : ''

  if (!apiKey || !modelRaw) {
    return undefined
  }

  if (isCustomProvider(providerId) && !baseURL) {
    return undefined
  }

  return {
    providerId,
    apiKey,
    model: modelRaw,
    baseURL: baseURL || undefined,
    thinkingEnabled:
      typeof record.thinkingEnabled === 'boolean'
        ? record.thinkingEnabled
        : false,
  }
}

function resolveAccountSettingsStorage(storage?: Storage): Storage {
  return storage ?? getBridgeStorageOverride() ?? localStorage
}

export function loadAccountSettings(storage?: Storage): AccountSettingsV2 | undefined {
  try {
    const raw = resolveAccountSettingsStorage(storage).getItem(STORAGE_KEY)
    if (!raw) {
      return undefined
    }
    const parsed = JSON.parse(raw)

    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      'version' in parsed
    ) {
      return normalizeV2Settings(parsed)
    }

    const legacy = normalizeLegacySettings(parsed)
    if (legacy) {
      return migrateLegacySettings(legacy)
    }

    return undefined
  } catch {
    return undefined
  }
}

export function saveAccountSettings(
  settings: AccountSettingsV2,
): boolean {
  if (!isAccountSettingsValid(settings)) {
    return false
  }

  const serialized = JSON.stringify(settings)

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
  settings: AccountSettingsV2,
): Partial<OpenAiConfig> | undefined {
  const entry = getPreferredProvider(settings)
  if (!entry) {
    return undefined
  }

  const baseURL = resolveProviderEntryBaseURL(entry)

  return {
    apiKey: entry.apiKey,
    baseURL: baseURL || undefined,
    defaultModel: entry.defaultModel,
    providerId: entry.providerId,
    thinkingEnabled: entry.thinkingEnabled,
  }
}

export function defaultAccountSettingsV2(): AccountSettingsV2 {
  const entry = defaultProviderEntry()
  return {
    version: 2,
    providers: [entry],
    preferredIndex: 0,
  }
}

export function isAccountSettingsValid(
  settings: AccountSettingsV2,
): boolean {
  if (
    settings.providers.length === 0 ||
    settings.preferredIndex < 0 ||
    settings.preferredIndex >= settings.providers.length
  ) {
    return false
  }
  return isProviderEntryValid(settings.providers[settings.preferredIndex])
}

export function getPreferredProvider(
  settings: AccountSettingsV2,
): AiProviderEntry | undefined {
  if (
    settings.preferredIndex >= 0 &&
    settings.preferredIndex < settings.providers.length
  ) {
    return settings.providers[settings.preferredIndex]
  }
  return settings.providers[0]
}

export { type AccountSettingsV2, type AiProviderEntry, type AiModelEntry } from '../ai/ai-providers.ts'

