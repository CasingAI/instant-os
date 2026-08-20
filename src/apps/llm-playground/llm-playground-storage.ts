import {
  DEVICE_STORAGE_KEYS,
  getLocalStorageKeyBytes,
  writeLocalStorageItem,
} from '../../os/device-storage.ts'
import {
  LLM_PLAYGROUND_DEFAULT_CONFIG,
  type LlmPlaygroundConfig,
  type LlmPlaygroundMessage,
  type LlmPlaygroundStore,
} from './llm-playground-types.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.llmPlayground

export function createPlaygroundMessageId(): string {
  return `llm-playground-msg-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

export function createPlaygroundMessage(
  role: LlmPlaygroundMessage['role'],
  content = '',
): LlmPlaygroundMessage {
  return { id: createPlaygroundMessageId(), role, content }
}

function emptyStore(): LlmPlaygroundStore {
  return {
    version: 1,
    messages: [],
    config: { ...LLM_PLAYGROUND_DEFAULT_CONFIG },
  }
}

function normalizeConfig(config: Partial<LlmPlaygroundConfig> | undefined): LlmPlaygroundConfig {
  const defaults = LLM_PLAYGROUND_DEFAULT_CONFIG
  return {
    modelRefKey:
      typeof config?.modelRefKey === 'string' ? config.modelRefKey : defaults.modelRefKey,
    thinkingEnabled:
      typeof config?.thinkingEnabled === 'boolean'
        ? config.thinkingEnabled
        : defaults.thinkingEnabled,
    thinkingEffort:
      typeof config?.thinkingEffort === 'string' ? config.thinkingEffort : defaults.thinkingEffort,
    temperature: normalizeNullableNumber(config?.temperature, defaults.temperature),
    topP: normalizeNullableNumber(config?.topP, defaults.topP),
    frequencyPenalty: normalizeNullableNumber(
      config?.frequencyPenalty,
      defaults.frequencyPenalty,
    ),
    presencePenalty: normalizeNullableNumber(config?.presencePenalty, defaults.presencePenalty),
    maxTokens: normalizeNullableNumber(config?.maxTokens, defaults.maxTokens),
    stop: typeof config?.stop === 'string' ? config.stop : defaults.stop,
    autoAppendResponse:
      typeof config?.autoAppendResponse === 'boolean'
        ? config.autoAppendResponse
        : defaults.autoAppendResponse,
  }
}

function normalizeNullableNumber(
  value: number | null | undefined,
  fallback: number | null,
): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  return fallback
}

function normalizeMessages(raw: unknown): LlmPlaygroundMessage[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const messages: LlmPlaygroundMessage[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const role = record.role
    if (role !== 'system' && role !== 'user' && role !== 'assistant') continue
    const content = typeof record.content === 'string' ? record.content : ''
    const id = typeof record.id === 'string' ? record.id : createPlaygroundMessageId()
    messages.push({ id, role, content })
  }
  return messages
}

function loadStore(): LlmPlaygroundStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return emptyStore()
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      version: 1,
      messages: normalizeMessages(parsed.messages),
      config: normalizeConfig(parsed.config as Partial<LlmPlaygroundConfig> | undefined),
    }
  } catch {
    return emptyStore()
  }
}

export function readLlmPlaygroundStore(): LlmPlaygroundStore {
  return loadStore()
}

export function writeLlmPlaygroundStore(store: LlmPlaygroundStore): boolean {
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(store))
}

export function getLlmPlaygroundStorageBytes(): number {
  return getLocalStorageKeyBytes(STORAGE_KEY)
}
