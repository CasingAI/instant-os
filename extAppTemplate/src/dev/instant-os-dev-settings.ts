export type DevSettings = {
  aiApiBase: string
  aiApiKey: string
  aiModel: string
  floatBallX: number | undefined
  floatBallY: number | undefined
}

export const DEV_SETTINGS_CHANGED_EVENT = 'instant-os-dev-settings-changed'

const STORAGE_KEY = 'instant-os-ext-app-dev-settings'

const DEFAULT_MODEL = 'gpt-4o-mini'

function readEnvFallback(): Pick<DevSettings, 'aiApiBase' | 'aiApiKey' | 'aiModel'> {
  return {
    aiApiBase: import.meta.env.VITE_DEV_AI_API_BASE?.trim() || '',
    aiApiKey: import.meta.env.VITE_DEV_AI_API_KEY?.trim() || '',
    aiModel: import.meta.env.VITE_DEV_AI_MODEL?.trim() || DEFAULT_MODEL,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== undefined
}

function normalizeStoredSettings(raw: unknown): Partial<DevSettings> {
  if (!isRecord(raw)) {
    return {}
  }

  return {
    aiApiBase: typeof raw.aiApiBase === 'string' ? raw.aiApiBase : undefined,
    aiApiKey: typeof raw.aiApiKey === 'string' ? raw.aiApiKey : undefined,
    aiModel: typeof raw.aiModel === 'string' ? raw.aiModel : undefined,
    floatBallX: typeof raw.floatBallX === 'number' ? raw.floatBallX : undefined,
    floatBallY: typeof raw.floatBallY === 'number' ? raw.floatBallY : undefined,
  }
}

function loadStoredSettings(): Partial<DevSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {}
    }
    return normalizeStoredSettings(JSON.parse(raw))
  } catch {
    return {}
  }
}

function emitSettingsChanged(): void {
  window.dispatchEvent(new CustomEvent(DEV_SETTINGS_CHANGED_EVENT))
}

export function loadDevSettings(): DevSettings {
  const envFallback = readEnvFallback()
  const stored = loadStoredSettings()

  return {
    aiApiBase: stored.aiApiBase ?? envFallback.aiApiBase,
    aiApiKey: stored.aiApiKey ?? envFallback.aiApiKey,
    aiModel: stored.aiModel?.trim() || envFallback.aiModel || DEFAULT_MODEL,
    floatBallX: stored.floatBallX,
    floatBallY: stored.floatBallY,
  }
}

export function saveDevSettings(patch: Partial<DevSettings>): DevSettings {
  const current = loadDevSettings()
  const next: DevSettings = {
    aiApiBase: patch.aiApiBase ?? current.aiApiBase,
    aiApiKey: patch.aiApiKey ?? current.aiApiKey,
    aiModel: patch.aiModel?.trim() || current.aiModel || DEFAULT_MODEL,
    floatBallX: patch.floatBallX ?? current.floatBallX,
    floatBallY: patch.floatBallY ?? current.floatBallY,
  }

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      aiApiBase: next.aiApiBase,
      aiApiKey: next.aiApiKey,
      aiModel: next.aiModel,
      floatBallX: next.floatBallX,
      floatBallY: next.floatBallY,
    }),
  )

  emitSettingsChanged()
  return next
}

export function clearDevSettings(): void {
  localStorage.removeItem(STORAGE_KEY)
  emitSettingsChanged()
}

export function subscribeDevSettings(listener: () => void): () => void {
  const handler = () => listener()
  window.addEventListener(DEV_SETTINGS_CHANGED_EVENT, handler)
  return () => window.removeEventListener(DEV_SETTINGS_CHANGED_EVENT, handler)
}

export function readEffectiveAiApiBase(): string | undefined {
  const value = loadDevSettings().aiApiBase.trim()
  return value || undefined
}

export function readEffectiveAiApiKey(): string | undefined {
  const value = loadDevSettings().aiApiKey.trim()
  return value || undefined
}

export function readEffectiveAiModel(): string {
  return loadDevSettings().aiModel.trim() || DEFAULT_MODEL
}

export function hasEffectiveDevAiCredentials(): boolean {
  return readEffectiveAiApiBase() !== undefined && readEffectiveAiApiKey() !== undefined
}

export function maskSecret(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return '未配置'
  }
  if (trimmed.length <= 8) {
    return '••••••••'
  }
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`
}
