import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../os/device-storage.ts'
import type { AppId, WindowState } from '../os/types.ts'
import { clampFloatingSize } from './window-resize.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.windowSizes

type SavedWindowSize = {
  width: number
  height: number
}

type SavedWindowSizes = Record<string, SavedWindowSize>

function readAll(): SavedWindowSizes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as SavedWindowSizes
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAll(sizes: SavedWindowSizes): boolean {
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(sizes))
}

export function getPersistableWindowSize(window: WindowState): SavedWindowSize {
  const bounds = window.restoredBounds
  if (bounds && (window.fullscreen || window.maximized || window.snap)) {
    return { width: bounds.width, height: bounds.height }
  }
  return { width: window.width, height: window.height }
}

export function loadSavedWindowSize(appId: AppId): SavedWindowSize | undefined {
  const saved = readAll()[appId]
  if (!saved || typeof saved.width !== 'number' || typeof saved.height !== 'number') {
    return undefined
  }
  return clampFloatingSize(saved.width, saved.height)
}

export function saveWindowSize(appId: AppId, width: number, height: number) {
  const clamped = clampFloatingSize(width, height)
  const sizes = readAll()
  sizes[appId] = clamped
  writeAll(sizes)
}

export function persistWindowSize(window: WindowState) {
  const { width, height } = getPersistableWindowSize(window)
  saveWindowSize(window.appId, width, height)
}

export function resolveWindowDimensions(
  appId: AppId,
  defaults: SavedWindowSize,
): SavedWindowSize {
  const saved = loadSavedWindowSize(appId)
  if (!saved) {
    return clampFloatingSize(defaults.width, defaults.height)
  }
  // 如果持久化的尺寸接近绝对最小值（很可能是之前因为缺少默认尺寸导致的“迷你窗口”），
  // 则忽略旧存档，直接采用本次传入的建议尺寸。这样新增内置应用后，已有小窗口的用户下次打开能自动恢复合理大小。
  // 真正的用户缩小操作一般不会正好卡在 300x200 这个阈值附近。
  const isLikelyBogusFloor = saved.width <= 300 && saved.height <= 200
  if (isLikelyBogusFloor) {
    return clampFloatingSize(defaults.width, defaults.height)
  }
  return saved
}
