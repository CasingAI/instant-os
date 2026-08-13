import {
  loadSystemSoundSettings,
  type SystemSoundPack,
} from './system-sound-settings-storage.ts'
import { getEffectiveSystemVolume } from './system-volume.ts'
import { isSystemVolumeBusActive } from './audio-bus.ts'

/**
 * UI SFX 语义 cue（与 public/assets/sounds/uisfx/{pack}/{cue}.mp3 文件名一致）。
 * 系统侧优先用 feedback / communication / system 类。
 */
export type SystemSoundCue =
  | 'achievement'
  | 'back'
  | 'badge'
  | 'blocked'
  | 'bonus'
  | 'cancel'
  | 'check'
  | 'checkpoint'
  | 'close'
  | 'collapse'
  | 'complete'
  | 'connect'
  | 'connecting'
  | 'copy'
  | 'delete'
  | 'deselect'
  | 'disconnect'
  | 'double-click'
  | 'drag-start'
  | 'drop'
  | 'error'
  | 'expand'
  | 'focus'
  | 'forward'
  | 'hover'
  | 'info'
  | 'invalid-drop'
  | 'level-up'
  | 'loading'
  | 'lock'
  | 'long-press'
  | 'mention'
  | 'notification'
  | 'open'
  | 'paste'
  | 'pause'
  | 'play'
  | 'press'
  | 'processing'
  | 'progress-step'
  | 'queued'
  | 'reaction'
  | 'receive'
  | 'recording'
  | 'redo'
  | 'release'
  | 'reorder'
  | 'retry'
  | 'reward'
  | 'scanning'
  | 'seek'
  | 'select'
  | 'send'
  | 'skip-next'
  | 'skip-previous'
  | 'sleep'
  | 'snap'
  | 'start'
  | 'stop'
  | 'streak'
  | 'streaming'
  | 'success'
  | 'swipe'
  | 'toggle-off'
  | 'toggle-on'
  | 'typing'
  | 'uncheck'
  | 'undo'
  | 'unlock'
  | 'volume-change'
  | 'wake'
  | 'warning'

const SOUNDS_BASE = '/assets/sounds/uisfx'

type PlayOptions = {
  pack?: SystemSoundPack
  volume?: number
  /** 跳过 enabled 检查（例如设置页试听）。 */
  force?: boolean
}

let audioContext: AudioContext | undefined
const bufferCache = new Map<string, Promise<AudioBuffer | null>>()
let unlockBound = false

function getAudioContext(): AudioContext | undefined {
  if (typeof window === 'undefined') return undefined
  if (!audioContext) {
    const Ctx =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return undefined
    audioContext = new Ctx()
  }
  return audioContext
}

async function resumeContext(ctx: AudioContext): Promise<void> {
  if (ctx.state === 'suspended') {
    await ctx.resume()
  }
}

function assetUrl(pack: SystemSoundPack, cue: SystemSoundCue): string {
  return `${SOUNDS_BASE}/${pack}/${cue}.mp3`
}

function loadBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(url)
  if (cached) return cached

  const promise = (async () => {
    try {
      const response = await fetch(url)
      if (!response.ok) return null
      const data = await response.arrayBuffer()
      return await ctx.decodeAudioData(data.slice(0))
    } catch {
      bufferCache.delete(url)
      return null
    }
  })()

  bufferCache.set(url, promise)
  return promise
}

/**
 * 在首次用户手势后调用，解除浏览器自动播放限制。
 * 可重复调用；内部只会绑定一次监听。
 */
export function unlockSystemSounds(): void {
  if (unlockBound || typeof window === 'undefined') return
  unlockBound = true

  const unlock = () => {
    const ctx = getAudioContext()
    if (!ctx) return
    void resumeContext(ctx)
  }

  window.addEventListener('pointerdown', unlock, { once: true, passive: true })
  window.addEventListener('keydown', unlock, { once: true })
}

/** 预加载常用 cue，减少首次播放延迟。 */
export function preloadSystemSounds(
  cues: readonly SystemSoundCue[] = ['notification', 'success', 'error', 'warning', 'info'],
  pack?: SystemSoundPack,
): void {
  const ctx = getAudioContext()
  if (!ctx) return
  const settings = loadSystemSoundSettings()
  const resolvedPack = pack ?? settings.pack
  for (const cue of cues) {
    void loadBuffer(ctx, assetUrl(resolvedPack, cue))
  }
}

