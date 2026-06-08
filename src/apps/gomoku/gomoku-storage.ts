import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'

export type GomokuGameMode = 'pvp' | 'pve'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.gomoku

type GomokuPrefs = {
  gameMode: GomokuGameMode
}

function normalizeGameMode(value: unknown): GomokuGameMode {
  return value === 'pve' ? 'pve' : 'pvp'
}

export function loadGomokuGameMode(): GomokuGameMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return 'pve'
    const parsed = JSON.parse(raw) as Partial<GomokuPrefs>
    return normalizeGameMode(parsed.gameMode)
  } catch {
    return 'pve'
  }
}

export function saveGomokuGameMode(gameMode: GomokuGameMode): void {
  writeLocalStorageItem(STORAGE_KEY, JSON.stringify({ gameMode } satisfies GomokuPrefs))
}
