/** 连续拾音 + 简易能量 VAD：开口说话自动截取一句，静音后交付 WAV */

export type VadUtterance = {
  base64: string
  mimeType: 'audio/wav'
  durationMs: number
  byteLength: number
  /** 句内帧 RMS 峰值（敲击等高尖峰会偏高） */
  peakRms?: number
  /** 句内帧 RMS 均值 */
  meanRms?: number
  /** peak / mean，瞬态冲击通常明显大于平稳人声 */
  crestFactor?: number
  /** 超过拾音阈值的累计有声时长（毫秒） */
  activeSpeechMs?: number
}

export type VadListenState = 'idle' | 'speech'

export type VadSession = {
  /** 处理完一句后重新打开拾音（截取后会自动暂停，避免连发） */
  resumeListening: () => void
  /** 临时暂停拾音（不关麦） */
  pauseListening: () => void
  /**
   * 调整拾音灵敏度。
   * barge-in：播报中防串音，阈值更高，避免喇叭声误触发。
   */
  setPickMode: (mode: 'normal' | 'barge-in') => void
  stop: () => void
}

export type StartVadSessionOptions = {
  onUtterance: (wav: VadUtterance) => void
  /**
   * 说话过程中周期性提交「目前已录到的音频」快照，便于提前 ASR。
   * 句末仍会再走一次 onUtterance 做终识别。
   */
  onPartial?: (wav: VadUtterance) => void
  onLevel?: (rms: number) => void
  onListenState?: (state: VadListenState) => void
  /** 判定为有声的 RMS 阈值，默认约环境噪音之上 */
  speechRms?: number
  /** 句末静音多久后截断（毫秒） */
  silenceMs?: number
  /** 最短有效语句（毫秒），过短丢弃 */
  minSpeechMs?: number
  /** 单句最长（毫秒），超时强制截断 */
  maxSpeechMs?: number
  /** 首次预识别最早时机（毫秒），默认 1.8s */
  firstPartialAfterMs?: number
  /** 预识别间隔（毫秒），默认 2.5s */
  partialIntervalMs?: number
}

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i]))
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  return output
}

