/**
 * DTW 对齐引擎：把 G2P 产出的「歌词单元 → IPA 序列」对齐到观测音素段序列，
 * 为每个单元打上起止时间戳。纯函数，可单测。
 *
 * 算法：把所有单元的音素展平成目标序列 T，与观测序列 O 做标准 DTW
 *（匹配代价 = 符号不等；允许插入/删除）。回溯后按「目标音素归属的单元」
 * 聚合起止时间；未覆盖的单元按前后邻居线性插值兜底。
 */

import type { AlignedPhone, AlignedUnit, G2pUnit } from './align-types.ts'

/** 展平后的目标音素：指向所属单元下标 */
type FlatTarget = {
  phone: string
  unitIndex: number
}

/** DTW 回溯一步：diag=匹配 / left=跳过观测 / up=跳过目标 */
type BackPtr = 0 | 1 | 2

const MATCH = 0 as const
const SKIP_OBS = 1 as const
const SKIP_TGT = 2 as const

/** 匹配代价：相同 0，不同 1 */
function matchCost(a: string, b: string): number {
  return a === b ? 0 : 1
}

/**
 * 把歌词单元序列对齐到观测音素段序列。
 * 空输入返回空数组；观测为空时按 0 起点均匀兜底。
 */
export function alignUnitsToPhones(
  units: G2pUnit[],
  phones: AlignedPhone[],
): AlignedUnit[] {
  if (units.length === 0) return []

  // 展平目标音素；无音素的单元（纯标点）稍后用插值兜底
  const targets: FlatTarget[] = []
  for (let u = 0; u < units.length; u++) {
    for (const phone of units[u].phones) {
      if (phone) targets.push({ phone, unitIndex: u })
    }
  }

  // 过滤 CTC 特殊符号与空符号（观测侧）
  const obs = phones.filter((p) => p.symbol && !isCtcSpecial(p.symbol))

  if (targets.length === 0 || obs.length === 0) {
    return interpolateUnits(units, [], obs)
  }

  const n = obs.length
  const m = targets.length
  // DP：cost[i][j] = 对齐 obs[0..i) 与 targets[0..j) 的最小代价
  // 用 typed array 压内存；回溯单独存
  const INF = 1e12
  const cost = new Float64Array((n + 1) * (m + 1))
  const ptr = new Uint8Array((n + 1) * (m + 1))
  const idx = (i: number, j: number) => i * (m + 1) + j

  cost.fill(INF)
  cost[idx(0, 0)] = 0
  // 跳过观测前缀（静音/噪声）
  for (let i = 1; i <= n; i++) {
    cost[idx(i, 0)] = cost[idx(i - 1, 0)] + 1
    ptr[idx(i, 0)] = SKIP_OBS
  }
  // 跳过目标前缀（歌词比识别多）
  for (let j = 1; j <= m; j++) {
    cost[idx(0, j)] = cost[idx(0, j - 1)] + 1
    ptr[idx(0, j)] = SKIP_TGT
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = cost[idx(i - 1, j - 1)] + matchCost(obs[i - 1].symbol, targets[j - 1].phone)
      const left = cost[idx(i - 1, j)] + 1 // 跳过观测
      const up = cost[idx(i, j - 1)] + 1 // 跳过目标
      let best = diag
      let bestPtr: BackPtr = MATCH
      if (left < best) {
        best = left
        bestPtr = SKIP_OBS
      }
      if (up < best) {
        best = up
        bestPtr = SKIP_TGT
      }
      cost[idx(i, j)] = best
      ptr[idx(i, j)] = bestPtr
    }
  }

  // 回溯：每个目标音素对应到的观测下标（-1 = 未匹配）
  const targetToObs = new Int32Array(m)
  targetToObs.fill(-1)
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const p = ptr[idx(i, j)] as BackPtr
    if (p === MATCH) {
      targetToObs[j - 1] = i - 1
      i -= 1
      j -= 1
    } else if (p === SKIP_OBS) {
      i -= 1
    } else {
      j -= 1
    }
  }

  // 按单元聚合：取该单元所有目标音素命中的观测段起止
  const unitObsRanges: { startObs: number; endObs: number }[] = units.map(() => ({
    startObs: -1,
    endObs: -1,
  }))
  for (let t = 0; t < m; t++) {
    const oi = targetToObs[t]
    if (oi < 0) continue
    const u = targets[t].unitIndex
    const range = unitObsRanges[u]
    if (range.startObs < 0 || oi < range.startObs) range.startObs = oi
    if (range.endObs < 0 || oi > range.endObs) range.endObs = oi
  }

  const known: { unitIndex: number; start: number; end: number }[] = []
  for (let u = 0; u < units.length; u++) {
    const range = unitObsRanges[u]
    if (range.startObs < 0) continue
    known.push({
      unitIndex: u,
      start: obs[range.startObs].start,
      end: obs[range.endObs].end,
    })
  }

  return interpolateUnits(units, known, obs)
}

/** CTC 特殊标记：不参与对齐 */
function isCtcSpecial(symbol: string): boolean {
  return symbol === '<pad>' || symbol === '<s>' || symbol === '</s>' || symbol === '<unk>'
}

/**
 * 把已知时间戳填回单元，未覆盖的按前后邻居线性插值。
 * known 按 unitIndex 升序；obs 用于兜底总时长。
 */
export function interpolateUnits(
  units: G2pUnit[],
  known: { unitIndex: number; start: number; end: number }[],
  obs: AlignedPhone[],
): AlignedUnit[] {
  const result: AlignedUnit[] = units.map((u) => ({
    text: u.text,
    phones: u.phones,
    start: Number.NaN,
    end: Number.NaN,
  }))

  for (const k of known) {
    result[k.unitIndex].start = k.start
    result[k.unitIndex].end = k.end
  }

  const totalEnd = obs.length > 0 ? obs[obs.length - 1].end : Math.max(1, units.length * 0.3)
  const totalStart = obs.length > 0 ? obs[0].start : 0

  // 找前后已知锚点，线性插值
  for (let u = 0; u < result.length; u++) {
    if (Number.isFinite(result[u].start)) continue

    let prevIdx = -1
    for (let p = u - 1; p >= 0; p--) {
      if (Number.isFinite(result[p].start)) {
        prevIdx = p
        break
      }
    }
    let nextIdx = -1
    for (let n = u + 1; n < result.length; n++) {
      if (Number.isFinite(result[n].start)) {
        nextIdx = n
        break
      }
    }

    const leftT = prevIdx >= 0 ? result[prevIdx].end : totalStart
    const rightT = nextIdx >= 0 ? result[nextIdx].start : totalEnd
    const gapUnits = (nextIdx >= 0 ? nextIdx : result.length) - (prevIdx >= 0 ? prevIdx : -1) - 1
    const offsetInGap = u - (prevIdx >= 0 ? prevIdx : -1) - 1
    const span = Math.max(0.05, rightT - leftT)
    const slot = span / Math.max(1, gapUnits)
    result[u].start = leftT + offsetInGap * slot
    result[u].end = result[u].start + slot
  }

  // 保证单调：后单元起点不得早于前单元终点
  for (let u = 1; u < result.length; u++) {
    if (result[u].start < result[u - 1].end) {
      result[u].start = result[u - 1].end
    }
    if (result[u].end <= result[u].start) {
      result[u].end = result[u].start + 0.05
    }
  }

  return result
}
