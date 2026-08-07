import { getMusicTrackBlob } from './music-audio-storage.ts'
import type { MusicTrack } from './music-types.ts'

/**
 * 音乐播放器引擎（模块级单例）。
 * 窗口内播放：整个应用共用一个 HTMLAudioElement，
 * 曲库歌单按顺序上下首，文件打开的单曲（document 源）播完即止。
 */

export type MusicPlayerSource = 'library' | 'document'

export type MusicPlayerState = {
  /** 当前曲目（曲库歌曲 / 文件打开的临时曲目） */
  current: MusicTrack | null
  /** 当前播放队列（document 源为单曲队列） */
  queue: MusicTrack[]
  index: number
  isPlaying: boolean
  /** 正在异步加载音频体 */
  loading: boolean
  currentTime: number
  duration: number
  volume: number
  sourceKind: MusicPlayerSource
  /** 最近一次播放错误（成功后清空） */
  error: string | null
}

const DEFAULT_VOLUME = 0.8

let state: MusicPlayerState = {
  current: null,
  queue: [],
  index: -1,
  isPlaying: false,
  loading: false,
  currentTime: 0,
  duration: 0,
  volume: DEFAULT_VOLUME,
  sourceKind: 'library',
  error: null,
}

let audio: HTMLAudioElement | undefined
let currentObjectUrl: string | undefined
const listeners = new Set<() => void>()

function updateState(patch: Partial<MusicPlayerState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) {
    listener()
  }
}

function getAudio(): HTMLAudioElement | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }
  if (!audio) {
    const el = new Audio()
    el.preload = 'auto'
    el.volume = state.volume
    el.addEventListener('timeupdate', () => {
      updateState({ currentTime: el.currentTime, duration: el.duration || state.duration })
    })
    el.addEventListener('loadedmetadata', () => {
      updateState({ duration: el.duration || 0 })
    })
    el.addEventListener('play', () => updateState({ isPlaying: true }))
    el.addEventListener('pause', () => updateState({ isPlaying: false }))
    el.addEventListener('ended', () => {
      if (state.sourceKind === 'library' && state.queue.length > 0) {
        playFromLibrary(state.queue, (state.index + 1) % state.queue.length)
      } else {
        updateState({ isPlaying: false, currentTime: 0 })
      }
    })
    el.addEventListener('error', () => {
      updateState({ loading: false, isPlaying: false, error: '无法播放该音频文件' })
    })
    audio = el
  }
  return audio
}

function revokeCurrentUrl(): void {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl)
    currentObjectUrl = undefined
  }
}

async function loadAndPlay(blob?: Blob): Promise<void> {
  const el = getAudio()
  const target = state.current
  if (!el || !target) {
    return
  }
  try {
    revokeCurrentUrl()
    updateState({ loading: true, error: null, currentTime: 0, duration: 0 })
    const resolved = blob ?? (await getMusicTrackBlob(target.id))
    // 等待读取期间用户可能已切换曲目，丢弃过期结果
    if (state.current?.id !== target.id) {
      return
    }
    if (!resolved) {
      updateState({ loading: false, error: '找不到音频数据' })
      return
    }
    const url = URL.createObjectURL(resolved)
    currentObjectUrl = url
    el.src = url
    updateState({ loading: false })
    await el.play()
  } catch {
    if (state.current?.id === target.id) {
      updateState({ loading: false, isPlaying: false, error: '无法播放该音频文件' })
    }
  }
}

export function getMusicPlayerState(): MusicPlayerState {
  return state
}

export function subscribeMusicPlayer(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 播放曲库歌单中的指定曲目（index 从 0 开始）。 */
export function playFromLibrary(tracks: MusicTrack[], index: number): void {
  const track = tracks[index]
  if (!track) {
    return
  }
  updateState({ queue: tracks, index, current: track, sourceKind: 'library' })
  void loadAndPlay()
}

/** 播放「文件」App 打开的单曲音频（blob 由外部读取）。 */
export function playDocument(track: MusicTrack, blob: Blob): void {
  updateState({ queue: [track], index: 0, current: track, sourceKind: 'document' })
  void loadAndPlay(blob)
}

export function togglePlay(): void {
  const el = getAudio()
  if (!el || !state.current) {
    return
  }
  if (el.paused) {
    void el.play().catch(() => updateState({ isPlaying: false }))
  } else {
    el.pause()
  }
}

export function playNext(): void {
  if (state.sourceKind !== 'library' || state.queue.length === 0) {
    return
  }
  playFromLibrary(state.queue, (state.index + 1) % state.queue.length)
}

export function playPrevious(): void {
  if (state.sourceKind !== 'library' || state.queue.length === 0) {
    return
  }
  const el = getAudio()
  // 播放超过 3 秒时先回到开头
  if (el && el.currentTime > 3) {
    el.currentTime = 0
    return
  }
  playFromLibrary(state.queue, (state.index - 1 + state.queue.length) % state.queue.length)
}

export function seekTo(seconds: number): void {
  const el = getAudio()
  if (!el || !Number.isFinite(seconds)) {
    return
  }
  el.currentTime = Math.max(0, seconds)
  updateState({ currentTime: el.currentTime })
}

export function setMusicVolume(volume: number): void {
  const v = Math.min(1, Math.max(0, volume))
  if (audio) {
    audio.volume = v
  }
  updateState({ volume: v })
}

/** 窗口关闭时停播并清空（窗口内播放语义）。 */
export function stopMusicPlayback(): void {
  if (audio) {
    audio.pause()
    audio.removeAttribute('src')
  }
  revokeCurrentUrl()
  updateState({
    current: null,
    queue: [],
    index: -1,
    isPlaying: false,
    loading: false,
    currentTime: 0,
    duration: 0,
    error: null,
  })
}
