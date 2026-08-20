/**
 * 长音频重叠切块：语音识别（Zipformer-CTC / wav2vec2）在固定输入窗口上推理，
 * 块边界处缺上下文会漏检/截断。这里为每块附带前后文（overlap），
 * 并标注「保留区」——只保留块内不受边界影响的输出区，按全局时间轴无缝拼接。
 *
 * 纯函数，无 onnxruntime/worker 依赖，可被 node --experimental-strip-types 直接单测。
 */

export type AudioChunk = {
  /** 块输入区间起点（全局样本下标） */
  startSample: number
  /** 输入（含 overlap 前后文） */
  data: Float32Array
  /** 保留区起点（全局样本下标，与 hop 对齐） */
  outStartSample: number
  /** 保留区终点（全局样本下标） */
  outEndSample: number
}

/**
 * 重叠切块：
 *  - hop = maxSamples - overlapSamples，保留区 [i*hop, min((i+1)*hop, len))；
 *  - 输入 [max(0, i*hop - overlap), max(0, i*hop - overlap) + maxSamples)，含前文；
 *  - 保留区无缝覆盖 [0, len)：无空洞、无重叠；首块 startSample=0，末块 outEnd=len。
 */
export function sliceAudioOverlapped(
  audio: Float32Array,
  maxSamples: number,
  overlapSamples: number,
): AudioChunk[] {
  if (maxSamples <= 0 || overlapSamples < 0 || overlapSamples >= maxSamples) {
    throw new Error('sliceAudioOverlapped: 需 maxSamples > overlapSamples >= 0')
  }
  const len = audio.length
  if (len <= maxSamples) {
    return [{ startSample: 0, data: audio, outStartSample: 0, outEndSample: len }]
  }

  const hop = maxSamples - overlapSamples
  const chunks: AudioChunk[] = []
  let i = 0
  while (i * hop < len) {
    const outStart = i * hop
    const outEnd = Math.min((i + 1) * hop, len)
    const inStart = Math.max(0, outStart - overlapSamples)
    const inEnd = Math.min(len, inStart + maxSamples)
    chunks.push({
      startSample: inStart,
      data: audio.slice(inStart, inEnd),
      outStartSample: outStart,
      outEndSample: outEnd,
    })
    i++
  }
  return chunks
}
