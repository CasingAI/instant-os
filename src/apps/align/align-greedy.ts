/**
 * CTC greedy 解码：逐帧 argmax，非 blank 且不等于前一 token 才输出。
 *
 * 只解码 [startFrame, endFrame)（保留区，丢弃块边界帧）；prev 为前一帧 best token，
 * 跨块透传避免边界处重复输出同一 token。zipformer 与 SenseVoice worker 共用。
 *
 * 纯函数，可 node --experimental-strip-types 单测。
 */

export type CtcDecodedToken = {
  token: number
  /** CTC 输出帧号（块内） */
  frame: number
}

/**
 * @param logits 展平的 logits（时间主序：frame × vocab）
 * @param vocabSize 词表大小（每帧类别数）
 * @param blank blank token id
 * @param startFrame 起始帧（含）
 * @param endFrame 结束帧（不含）
 * @param prev 前一帧 best token（跨块透传，首块传 -1）
 */
export function greedyDecode(
  logits: Float32Array,
  vocabSize: number,
  blank: number,
  startFrame: number,
  endFrame: number,
  prev: number,
): { tokens: CtcDecodedToken[]; lastBest: number } {
  const tokens: CtcDecodedToken[] = []
  for (let t = startFrame; t < endFrame; t++) {
    const base = t * vocabSize
    let best = 0
    let bestV = logits[base]
    for (let v = 1; v < vocabSize; v++) {
      const val = logits[base + v]
      if (val > bestV) {
        bestV = val
        best = v
      }
    }
    if (best !== blank && best !== prev) {
      tokens.push({ token: best, frame: t })
    }
    prev = best
  }
  return { tokens, lastBest: prev }
}
