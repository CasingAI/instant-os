/**
 * CTC 强制对齐（Viterbi）：把一行歌词的 token id 序列对齐到该行时间窗内的
 * CTC 后验（logits），为每个 token 标出起止帧。
 *
 * 标准 CTC 对齐 DP：状态为 2L+1（L = token 数），偶数态 = blank_k，
 * 奇数态 = token_k。允许转移：
 *  - blank_k 自环 / blank_{k-1} → token_k
 *  - token_k 自环 / token_k → blank_k
 *  - token_{k-1} → token_k（仅当相邻 token 不同，否则必须经 blank 过渡）
 *
 * 用 logits 原始值（未 softmax）作 log 概率：softmax 是对每帧的单调归一化，
 * 每帧加相同常数，Viterbi 路径选择不受影响。
 *
 * 纯函数，可 node --experimental-strip-types 单测。
 */

export type CtcAlignResult = {
  /** 是否成功（行窗帧数足以容纳 token 序列） */
  ok: boolean
  /** 每个 token 的起始帧（相对行窗首帧），未激活为 -1 */
  tokenStartFrames: Int32Array
  /** 每个 token 的结束帧（相对行窗首帧），未激活为 -1 */
  tokenEndFrames: Int32Array
}

const NEG_INF = -1e30

/**
 * 对一行歌词做 CTC Viterbi 对齐。
 *
 * @param logits     行窗内 logits（帧主序：总帧 × vocabSize 的 Float32Array，
 *                   从 frameOffset 帧开始是行窗首帧）
 * @param vocabSize  词表大小（每帧类别数）
 * @param blankId    CTC blank 的 token id
 * @param frameOffset 行窗首帧在 logits 中的帧下标
 * @param numFrames  行窗帧数
 * @param tokenIds   该行歌词编码出的 token id 序列
 * @param forceStartFromToken 强制首词从行窗首帧开始（行首对齐）。
 *                   歌词对齐领域假设行时间戳即该行开唱时刻；模型对行首
 *                   后验弱时若允许从 blank 开始，整行词会被推迟到后验强处。
 * @param leadBias   行首偏向（logits 域加值）：forceStartFromToken=false 时的
 *                   温和版奖励，作用于帧 0 的 token0 状态。
 */
export function ctcForcedAlignLine(
  logits: Float32Array,
  vocabSize: number,
  blankId: number,
  frameOffset: number,
  numFrames: number,
  tokenIds: readonly number[],
  forceStartFromToken = false,
  leadBias = 0,
): CtcAlignResult {
  const L = tokenIds.length
  const notOk = {
    ok: false,
    tokenStartFrames: new Int32Array(L).fill(-1),
    tokenEndFrames: new Int32Array(L).fill(-1),
  }
  if (L === 0 || numFrames <= 0) return notOk
  if (numFrames < L) return notOk

  const nStates = 2 * L + 1
  const emit = (t: number, s: number): number => {
    const base = (frameOffset + t) * vocabSize
    if (s % 2 === 0) return logits[base + blankId]
    return logits[base + tokenIds[(s - 1) >> 1]]
  }

  // 滚动 DP + 回溯指针
  const prev = new Float64Array(nStates).fill(NEG_INF)
  const curr = new Float64Array(nStates)
  const bp = new Int32Array(nStates * numFrames) // bp[t * nStates + s] = 前一帧状态

  if (forceStartFromToken) {
    prev.fill(NEG_INF)
    if (L >= 1) prev[1] = emit(0, 1)
  } else {
    prev[0] = emit(0, 0)
    if (L >= 1) prev[1] = emit(0, 1) + leadBias
  }

  for (let t = 1; t < numFrames; t++) {
    curr.fill(NEG_INF)
    for (let s = 0; s < nStates; s++) {
      let best = NEG_INF
      let bestP = -1
      const e = emit(t, s)
      if (s % 2 === 0) {
        const k = s >> 1
        const cands = [s]
        if (k > 0) cands.push(s - 1)
        for (const p of cands) {
          const v = prev[p] + e
          if (v > best) {
            best = v
            bestP = p
          }
        }
      } else {
        const k = (s - 1) >> 1
        const cands = [s, s - 1]
        if (k >= 1 && tokenIds[k] !== tokenIds[k - 1]) cands.push(s - 2)
        for (const p of cands) {
          const v = prev[p] + e
          if (v > best) {
            best = v
            bestP = p
          }
        }
      }
      curr[s] = best
      bp[t * nStates + s] = bestP
    }
    prev.set(curr)
  }

  // 末帧取任意状态（通常 blank 或最后 token）的最大者
  let endState = 0
  for (let s = 1; s < nStates; s++) {
    if (prev[s] > prev[endState]) endState = s
  }
  if (!Number.isFinite(prev[endState])) return notOk

  const path = new Int32Array(numFrames)
  path[numFrames - 1] = endState
  for (let t = numFrames - 1; t > 0; t--) {
    path[t - 1] = bp[t * nStates + path[t]]
    if (path[t - 1] < 0) return notOk
  }

  const tokenStartFrames = new Int32Array(L).fill(-1)
  const tokenEndFrames = new Int32Array(L).fill(-1)
  for (let t = 0; t < numFrames; t++) {
    const s = path[t]
    if (s % 2 === 1) {
      const k = (s - 1) >> 1
      if (tokenStartFrames[k] < 0) tokenStartFrames[k] = t
      tokenEndFrames[k] = t
    }
  }

  return { ok: true, tokenStartFrames, tokenEndFrames }
}
