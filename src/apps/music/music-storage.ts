import { osNowMs } from '../../os/os-clock.ts'
import {
  DEVICE_STORAGE_KEYS,
  getLocalStorageKeyBytes,
  writeLocalStorageItem,
} from '../../os/device-storage.ts'
import type { MusicLibraryStore, MusicTrack } from './music-types.ts'

export const MUSIC_STORE_CHANGED_EVENT = 'instant-os:music-store-changed'

/** 音乐 App 可播放 / 可导入的音频后缀 */
export const MUSIC_AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'flac',
  'm4a',
  'aac',
  'ogg',
  'opus',
  'aiff',
  'aif',
] as const

export function isAudioExtension(extension: string | undefined): boolean {
  return extension !== undefined && (MUSIC_AUDIO_EXTENSIONS as readonly string[]).includes(extension)
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.music

function emptyStore(): MusicLibraryStore {
  return { tracks: [] }
}

function loadStore(): MusicLibraryStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return emptyStore()
    }
    const parsed = JSON.parse(raw) as Partial<MusicLibraryStore>
    return {
      tracks: Array.isArray(parsed.tracks) ? (parsed.tracks as MusicTrack[]) : [],
    }
  } catch {
    return emptyStore()
  }
}

function saveStore(store: MusicLibraryStore): boolean {
  const ok = writeLocalStorageItem(STORAGE_KEY, JSON.stringify(store))
  if (ok && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MUSIC_STORE_CHANGED_EVENT))
  }
  return ok
}

export function readMusicStore(): MusicLibraryStore {
  return loadStore()
}

export function writeMusicStore(store: MusicLibraryStore): boolean {
  return saveStore(store)
}

export function getMusicStorageBytes(): number {
  return getLocalStorageKeyBytes(STORAGE_KEY)
}

export function createMusicTrackId(): string {
  return `music-${osNowMs()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 从文件名解析标题与艺人：去扩展名，若含「 - 」按「艺人 - 标题」拆分。
 * 纯函数，便于单测。
 */
export function parseMusicFileName(
  fileName: string,
): { title: string; artist?: string; extension: string } {
  const dot = fileName.lastIndexOf('.')
  const base = dot > 0 ? fileName.slice(0, dot) : fileName
  const extension = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''

  const trimmed = base.trim()
  // 分隔符：两侧有空格的连字符（A - B），或连续双连字符（A--B）；
  // 避免把「no-extension」这类单连字符文件名误拆
  const parts = trimmed
    .split(/\s+[-–—]\s+|[-–—]{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length >= 2) {
    return { title: parts.slice(1).join(' - '), artist: parts[0], extension }
  }
  return { title: trimmed, extension }
}

export function addTrackToStore(store: MusicLibraryStore, track: MusicTrack): MusicLibraryStore {
  return {
    ...store,
    tracks: [track, ...store.tracks],
  }
}

export function removeTrackFromStore(store: MusicLibraryStore, trackId: string): MusicLibraryStore {
  return {
    ...store,
    tracks: store.tracks.filter((track) => track.id !== trackId),
  }
}

export function findTrackInStore(store: MusicLibraryStore, trackId: string): MusicTrack | undefined {
  return store.tracks.find((track) => track.id === trackId)
}

export function formatTrackDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '--:--'
  }
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}
