import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import { getEffectiveSystemVolume, subscribeSystemVolume } from '../../os/system-volume.ts'
import { isSystemVolumeBusActive } from '../../os/audio-bus.ts'
import { readFileBlob } from '../files/files-vfs.ts'
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
const VOLUME_STORAGE_KEY = DEVICE_STORAGE_KEYS.musicVolume

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return DEFAULT_VOLUME
  }
  return Math.min(1, Math.max(0, volume))
}

/** 从设备存储读取上次音量；无效或不可用时回退默认值。 */
function loadPersistedVolume(): number {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_VOLUME
    }
    const raw = localStorage.getItem(VOLUME_STORAGE_KEY)
    if (raw === null || raw === undefined || raw === '') {
      return DEFAULT_VOLUME
    }
    return clampVolume(JSON.parse(raw) as number)
  } catch {
    return DEFAULT_VOLUME
  }
}

function persistVolume(volume: number): void {
  writeLocalStorageItem(VOLUME_STORAGE_KEY, JSON.stringify(clampVolume(volume)))
}

let state: MusicPlayerState = {
  current: null,
  queue: [],
  index: -1,
  isPlaying: false,
  loading: false,
  currentTime: 0,
  duration: 0,
  volume: loadPersistedVolume(),
  sourceKind: 'library',
  error: null,
}

let audio: HTMLAudioElement | undefined
let currentObjectUrl: string | undefined
const listeners = new Set<() => void>()

// 可视化用 Web Audio 图：audio → analyser → destination（惰性单例，失败静默回退）
let audioContext: AudioContext | undefined
let analyserNode: AnalyserNode | undefined
/** analyser 图是否建立成功：决定主音量由总线承担还是由 el.volume 承担 */
let graphActive = false

function connectAudioGraph(el: HTMLAudioElement): void {
  if (analyserNode) {
    return
  }
  try {
    const Ctx =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) {
      return
    }
    const ctx = new Ctx()
    const source = ctx.createMediaElementSource(el)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.8
    source.connect(analyser)
    analyser.connect(ctx.destination)
    audioContext = ctx
    analyserNode = analyser
    graphActive = true
  } catch {
    // createMediaElementSource 失败（不支持/已占用）时可视化回退为静止基线
    analyserNode = undefined
    graphActive = false
  }
}

function resumeAudioContext(): void {
  if (audioContext && audioContext.state === 'suspended') {
    void audioContext.resume().catch(() => undefined)
  }
}

function updateState(patch: Partial<MusicPlayerState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) {
    listener()
  }
}

/** 分轨音量 × 系统主音量；analyser 图 + 总线激活时主音量由 masterGain 承担。 */
function applyVolumeToAudio(): void {
  if (!audio) {
    return
  }
  audio.volume =
    graphActive && isSystemVolumeBusActive() ? state.volume : state.volume * getEffectiveSystemVolume()
}

// 系统主音量变化（菜单栏/设置页）时，正在播放的音乐立即跟随
subscribeSystemVolume(() => applyVolumeToAudio())

function getAudio(): HTMLAudioElement | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }
  if (!audio) {
    const el = new Audio()
    el.preload = 'auto'
    connectAudioGraph(el)
    el.volume =
      graphActive && isSystemVolumeBusActive()
        ? state.volume
        : state.volume * getEffectiveSystemVolume()
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

/** 曲目音频体：优先从 VFS 引用读取，其次回退到数据空间（旧导入数据）。 */
async function resolveTrackBlob(track: MusicTrack): Promise<Blob | undefined> {
  if (track.vfsRef) {
    try {
      return (await readFileBlob(track.vfsRef)).blob
    } catch {
      return undefined
    }
  }
  return getMusicTrackBlob(track.id)
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
    const resolved = blob ?? (await resolveTrackBlob(target))
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
    resumeAudioContext()
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

/** 播放「文件」App 打开的单曲音频（blob 可缺省，缺省时按 vfsRef 读取）。 */
export function playDocument(track: MusicTrack, blob?: Blob): void {
  updateState({ queue: [track], index: 0, current: track, sourceKind: 'document' })
  void loadAndPlay(blob)
}

export function togglePlay(): void {
  const el = getAudio()
  if (!el || !state.current) {
    return
  }
  if (el.paused) {
    resumeAudioContext()
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
  const v = clampVolume(volume)
  if (audio) {
    audio.volume =
      graphActive && isSystemVolumeBusActive() ? v : v * getEffectiveSystemVolume()
  }
  updateState({ volume: v })
  persistVolume(v)
}

/** 可视化用分析器（不可用时返回 undefined，调用方回退为静止基线）。 */
export function getMusicAnalyser(): AnalyserNode | undefined {
  return analyserNode
}

/** rAF 高分辨率播放进度（毫秒）：优先读 audio 元素，未就绪回退 state。 */
export function getMusicCurrentTimeMs(): number {
  if (audio && Number.isFinite(audio.currentTime)) {
    return audio.currentTime * 1000
  }
  return state.currentTime * 1000
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
