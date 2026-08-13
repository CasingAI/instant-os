/**
 * CTC 强制对齐：给定 logits（每帧各词表类别的分数）与目标音素序列
 * （每个音素一个候选 vocab id 组，取组内最大分数作发射概率），
 * 用 CTC Viterbi 为每个音素/单元找回时间戳。
 *
 * 相比自由识别（argmax + 事后 DTW），这是"用歌词约束解码"——目标序列来自
 * 歌词的确定性 G2P，路径被约束为只能按歌词顺序前进，得到声学证据支撑的精确边界。
 *
 * 状态扩展：目标 N 个音素 → 2N+1 个状态（blank 与音素交替）：
 *   状态 2k   = blank
 *   状态 2k+1 = 第 k 个音素
 * 转移允许：留在本状态 / 前进 1 / 前进 2（跨 blank），复杂度 O(T·2N)。
 *
 * 纯函数，可 node --experimental-strip-types 单测。
 */

export type CtcTarget = {
  /** 该音素所属的歌词单元（字）下标 */
  unitIndex: number
  /** 候选 vocab id 组（非空） */
  ids: number[]
}

export type CtcSpan = {
  start: number
  end: number
}

export type CtcAlignResult = {
  /** 每个单元的起止（秒）；-1 表示该单元的音素全部未被声学覆盖（对齐后走插值） */
  unitSpans: CtcSpan[]
  /** 每个音素的起止（秒）；start<0 表示未覆盖 */
  phoneSpans: CtcSpan[]
}

const NEG = Number.NEGATIVE_INFINITY

export function ctcViterbiAlign(
  logits: Float32Array,
  numFrames: number,
  numClasses: number,
  targets: CtcTarget[],
  blankId: number,
  frameSec: number,
): CtcAlignResult {
  const n = targets.length
  const unitCount =
    targets.reduce((max, t) => Math.max(max, t.unitIndex), -1) + 1

  const emptyResult: CtcAlignResult = {
    unitSpans: Array.from({ length: unitCount }, () => ({ start: -1, end: -1 })),
    phoneSpans: [],
  }
  if (n === 0 || numFrames <= 0) return emptyResult

  const sCount = 2 * n + 1

  // 滚动 DP：prev = 上一帧各状态累计分数，cur = 当前帧
  let prev = new Float64Array(sCount).fill(NEG)
  let cur = new Float64Array(sCount).fill(NEG)
  // back[s][t]：状态 s 在帧 t 的来源（0=本状态 / 1=状态-1 / 2=状态-2）
  const back = new Uint8Array(sCount * numFrames)

  const groupMax = new Float64Array(n)

  // ---- 帧 0 ----
  prev[0] = logits[blankId]
  if (n >= 1) {
    let m = NEG
    for (const id of targets[0].ids) m = Math.max(m, logits[id])
    prev[1] = m
  }

  // ---- 帧 1..T-1 ----
  for (let t = 1; t < numFrames; t++) {
    const base = t * numClasses
    const blankEm = logits[base + blankId]

    // 本帧每个音素状态的发射分数 = 候选组内最大 logits
    for (let k = 0; k < n; k++) {
      let m = NEG
      for (const id of targets[k].ids) {
        const v = logits[base + id]
        if (v > m) m = v
      }
      groupMax[k] = m
    }

    const row = t
    for (let s = 0; s < sCount; s++) {
      const em = s % 2 === 0 ? blankEm : groupMax[(s - 1) >> 1]
      if (em === NEG) continue
      let best = prev[s]
      let bp = 0
      if (s >= 1 && prev[s - 1] > best) {
        best = prev[s - 1]
        bp = 1
      }
      if (s >= 2 && prev[s - 2] > best) {
        best = prev[s - 2]
        bp = 2
      }
      if (best === NEG) continue
      cur[s] = best + em
      back[s * numFrames + row] = bp
    }

    const tmp = prev
    prev = cur
    cur = tmp
    cur.fill(NEG)
  }

  // ---- 终点：最后一个音素或其后的 blank ----
  let endState = 2 * n
  let bestEnd = prev[endState]
  if (n >= 1 && prev[2 * n - 1] > bestEnd) {
    bestEnd = prev[2 * n - 1]
    endState = 2 * n - 1
  }
  if (bestEnd === NEG) {
    // 目标序列在此 logits 上完全不可达（如组为空/音频过短）→ 全部未覆盖
    return emptyResult
  }

  // ---- 回溯：记录每帧所处状态 ----
  const path = new Int16Array(numFrames)
  let s = endState
  for (let t = numFrames - 1; t >= 0; t--) {
    path[t] = s
    const bp = back[s * numFrames + t]
    if (bp === 1) s -= 1
    else if (bp === 2) s -= 2
  }

  // ---- 每个音素状态的覆盖帧区间 ----
  const firstSeen = new Int32Array(n).fill(-1)
  const lastSeen = new Int32Array(n).fill(-1)
  for (let t = 0; t < numFrames; t++) {
    const st = path[t]
    if (st % 2 === 1) {
      const k = (st - 1) >> 1
      if (firstSeen[k] < 0) firstSeen[k] = t
      lastSeen[k] = t
    }
  }

  const phoneSpans: CtcSpan[] = Array.from({ length: n }, (_, k) =>
    firstSeen[k] >= 0
      ? { start: firstSeen[k] * frameSec, end: (lastSeen[k] + 1) * frameSec }
      : { start: -1, end: -1 },
  )

  // ---- 聚合到单元 ----
  const uFirst = new Int32Array(unitCount).fill(-1)
  const uLast = new Int32Array(unitCount).fill(-1)
  for (let k = 0; k < n; k++) {
    if (firstSeen[k] < 0) continue
    const ui = targets[k].unitIndex
    if (uFirst[ui] < 0) uFirst[ui] = firstSeen[k]
    uLast[ui] = lastSeen[k]
  }
  const unitSpans: CtcSpan[] = Array.from({ length: unitCount }, (_, u) =>
    uFirst[u] >= 0
      ? { start: uFirst[u] * frameSec, end: (uLast[u] + 1) * frameSec }
      : { start: -1, end: -1 },
  )

  return { unitSpans, phoneSpans }
}
