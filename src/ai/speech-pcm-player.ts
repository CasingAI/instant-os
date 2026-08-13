/**
 * 流式 pcm16 LE mono 播放（Web Audio 排队调度）。
 * 系统媒体控件通过 Media Session + AudioContext.suspend/resume 同步。
 */

import { getEffectiveSystemVolume, subscribeSystemVolume } from '../os/system-volume.ts'

export type StreamingPcmPlayerOptions = {
  sampleRate: number
  signal: AbortSignal
  onExternalPause?: () => void
  onExternalPlay?: () => void
}

export type StreamingPcmPlayer = {
  enqueue: (pcm: Uint8Array) => void
  /** 声明上游流已结束；全部排队音频播完后 waitUntilEnded resolve */
  markEnd: () => void
  waitUntilEnded: () => Promise<void>
  stop: () => void
  suspend: () => void
  resume: () => void
}

function int16LeToFloat32(pcm: Uint8Array): Float32Array {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const sampleCount = Math.floor(pcm.byteLength / 2)
  const floats = new Float32Array(sampleCount)
  for (let i = 0; i < sampleCount; i++) {
    floats[i] = view.getInt16(i * 2, true) / 0x8000
  }
  return floats
}

function clearMediaSessionHandlers(): void {
  if (!('mediaSession' in navigator)) {
    return
  }
  try {
    navigator.mediaSession.setActionHandler('play', null)
    navigator.mediaSession.setActionHandler('pause', null)
    navigator.mediaSession.playbackState = 'none'
  } catch {
    // 部分环境不支持清空 handler
  }
}

// 各活跃播放器的主增益节点：TTS 采样率固定必须使用独立 AudioContext，
// 因此通过模块级 Set + 订阅把系统主音量同步到每个 context 内的 gain。
const activeGains = new Set<GainNode>()

let systemVolumeSubscribed = false

function ensureSystemVolumeSync(): void {
  if (systemVolumeSubscribed) {
    return
  }
  systemVolumeSubscribed = true
  subscribeSystemVolume(() => {
    const volume = getEffectiveSystemVolume()
    for (const gain of activeGains) {
      try {
        // 平滑过渡避免爆音
        gain.gain.setTargetAtTime(volume, gain.context.currentTime, 0.01)
      } catch {
        // 节点已断开等情况直接忽略
      }
    }
  })
}

