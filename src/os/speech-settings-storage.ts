import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'

export type AsrLanguagePreference = 'auto' | 'zh' | 'en'

export type SpeechSettings = {
  version: 1
  /** 系统默认 TTS 音色 id（相对当前供应商音色表） */
  defaultVoice: string
  /** 系统默认 ASR 语种 */
  defaultAsrLanguage: AsrLanguagePreference
}

export const SPEECH_SETTINGS_CHANGED_EVENT = 'instant-os:speech-settings-changed'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.speechSettings

/** 与 MiMo 预设音色表默认项一致；未知供应商时仍可作回退 */
export const DEFAULT_SPEECH_VOICE = '冰糖'

const DEFAULT_SETTINGS: SpeechSettings = {
  version: 1,
  defaultVoice: DEFAULT_SPEECH_VOICE,
  defaultAsrLanguage: 'auto',
}

const ASR_LANGUAGES: ReadonlySet<string> = new Set(['auto', 'zh', 'en'])

function normalizeAsrLanguage(raw: unknown): AsrLanguagePreference {
  if (typeof raw === 'string' && ASR_LANGUAGES.has(raw)) {
    return raw as AsrLanguagePreference
  }
  return DEFAULT_SETTINGS.defaultAsrLanguage
}

function normalizeSpeechSettings(raw: unknown): SpeechSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SETTINGS }
  }

  const record = raw as Record<string, unknown>
  const voice =
    typeof record.defaultVoice === 'string' && record.defaultVoice.trim()
      ? record.defaultVoice.trim()
      : DEFAULT_SETTINGS.defaultVoice

  return {
    version: 1,
    defaultVoice: voice,
    defaultAsrLanguage: normalizeAsrLanguage(record.defaultAsrLanguage),
  }
}

export function loadSpeechSettings(): SpeechSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { ...DEFAULT_SETTINGS }
    }
    return normalizeSpeechSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSpeechSettings(settings: SpeechSettings): boolean {
  const payload = normalizeSpeechSettings(settings)
  if (!writeLocalStorageItem(STORAGE_KEY, JSON.stringify(payload))) {
    return false
  }
  window.dispatchEvent(new CustomEvent(SPEECH_SETTINGS_CHANGED_EVENT))
  return true
}

export function patchSpeechSettings(
  patch: Partial<Omit<SpeechSettings, 'version'>>,
): boolean {
  return saveSpeechSettings({ ...loadSpeechSettings(), ...patch })
}

export function subscribeSpeechSettings(listener: () => void): () => void {
  window.addEventListener(SPEECH_SETTINGS_CHANGED_EVENT, listener)
  return () => {
    window.removeEventListener(SPEECH_SETTINGS_CHANGED_EVENT, listener)
  }
}