function encodeWav(samples: Int16Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2
  const dataSize = samples.length * bytesPerSample
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
  view.setUint32(28, sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(offset, samples[i], true)
    offset += 2
  }

  return buffer
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function frameRms(input: Float32Array): number {
  let sum = 0
  for (let i = 0; i < input.length; i++) {
    const sample = input[i]
    sum += sample * sample
  }
  return Math.sqrt(sum / Math.max(1, input.length))
}

function mergeFloatChunks(chunks: readonly Float32Array[]): Float32Array {
  let total = 0
  for (const chunk of chunks) total += chunk.length
  const merged = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

function analyzeSpeechEnergy(
  chunks: readonly Float32Array[],
  loudRms: number,
  sampleRate: number,
): Pick<VadUtterance, 'peakRms' | 'meanRms' | 'crestFactor' | 'activeSpeechMs'> {
  if (chunks.length === 0) {
    return {
      peakRms: 0,
      meanRms: 0,
      crestFactor: 0,
      activeSpeechMs: 0,
    }
  }

  let peakRms = 0
  let sumRms = 0
  let loudSamples = 0
  for (const chunk of chunks) {
    const rms = frameRms(chunk)
    if (rms > peakRms) peakRms = rms
    sumRms += rms
    if (rms >= loudRms) {
      loudSamples += chunk.length
    }
  }

  const meanRms = sumRms / chunks.length
  const crestFactor = meanRms > 1e-8 ? peakRms / meanRms : 0
  const activeSpeechMs = Math.round((loudSamples / Math.max(1, sampleRate)) * 1000)
  return { peakRms, meanRms, crestFactor, activeSpeechMs }
}

export async function startVadSession(
  options: StartVadSessionOptions,
): Promise<VadSession> {
  const speechRmsNormal = options.speechRms ?? 0.018
  const speechRmsBargeIn = Math.max(speechRmsNormal * 2.4, 0.045)
  let speechRms = speechRmsNormal
  const silenceMs = options.silenceMs ?? 900
  const minSpeechMs = options.minSpeechMs ?? 450
  const maxSpeechMs = options.maxSpeechMs ?? 20_000
  const firstPartialAfterMs = options.firstPartialAfterMs ?? 1_800
  const partialIntervalMs = options.partialIntervalMs ?? 2_500
  const preRollFrames = 8

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })

  const audioContext = new AudioContext()
  if (audioContext.state === 'suspended') {
    await audioContext.resume()
  }
  const sampleRate = audioContext.sampleRate
  const source = audioContext.createMediaStreamSource(stream)
  const processor = audioContext.createScriptProcessor(4096, 1, 1)

  let stopped = false
  /** 是否接受新语句（截取一句后为 false，resume 后再开） */
  let accepting = true
  let inSpeech = false
  let speechStartedAt = 0
  let lastLoudAt = 0
  let lastPartialAt = 0
  const preRoll: Float32Array[] = []
  let speechChunks: Float32Array[] = []

  const setListenState = (state: VadListenState) => {
    options.onListenState?.(state)
  }

  const encodeChunks = (
    chunks: readonly Float32Array[],
    startedAt: number,
  ): VadUtterance | undefined => {
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt))
    const merged = mergeFloatChunks(chunks)
    if (merged.length === 0) {
      return undefined
    }
    const energy = analyzeSpeechEnergy(chunks, speechRms, sampleRate)
    const pcm = floatTo16BitPCM(merged)
    const wav = encodeWav(pcm, sampleRate)
    return {
      base64: arrayBufferToBase64(wav),
      mimeType: 'audio/wav',
      durationMs,
      byteLength: wav.byteLength,
      ...energy,
    }
  }

  const emitUtterance = (chunks: Float32Array[], startedAt: number) => {
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt))
    if (durationMs < minSpeechMs) {
      return
    }
    const wav = encodeChunks(chunks, startedAt)
    if (!wav) {
      return
    }
    options.onUtterance(wav)
  }

  const maybeEmitPartial = (now: number) => {
    if (!options.onPartial || !inSpeech) {
      return
    }
    const spokenMs = now - speechStartedAt
    if (spokenMs < firstPartialAfterMs) {
      return
    }
    if (lastPartialAt > 0 && now - lastPartialAt < partialIntervalMs) {
      return
    }
    lastPartialAt = now
    // 拷贝当前缓冲，避免异步编码时被后续帧改动
    const snapshot = speechChunks.map((frame) => new Float32Array(frame))
    const wav = encodeChunks(snapshot, speechStartedAt)
    if (!wav || wav.durationMs < firstPartialAfterMs * 0.8) {
      return
    }
    options.onPartial(wav)
  }

  processor.onaudioprocess = (event) => {
    if (stopped) return
    const input = event.inputBuffer.getChannelData(0)
    const copy = new Float32Array(input)
    const rms = frameRms(copy)
    options.onLevel?.(rms)

    if (!accepting) {
      if (inSpeech) {
        inSpeech = false
        speechChunks = []
        lastPartialAt = 0
        setListenState('idle')
      }
      return
    }

    const now = performance.now()
    const isLoud = rms >= speechRms

    if (!inSpeech) {
      preRoll.push(copy)
      if (preRoll.length > preRollFrames) {
        preRoll.shift()
      }
      if (isLoud) {
        inSpeech = true
        speechStartedAt = now
        lastLoudAt = now
        lastPartialAt = 0
        speechChunks = [...preRoll]
        preRoll.length = 0
        setListenState('speech')
      }
      return
    }

    speechChunks.push(copy)
    if (isLoud) {
      lastLoudAt = now
    }

    maybeEmitPartial(now)

    const silenced = now - lastLoudAt >= silenceMs
    const tooLong = now - speechStartedAt >= maxSpeechMs
    if (silenced || tooLong) {
      accepting = false
      inSpeech = false
      const chunks = speechChunks
      speechChunks = []
      lastPartialAt = 0
      setListenState('idle')
      emitUtterance(chunks, speechStartedAt)
    }
  }

  source.connect(processor)
  const mute = audioContext.createGain()
  mute.gain.value = 0
  processor.connect(mute)
  mute.connect(audioContext.destination)

  const cleanup = () => {
    if (stopped) return
    stopped = true
    try {
      processor.disconnect()
    } catch {
      /* ignore */
    }
    try {
      source.disconnect()
    } catch {
      /* ignore */
    }
    for (const track of stream.getTracks()) {
      track.stop()
    }
    void audioContext.close()
  }

  setListenState('idle')

  return {
    resumeListening: () => {
      if (stopped) return
      accepting = true
      inSpeech = false
      speechChunks = []
      preRoll.length = 0
      lastPartialAt = 0
      setListenState('idle')
    },
    pauseListening: () => {
      accepting = false
      inSpeech = false
      speechChunks = []
      lastPartialAt = 0
      setListenState('idle')
    },
    setPickMode: (mode) => {
      speechRms = mode === 'barge-in' ? speechRmsBargeIn : speechRmsNormal
    },
    stop: () => {
      cleanup()
    },
  }
}
