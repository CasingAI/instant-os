import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'

export type Scene3dRuntimeMode = 'instant3d' | 'threejs'

type Scene3dLabPrefs = {
  runtimeMode: Scene3dRuntimeMode
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.scene3dLabPrefs
const DEFAULT_PREFS: Scene3dLabPrefs = { runtimeMode: 'instant3d' }

function isRuntimeMode(value: unknown): value is Scene3dRuntimeMode {
  return value === 'instant3d' || value === 'threejs'
}

export function loadScene3dLabPrefs(): Scene3dLabPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_PREFS
    }
    const parsed = JSON.parse(raw) as Partial<Scene3dLabPrefs>
    if (!isRuntimeMode(parsed.runtimeMode)) {
      return DEFAULT_PREFS
    }
    return { runtimeMode: parsed.runtimeMode }
  } catch {
    return DEFAULT_PREFS
  }
}

export function saveScene3dLabRuntimeMode(runtimeMode: Scene3dRuntimeMode): void {
  writeLocalStorageItem(STORAGE_KEY, JSON.stringify({ runtimeMode }))
}
