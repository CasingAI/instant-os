/** 麦克风采集 PCM 并封装为 WAV（供 MiMo ASR 使用） */

export type MicWavRecorder = {
  stop: () => Promise<{
    base64: string
    mimeType: 'audio/wav'
    durationMs: number
    byteLength: number
  }>
  abort: () => void
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
  const blockAlign = bytesPerSample
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
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
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

export async function startMicWavRecorder(): Promise<MicWavRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  })

  const audioContext = new AudioContext()
  if (audioContext.state === 'suspended') {
    await audioContext.resume()
  }
  const sampleRate = audioContext.sampleRate
  const source = audioContext.createMediaStreamSource(stream)
  const processor = audioContext.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  let stopped = false
  const startedAt = performance.now()

  processor.onaudioprocess = (event) => {
    if (stopped) return
    const input = event.inputBuffer.getChannelData(0)
    chunks.push(new Float32Array(input))
  }

  source.connect(processor)
  const mute = audioContext.createGain()
  mute.gain.value = 0
  processor.connect(mute)
  mute.connect(audioContext.destination)

  const cleanup = () => {
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

  return {
    abort: () => {
      cleanup()
    },
    stop: async () => {
      if (stopped) {
        throw new Error('录音已结束')
      }
      const durationMs = Math.max(0, Math.round(performance.now() - startedAt))
      cleanup()

      let total = 0
      for (const chunk of chunks) total += chunk.length
      if (total === 0) {
        throw new Error('未录到音频，请重试')
      }

      const merged = new Float32Array(total)
      let offset = 0
      for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.length
      }

      const pcm = floatTo16BitPCM(merged)
      const wav = encodeWav(pcm, sampleRate)

      return {
        base64: arrayBufferToBase64(wav),
        mimeType: 'audio/wav',
        durationMs,
        byteLength: wav.byteLength,
      }
    },
  }
}
