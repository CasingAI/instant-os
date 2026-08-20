import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'

export type ExperimentalSettings = {
  /** Hide menu bar and window title bar in fullscreen; reveal near top edge. */
  fullscreenImmersiveChrome: boolean
  /**
   * Show speech recognition app on desktop and dock, and the Speech settings pane.
   * 【实验性 · 未完成】语音识别仍是未完成的实验特性，默认关闭。
   */
  speechApp: boolean
  /**
   * Enable external Bridge tooling (dev ext apps) and the「外链 AI 授权」settings pane.
   * 【实验性 · 未完成】外链应用平台仍是未完成的实验特性，默认关闭。
   */
  externalBridge: boolean
  /**
   * Run installed generated apps in a sandboxed iframe without same-origin (Blob URL load).
   * Default on; Chromium 127+ desktop may place each frame in a separate renderer process.
   */
  generatedAppProcessIsolation: boolean
  /** Keep the system cursor visible during boot splash and cold-start transitions. */
  alwaysShowCursor: boolean
}

export const EXPERIMENTAL_SETTINGS_CHANGED_EVENT = 'instant-os:experimental-settings-changed'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.experimentalSettings

const DEFAULT_SETTINGS: ExperimentalSettings = {
  fullscreenImmersiveChrome: false,
  speechApp: false,
  externalBridge: false,
  generatedAppProcessIsolation: true,
  alwaysShowCursor: false,
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
    externalBridge: record.externalBridge === true,
    generatedAppProcessIsolation: processIsolation,
    alwaysShowCursor: record.alwaysShowCursor === true,
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
    externalBridge: settings.externalBridge,
    generatedAppProcessIsolation: settings.generatedAppProcessIsolation,
    alwaysShowCursor: settings.alwaysShowCursor,
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
