import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'

/**
 * 歌词偏移（纯函数，可单测）。
 * 按曲目 ID 记录手动微调：offsetMs > 0 歌词延后（向后偏移），< 0 提前，0 同步。
 * 显示歌词时统一用「播放时间 - offsetMs」匹配时间戳，不改动歌词数据本身。
 */

/** 单次步进 0.1 秒 */
export const LYRIC_OFFSET_STEP_MS = 100
/** 偏移范围 ±10 秒 */
export const LYRIC_OFFSET_MIN_MS = -10_000
export const LYRIC_OFFSET_MAX_MS = 10_000

const STORAGE_KEY = DEVICE_STORAGE_KEYS.musicLyricOffsets

function loadOffsets(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const result: Record<string, number> = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        result[id] = value
      }
    }
    return result
  } catch {
    return {}
  }
}

export function clampLyricOffsetMs(ms: number): number {
  if (!Number.isFinite(ms)) {
    return 0
  }
  return Math.min(LYRIC_OFFSET_MAX_MS, Math.max(LYRIC_OFFSET_MIN_MS, Math.round(ms)))
}

export function loadLyricOffsetMs(trackId: string): number {
  return clampLyricOffsetMs(loadOffsets()[trackId] ?? 0)
}

export function saveLyricOffsetMs(trackId: string, ms: number): boolean {
  const offsets = loadOffsets()
  const clamped = clampLyricOffsetMs(ms)
  if (clamped === 0) {
    delete offsets[trackId]
  } else {
    offsets[trackId] = clamped
  }
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(offsets))
}

/** 偏移量 → 展示文案：0 →「已同步」，正 →「延后 0.3s」，负 →「提前 0.3s」。 */
export function formatLyricOffset(ms: number): string {
  const clamped = clampLyricOffsetMs(ms)
  if (clamped === 0) {
    return '已同步'
  }
  const tenths = Math.abs(clamped) / 1000
  const label = Number.isInteger(tenths) ? `${tenths}s` : `${tenths.toFixed(1)}s`
  return clamped > 0 ? `延后 ${label}` : `提前 ${label}`
}
