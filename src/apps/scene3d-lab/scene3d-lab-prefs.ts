import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'

type Scene3dLabPrefs = {
  physicsEnabled: boolean
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.scene3dLabPrefs
const DEFAULT_PREFS: Scene3dLabPrefs = { physicsEnabled: false }

export function loadScene3dLabPrefs(): Scene3dLabPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_PREFS
    }
    const parsed = JSON.parse(raw) as Partial<Scene3dLabPrefs>
    return {
      physicsEnabled: parsed.physicsEnabled === true,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export function saveScene3dLabPrefs(prefs: Scene3dLabPrefs): void {
  writeLocalStorageItem(STORAGE_KEY, JSON.stringify(prefs))
}

export function saveScene3dLabPhysicsEnabled(physicsEnabled: boolean): void {
  saveScene3dLabPrefs({ ...loadScene3dLabPrefs(), physicsEnabled })
}
