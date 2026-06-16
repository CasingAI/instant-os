import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'

export type ExperimentalSettings = {
  /** Hide menu bar and window title bar in fullscreen; reveal near top edge. */
  fullscreenImmersiveChrome: boolean
  /** Show speech recognition app on desktop and dock. */
  speechApp: boolean
  /**
   * Run installed generated apps in a sandboxed iframe without same-origin (Blob URL load).
   * Default on; Chromium 127+ desktop may place each frame in a separate renderer process.
   */
  generatedAppProcessIsolation: boolean
}

export const EXPERIMENTAL_SETTINGS_CHANGED_EVENT = 'instant-os:experimental-settings-changed'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.experimentalSettings

const DEFAULT_SETTINGS: ExperimentalSettings = {
  fullscreenImmersiveChrome: false,
  speechApp: false,
  generatedAppProcessIsolation: true,
}

function normalizeExperimentalSettings(raw: unknown): ExperimentalSettings {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_SETTINGS
  }

  const record = raw as Record<string, unknown>
  const processIsolation =
    'generatedAppProcessIsolation' in record
      ? record.generatedAppProcessIsolation === true
      : true

  return {
    fullscreenImmersiveChrome: record.fullscreenImmersiveChrome === true,
    speechApp: record.speechApp === true,
    generatedAppProcessIsolation: processIsolation,
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
    fullscreenImmersiveChrome: settings.fullscreenImmersiveChrome,
    speechApp: settings.speechApp,
    generatedAppProcessIsolation: settings.generatedAppProcessIsolation,
  })
  if (!writeLocalStorageItem(STORAGE_KEY, serialized)) {
    return false
  }
  window.dispatchEvent(new CustomEvent(EXPERIMENTAL_SETTINGS_CHANGED_EVENT))
  return true
}

export function patchExperimentalSettings(patch: Partial<ExperimentalSettings>): boolean {
  return saveExperimentalSettings({ ...loadExperimentalSettings(), ...patch })
}
