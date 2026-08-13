/** 音素识别（Phoneme Recognition）—— 用于歌词强制对齐。 */

/** 合并连续相同音素后的时间段 */
export type AlignedPhone = {
  symbol: string
  start: number
  end: number
}

/** 模型输入参数 */
export const PHONEME_TARGET_SAMPLE_RATE = 16000
export const PHONEME_CHANNELS = 2

/**
 * 将 interleaved stereo PCM 重采样到 16kHz mono。
 * 模型期望 16kHz 单声道，零均值单位方差归一化。
 */
export function resampleToMono16k(
  audio: Float32Array,
  fromRate: number,
): Float32Array {
  const fromFrames = Math.floor(audio.length / PHONEME_CHANNELS)
  const toFrames = Math.round((fromFrames * PHONEME_TARGET_SAMPLE_RATE) / fromRate)
  const out = new Float32Array(toFrames)

  const ratio = fromFrames / toFrames
  for (let i = 0; i < toFrames; i++) {
    const srcPos = i * ratio
    const srcIndex = Math.floor(srcPos)
    const frac = srcPos - srcIndex
    const nextIndex = Math.min(fromFrames - 1, srcIndex + 1)

    // 立体声转单声道：取左右声道平均值
    const leftA = audio[srcIndex * PHONEME_CHANNELS]
    const rightA = audio[srcIndex * PHONEME_CHANNELS + 1]
    const leftB = audio[nextIndex * PHONEME_CHANNELS]
    const rightB = audio[nextIndex * PHONEME_CHANNELS + 1]

    const a = (leftA + rightA) * 0.5
    const b = (leftB + rightB) * 0.5
    out[i] = a + (b - a) * frac
  }
  return out
}