export function createStreamingPcmPlayer(
  options: StreamingPcmPlayerOptions,
): StreamingPcmPlayer {
  const context = new AudioContext({ sampleRate: options.sampleRate })
  const masterGain = context.createGain()
  masterGain.gain.value = getEffectiveSystemVolume()
  masterGain.connect(context.destination)
  const sources = new Set<AudioBufferSourceNode>()
  let nextStartTime = 0
  let pendingSources = 0
  let streamEnded = false
  let stopped = false
  let settled = false
  let ignoreStateChange = false
  let endedResolve: (() => void) | undefined
  let endedReject: ((err: Error) => void) | undefined

  const endedPromise = new Promise<void>((resolve, reject) => {
    endedResolve = resolve
    endedReject = reject
  })

  const settleOk = () => {
    if (settled) {
      return
    }
    settled = true
    clearMediaSessionHandlers()
    activeGains.delete(masterGain)
    endedResolve?.()
  }

  const settleErr = (err: Error) => {
    if (settled) {
      return
    }
    settled = true
    clearMediaSessionHandlers()
    activeGains.delete(masterGain)
    endedReject?.(err)
  }

  const maybeFinish = () => {
    if (stopped || settled) {
      return
    }
    if (streamEnded && pendingSources === 0) {
      settleOk()
      void context.close().catch(() => undefined)
    }
  }

  const stopAllSources = () => {
    for (const source of sources) {
      try {
        source.onended = null
        source.stop()
      } catch {
        // already stopped
      }
    }
    sources.clear()
    pendingSources = 0
  }

  const onAbort = () => {
    if (stopped) {
      return
    }
    stopped = true
    ignoreStateChange = true
    stopAllSources()
    clearMediaSessionHandlers()
    activeGains.delete(masterGain)
    void context.close().catch(() => undefined)
    settleOk()
  }

  ensureSystemVolumeSync()
  activeGains.add(masterGain)

  if (options.signal.aborted) {
    onAbort()
  } else {
    options.signal.addEventListener('abort', onAbort, { once: true })
  }

  const bindMediaSession = () => {
    if (!('mediaSession' in navigator)) {
      return
    }
    try {
      navigator.mediaSession.playbackState = 'playing'
      navigator.mediaSession.setActionHandler('pause', () => {
        if (stopped || settled) {
          return
        }
        ignoreStateChange = true
        void context.suspend().finally(() => {
          ignoreStateChange = false
        })
        options.onExternalPause?.()
        navigator.mediaSession.playbackState = 'paused'
      })
      navigator.mediaSession.setActionHandler('play', () => {
        if (stopped || settled) {
          return
        }
        ignoreStateChange = true
        void context.resume().finally(() => {
          ignoreStateChange = false
        })
        options.onExternalPlay?.()
        navigator.mediaSession.playbackState = 'playing'
      })
    } catch {
      // Media Session 不可用时忽略
    }
  }

  context.onstatechange = () => {
    if (stopped || settled || ignoreStateChange) {
      return
    }
    if (context.state === 'suspended') {
      options.onExternalPause?.()
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused'
      }
    } else if (context.state === 'running') {
      options.onExternalPlay?.()
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing'
      }
    }
  }

  const ensureRunning = () => {
    if (context.state === 'suspended') {
      void context.resume()
    }
  }

  return {
    enqueue(pcm: Uint8Array) {
      if (stopped || settled || options.signal.aborted || pcm.byteLength < 2) {
        return
      }

      const floats = int16LeToFloat32(pcm)
      if (floats.length === 0) {
        return
      }

      ensureRunning()
      bindMediaSession()

      const buffer = context.createBuffer(1, floats.length, options.sampleRate)
      buffer.copyToChannel(new Float32Array(floats), 0)
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(masterGain)

      const startAt = Math.max(nextStartTime, context.currentTime)
      nextStartTime = startAt + buffer.duration
      pendingSources += 1
      sources.add(source)

      source.onended = () => {
        sources.delete(source)
        pendingSources = Math.max(0, pendingSources - 1)
        maybeFinish()
      }

      try {
        source.start(startAt)
      } catch (err) {
        sources.delete(source)
        pendingSources = Math.max(0, pendingSources - 1)
        settleErr(err instanceof Error ? err : new Error(String(err)))
      }
    },

    markEnd() {
      if (stopped || settled) {
        return
      }
      streamEnded = true
      maybeFinish()
    },

    waitUntilEnded() {
      return endedPromise
    },

    stop() {
      onAbort()
    },

    suspend() {
      if (stopped || settled) {
        return
      }
      ignoreStateChange = true
      void context.suspend().finally(() => {
        ignoreStateChange = false
      })
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused'
      }
    },

    resume() {
      if (stopped || settled) {
        return
      }
      ignoreStateChange = true
      void context.resume().finally(() => {
        ignoreStateChange = false
      })
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing'
      }
    },
  }
}

/** 将 pcm16 LE mono 封装为 WAV ArrayBuffer */
export function encodePcm16LeToWav(
  pcm: Uint8Array,
  sampleRate: number,
): ArrayBuffer {
  const dataSize = pcm.byteLength - (pcm.byteLength % 2)
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  new Uint8Array(buffer, 44).set(pcm.subarray(0, dataSize))
  return buffer
}

export function pcm16LeToWavObjectUrl(
  pcm: Uint8Array,
  sampleRate: number,
): string {
  const wav = encodePcm16LeToWav(pcm, sampleRate)
  return URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
}
