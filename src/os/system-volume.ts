import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'
import { osOpenApp } from './os-open-app-bridge.ts'

/**
 * 系统主音量（总闸式）。
 * 全局乘数作用于所有发声源（系统提示音、音乐播放器、语音朗读、五子棋音效）；
 * 各发声源内部仍保留自己的分轨音量（音乐音量、提示音音量）。
 * muted 独立标志，静音时不覆盖 volume 值，取消静音恢复原音量。
 */

export type SystemVolumeState = {
  /** 0–1 主音量，默认 1（不对现有音量做二次缩放）。 */
  volume: number
  /** 静音标志；静音时有效音量按 0 处理。 */
  muted: boolean
}

const DEFAULT_STATE: SystemVolumeState = {
  volume: 1,
  muted: false,
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.systemVolume

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_STATE.volume
  }
  return Math.min(1, Math.max(0, value))
}

function normalizeState(raw: unknown): SystemVolumeState {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_STATE
  }
  const record = raw as Record<string, unknown>
  return {
    volume: typeof record.volume === 'number' ? clampVolume(record.volume) : DEFAULT_STATE.volume,
    muted: record.muted === true,
  }
}

function loadState(): SystemVolumeState {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_STATE
    }
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_STATE
    }
    return normalizeState(JSON.parse(raw) as unknown)
  } catch {
    return DEFAULT_STATE
  }
}

let state: SystemVolumeState = loadState()

const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

function commit(next: SystemVolumeState): void {
  state = next
  // 持久化失败（如存储空间已满）仍保留内存状态，本次会话继续生效
  writeLocalStorageItem(STORAGE_KEY, JSON.stringify(next))
  notify()
}

export function getSystemVolumeState(): SystemVolumeState {
  return state
}

export function subscribeSystemVolume(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setSystemVolume(volume: number): void {
  const next = clampVolume(volume)
  if (next === state.volume) {
    return
  }
  commit({ ...state, volume: next })
}

export function setSystemMuted(muted: boolean): void {
  if (muted === state.muted) {
    return
  }
  commit({ ...state, muted })
}

export function toggleSystemMute(): void {
  setSystemMuted(!state.muted)
}

/** 当前有效主音量：静音时为 0，供各发声源读取。 */
export function getEffectiveSystemVolume(): number {
  return state.muted ? 0 : state.volume
}

export const OPEN_SETTINGS_SOUNDS_EVENT = 'instant-os:open-settings-sounds'

let pendingOpenSoundsView = false

export function openSettingsSoundsView(): void {
  try {
    osOpenApp('settings')
  } catch {
    // 系统尚未挂载 openApp（极少见）；仍保留 pending，设置打开后会 consume
  }
  pendingOpenSoundsView = true
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_SOUNDS_EVENT))
}

export function consumePendingOpenSoundsView(): boolean {
  if (!pendingOpenSoundsView) {
    return false
  }
  pendingOpenSoundsView = false
  return true
}
