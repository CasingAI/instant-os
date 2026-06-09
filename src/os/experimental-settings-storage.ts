import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'

export type ExperimentalSettings = {
  icodeEnabled: boolean
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.experimentalSettings

const DEFAULT_SETTINGS: ExperimentalSettings = {
  icodeEnabled: false,
}

type ExperimentalSettingsListener = () => void
const listeners = new Set<ExperimentalSettingsListener>()

export function subscribeExperimentalSettings(listener: ExperimentalSettingsListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifyExperimentalSettingsChange() {
  for (const listener of listeners) {
    listener()
  }
}

function normalizeExperimentalSettings(raw: unknown): ExperimentalSettings {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_SETTINGS
  }

  const record = raw as Record<string, unknown>
  return {
    icodeEnabled: record.icodeEnabled === true,
  }
}

export function loadExperimentalSettings(): ExperimentalSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_SETTINGS
    }
    return normalizeExperimentalSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveExperimentalSettings(settings: ExperimentalSettings): boolean {
  const serialized = JSON.stringify({
    icodeEnabled: settings.icodeEnabled,
  })
  const saved = writeLocalStorageItem(STORAGE_KEY, serialized)
  if (saved) {
    notifyExperimentalSettingsChange()
  }
  return saved
}

export function patchExperimentalSettings(patch: Partial<ExperimentalSettings>): boolean {
  return saveExperimentalSettings({ ...loadExperimentalSettings(), ...patch })
}

export function isIcodeLauncherEnabled(): boolean {
  return loadExperimentalSettings().icodeEnabled
}