export function playSystemSound(cue: SystemSoundCue, options: PlayOptions = {}): void {
  const settings = loadSystemSoundSettings()
  if (!settings.enabled && !options.force) return

  const ctx = getAudioContext()
  if (!ctx) return

  const pack = options.pack ?? settings.pack
  // 音频总线激活时主音量由 masterGain 承担，这里只乘分轨，避免双重缩放
  const volume =
    Math.min(1, Math.max(0, options.volume ?? settings.volume)) *
    (isSystemVolumeBusActive() ? 1 : getEffectiveSystemVolume())
  if (volume <= 0) return

  void (async () => {
    try {
      await resumeContext(ctx)
      const buffer = await loadBuffer(ctx, assetUrl(pack, cue))
      if (!buffer) return

      const source = ctx.createBufferSource()
      const gain = ctx.createGain()
      source.buffer = buffer
      gain.gain.value = volume
      source.connect(gain)
      gain.connect(ctx.destination)
      source.start(0)
    } catch {
      // 忽略播放失败（静音标签页、解码错误等）
    }
  })()
}

type VolumePreviewSession = {
  osc: OscillatorNode
  gain: GainNode
}

let volumePreview: VolumePreviewSession | undefined
/** 递增以作废尚未完成的异步 begin */
let volumePreviewGeneration = 0
/** 最新试听增益（0–约 0.14） */
let volumePreviewTarget = 0

function clampVolume(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** 滑杆 0–1 → 实际试听增益；压低峰值避免破音，主音量由总线或此处承担。 */
function previewGainFromVolume(volume: number): number {
  return clampVolume(volume) * 0.12 * (isSystemVolumeBusActive() ? 1 : getEffectiveSystemVolume())
}

function setPreviewGainNow(gain: AudioParam, volume: number, ctx: AudioContext): void {
  volumePreviewTarget = previewGainFromVolume(volume)
  // 用 setValueAtTime 写当前时刻，避免 cancelScheduledValues 打断音频线程
  gain.setValueAtTime(volumePreviewTarget, ctx.currentTime)
}

function startPreviewOscillator(ctx: AudioContext): void {
  if (volumePreview) {
    volumePreview.gain.gain.setValueAtTime(volumePreviewTarget, ctx.currentTime)
    return
  }
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = 660
  gain.gain.setValueAtTime(volumePreviewTarget, ctx.currentTime)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start()
  volumePreview = { osc, gain }
}

/**
 * 音量滑杆拖动：连续正弦试听音，只改增益。
 * 可重复调用；已在预览中则只更新音量。
 */
export function beginSystemSoundVolumePreview(volume: number): void {
  const ctx = getAudioContext()
  if (!ctx) return

  volumePreviewTarget = previewGainFromVolume(volume)

  if (volumePreview) {
    volumePreview.gain.gain.setValueAtTime(volumePreviewTarget, ctx.currentTime)
    return
  }

  if (ctx.state === 'suspended') {
    const generation = ++volumePreviewGeneration
    void ctx.resume().then(() => {
      if (generation !== volumePreviewGeneration) return
      try {
        startPreviewOscillator(ctx)
      } catch {
        volumePreview = undefined
      }
    })
    return
  }

  try {
    startPreviewOscillator(ctx)
  } catch {
    volumePreview = undefined
  }
}

/** 拖动中更新预览音量（不重新开播）。 */
export function updateSystemSoundVolumePreview(volume: number): void {
  volumePreviewTarget = previewGainFromVolume(volume)
  const ctx = getAudioContext()
  if (!ctx || !volumePreview) return
  setPreviewGainNow(volumePreview.gain.gain, volume, ctx)
}

/** 松手结束预览。可重复调用。 */
export function endSystemSoundVolumePreview(): void {
  volumePreviewGeneration += 1
  const session = volumePreview
  volumePreview = undefined
  if (!session) return

  const ctx = getAudioContext()
  const now = ctx?.currentTime ?? 0
  try {
    // 仅在结束时做一次短淡出，避免硬切爆音
    session.gain.gain.setValueAtTime(session.gain.gain.value, now)
    session.gain.gain.linearRampToValueAtTime(0.0001, now + 0.04)
  } catch {
    try {
      session.gain.gain.value = 0
    } catch {
      // ignore
    }
  }

  window.setTimeout(() => {
    try {
      session.osc.stop()
    } catch {
      // already stopped
    }
    try {
      session.osc.disconnect()
      session.gain.disconnect()
    } catch {
      // ignore
    }
  }, 50)
}

/** 应用内错误通知等。 */
export function playSystemNotificationSound(): void {
  playSystemSound('notification')
}

export function playSystemSuccessSound(): void {
  playSystemSound('success')
}

export function playSystemErrorSound(): void {
  playSystemSound('error')
}

export function playSystemWarningSound(): void {
  playSystemSound('warning')
}

export function playSystemInfoSound(): void {
  playSystemSound('info')
}
