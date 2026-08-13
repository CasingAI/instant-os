/**
 * 识别文本 ↔ 歌词字级对齐（编辑距离）。
 *
 * Zipformer-CTC 引擎输出"识别出的 token 段 + 时间戳"，把 token 解码文本按
 * tokenizeLyricsLine 展开成字级单元后，与歌词单元序列做编辑距离对齐
 * （匹配 0 / 替换 1 / 插入·删除 1），回溯为每个歌词单元找到识别的
 * 时间戳；未匹配的单元返回 NaN（调用方用 interpolateUnits 插值兜底）。
 *
 * 纯函数，可 node --experimental-strip-types 单测。
 */

import { tokenizeLyricsLine } from './align-g2p.ts'
import type { G2pUnit } from './align-types.ts'

/** 识别输出的一个 token 段（symbol 已解码为可读文本） */
export type HypSegment = {
  symbol: string
  start: number
  end: number
}

/** 展开后的字级识别单元 */
export type HypUnit = {
  text: string
  start: number
  end: number
}

/** 匹配代价：字/词完全一致 0，否则 1 */
function matchCost(a: string, b: string): number {
  return a === b ? 0 : 1
}

/**
 * 把 token 段展开成字级单元：每段的符号按分词拆开，各字均分该段时间。
 * 段内空格被分词跳过。
 */
export function expandHypSegments(segments: HypSegment[]): HypUnit[] {
  const out: HypUnit[] = []
  for (const seg of segments) {
    const units = tokenizeLyricsLine(seg.symbol)
    if (units.length === 0) continue
    const dur = (seg.end - seg.start) / units.length
    units.forEach((text, i) => {
      out.push({
        text,
        start: seg.start + i * dur,
        end: seg.start + (i + 1) * dur,
      })
    })
  }
  return out
}

/**
 * 把歌词单元序列对齐到识别单元序列，为每个歌词单元赋时间戳。
 * 返回数组长度 = refUnits.length；未匹配单元 start/end 为 NaN。
 */
export function alignTextToUnits(
  segments: HypSegment[],
  refUnits: G2pUnit[],
): { start: number; end: number }[] {
  const result = refUnits.map(() => ({ start: Number.NaN, end: Number.NaN }))
  if (refUnits.length === 0 || segments.length === 0) return result

  const hyp = expandHypSegments(segments)
  const m = refUnits.length
  const n = hyp.length
  if (n === 0) return result

  const INF = 1e12
  const cost = new Float64Array((n + 1) * (m + 1))
  const ptr = new Uint8Array((n + 1) * (m + 1))
  const idx = (i: number, j: number) => i * (m + 1) + j

  cost.fill(INF)
  cost[idx(0, 0)] = 0
  for (let i = 1; i <= n; i++) {
    cost[idx(i, 0)] = cost[idx(i - 1, 0)] + 1
    ptr[idx(i, 0)] = 1 // 跳过识别单元
  }
  for (let j = 1; j <= m; j++) {
    cost[idx(0, j)] = cost[idx(0, j - 1)] + 1
    ptr[idx(0, j)] = 2 // 跳过歌词单元
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = cost[idx(i - 1, j - 1)] + matchCost(hyp[i - 1].text, refUnits[j - 1].text)
      const skipHyp = cost[idx(i - 1, j)] + 1
      const skipRef = cost[idx(i, j - 1)] + 1
      let best = diag
      let bp = 0
      if (skipHyp < best) {
        best = skipHyp
        bp = 1
      }
      if (skipRef < best) {
        best = skipRef
        bp = 2
      }
      cost[idx(i, j)] = best
      ptr[idx(i, j)] = bp
    }
  }

  // 回溯：记录每个歌词单元匹配到的识别单元下标（-1=未匹配）
  const refToHyp = new Int32Array(m)
  refToHyp.fill(-1)
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const p = ptr[idx(i, j)] as 0 | 1 | 2
    if (p === 0) {
      refToHyp[j - 1] = i - 1
      i -= 1
      j -= 1
    } else if (p === 1) {
      i -= 1
    } else {
      j -= 1
    }
  }

  for (let j = 0; j < m; j++) {
    const h = refToHyp[j]
    if (h >= 0) {
      result[j].start = hyp[h].start
      result[j].end = hyp[h].end
    }
  }
  return result
}
