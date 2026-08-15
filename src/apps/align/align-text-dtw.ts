/**
 * 识别文本 ↔ 歌词字级对齐（编辑距离 + 发音匹配）。
 *
 * Zipformer-CTC 引擎输出"识别出的 token 段 + 时间戳"，把 token 解码文本按
 * tokenizeLyricsLine 展开成字级单元后，与歌词单元序列做编辑距离对齐
 * （发音匹配 0 / 替换 3 / 插入·删除 1），回溯为每个歌词单元找到识别的
 * 时间戳；未匹配的单元返回 NaN（调用方用 interpolateUnits 插值兜底）。
 *
 * 匹配不是「字符串相等」：两个单元「听起来像同一个词」才算对上
 * （汉字同音、英文识别口误、跨文种识别打出拼音），对不上的单元代价
 * 高于跳过，DTW 宁可留空也不硬连——避免 JUST/SAY 这种英文被塞给
 * 「来/爱」当锚点。
 *
 * 纯函数，可 node --experimental-strip-types 单测。
 */

import { tokenizeLyricsLine } from './align-g2p.ts'
import { hanziToPinyin, isHanzi } from './pinyin-g2p.ts'
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

/**
 * 匹配用归一化：小写 + 去撇号/连字符（含弯引号）。中文/假名逐字不受影响。
 * 例："Don't" → "dont"、"I'm" → "im"、"The" → "the"，让英文缩写/大小写不再产生替换代价。
 */
export function normalizeForMatch(text: string): string {
  return text.replace(/[''’-]/g, '').toLowerCase()
}

/** 单个单元在匹配时用的指纹：归一化文本 + 类别 + 无调拼音（汉字） */
type MatchKey = {
  norm: string
  kind: 'han' | 'lat' | 'other'
  py: string
}

const matchKeyCache = new Map<string, MatchKey>()

function matchKeyOf(text: string): MatchKey {
  const cached = matchKeyCache.get(text)
  if (cached) return cached
  const norm = normalizeForMatch(text)
  let kind: MatchKey['kind'] = 'other'
  let py = ''
  if (isHanzi(text)) {
    kind = 'han'
    py = hanziToPinyin(text)
  } else if (/^[a-z0-9]+$/u.test(norm)) {
    kind = 'lat'
  }
  const key = { norm, kind, py }
  matchKeyCache.set(text, key)
  return key
}

/** 英文识别口误：较短方是较长方前缀（≥3 字母、差 ≤3），或删掉长的一个字母就得到短方 */
function latinSimilar(x: string, y: string): boolean {
  if (x === y) return true
  const short = x.length <= y.length ? x : y
  const long = x.length <= y.length ? y : x
  if (short.length >= 3 && long.startsWith(short) && long.length - short.length <= 3) return true
  if (long.length - short.length === 1) {
    for (let i = 0; i < long.length; i++) {
      if (long.slice(0, i) + long.slice(i + 1) === short) return true
    }
  }
  return false
}

/**
 * 「听起来像同一个词」：归一化相同 / 汉字同音 / 英文识别口误 /
 * 跨文种识别打出该字拼音（lai↔来、ai↔爱）。
 * 编辑距离代价与锚点判定共用，保证正式 LRC、追踪图、诊断同一套口径。
 */
export function phoneticMatch(a: string, b: string): boolean {
  const ka = matchKeyOf(a)
  const kb = matchKeyOf(b)
  if (ka.norm !== '' && ka.norm === kb.norm) return true
  if (ka.kind === 'han' && kb.kind === 'han') return ka.py !== '' && ka.py === kb.py
  if (ka.kind === 'lat' && kb.kind === 'lat') return latinSimilar(ka.norm, kb.norm)
  if (ka.kind === 'han' && kb.kind === 'lat') return ka.py !== '' && ka.py === kb.norm
  if (ka.kind === 'lat' && kb.kind === 'han') return kb.py !== '' && kb.py === ka.norm
  return false
}

/** 替换代价：发音匹配 0；否则 3（严格高于跳过 1）→ 不匹配的「硬连」在代价上必败于跳过 */
const SUBSTITUTE_COST = 3

/** 锚点时间窗（秒）：识别段起点落在行区间前后该范围内，发音相同才当真锚点。
 * 窗口 ±5s 是供对齐上下文用的；锚点必须贴近本行时间，否则邻行混入的
 * 同音字/词（如上一句的「爱」）会抢走本行的匹配。 */
export const LINE_MATCH_PAD_SEC = 0.5

/**
 * 匹配代价：听起来像同一个词且时间贴近本行 0；否则 3（高于跳过 1）。
 * lineRange 缺省时（全局对齐）不做时间约束。
 */
function matchCost(hypUnit: HypUnit, refUnit: G2pUnit, lineRange?: LineRange): number {
  if (!phoneticMatch(hypUnit.text, refUnit.text)) return SUBSTITUTE_COST
  if (lineRange !== undefined) {
    const t = hypUnit.start
    if (t < lineRange.startSec - LINE_MATCH_PAD_SEC || t > lineRange.endSec + LINE_MATCH_PAD_SEC) {
      return SUBSTITUTE_COST
    }
  }
  return 0
}

/** 行时间范围（秒）：供锚点做时间约束 */
export type LineRange = {
  startSec: number
  endSec: number
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

/** 编辑距离 DP + 回溯：返回每个歌词单元匹配到的识别单元下标（-1=未匹配）。 */
function alignTextDp(
  hyp: HypUnit[],
  refUnits: G2pUnit[],
  lineRange?: LineRange,
): Int32Array {
  const m = refUnits.length
  const n = hyp.length
  if (n === 0) return new Int32Array(m).fill(-1)

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
      const diag =
        cost[idx(i - 1, j - 1)] + matchCost(hyp[i - 1], refUnits[j - 1], lineRange)
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
  return refToHyp
}

/**
 * 把歌词单元序列对齐到识别单元序列，为每个歌词单元赋时间戳。
 * 返回数组长度 = refUnits.length；未匹配单元 start/end 为 NaN。
 * lineRange 提供时，只有时间贴近本行的发音匹配才算锚点。
 */
export function alignTextToUnits(
  segments: HypSegment[],
  refUnits: G2pUnit[],
  lineRange?: LineRange,
): { start: number; end: number }[] {
  const result = refUnits.map(() => ({ start: Number.NaN, end: Number.NaN }))
  if (refUnits.length === 0 || segments.length === 0) return result

  const hyp = expandHypSegments(segments)
  if (hyp.length === 0) return result

  const refToHyp = alignTextDp(hyp, refUnits, lineRange)
  for (let j = 0; j < refUnits.length; j++) {
    const h = refToHyp[j]
    if (h >= 0) {
      result[j].start = hyp[h].start
      result[j].end = hyp[h].end
    }
  }
  return result
}

/** 编辑距离回溯关系（供对齐追踪可视化使用）。 */
export type DtwBacktrace = {
  /** 每个歌词单元匹配到的展开识别单元下标（-1=未匹配） */
  refToHyp: Int32Array
  /** 展开后的识别单元总数（可据此推出被跳过的识别单元） */
  hypCount: number
}

/**
 * 编辑距离回溯：与 alignTextToUnits 同一次对齐，但额外给出「歌词单元 ↔
 * 识别单元」的双侧匹配关系，让调用方能标出被跳过的识别块（未匹配到任何词）。
 * lineRange 提供时，只有时间贴近本行的发音匹配才算锚点。
 * 纯函数，不改动 alignTextToUnits 的对外行为。
 */
export function alignTextBacktrace(
  segments: HypSegment[],
  refUnits: G2pUnit[],
  lineRange?: LineRange,
): DtwBacktrace {
  if (refUnits.length === 0 || segments.length === 0) {
    return { refToHyp: new Int32Array(refUnits.length).fill(-1), hypCount: 0 }
  }
  const hyp = expandHypSegments(segments)
  if (hyp.length === 0) {
    return { refToHyp: new Int32Array(refUnits.length).fill(-1), hypCount: 0 }
  }
  return { refToHyp: alignTextDp(hyp, refUnits, lineRange), hypCount: hyp.length }
}

/**
 * 位置锚点：没对上歌词内容的识别块（如乱码 �），按其在相邻真锚点之间的
 * 位置配给未匹配歌词字，钉其识别时间。内容没对上 → failed 恒 true（标红），
 * 与「钉时间」是两件事：位置给了证据，但没证据证明它就是那个词。
 */
export type PositionAnchor = {
  unitIndex: number
  start: number
  end: number
  failed: true
  /** 对应展开识别块下标（供追踪可视化连线） */
  hypIndex: number
}

/**
 * 收集位置锚点：对每个未匹配歌词单元，若两侧都有真锚点（行首/行尾的
 * 未匹配块可能是邻行混入，不配），取区间内第一个未匹配识别块按顺序配给。
 * 一个识别块只配一个词；区间内多余的块忽略。
 */
export function collectPositionAnchors(
  refToHyp: Int32Array,
  hyp: HypUnit[],
  refUnits: G2pUnit[],
): PositionAnchor[] {
  const isHypMatched = new Uint8Array(hyp.length)
  for (let u = 0; u < refToHyp.length; u++) {
    const h = refToHyp[u]
    if (h >= 0 && h < hyp.length) isHypMatched[h] = 1
  }
  const unmatchedHyp: number[] = []
  for (let h = 0; h < hyp.length; h++) {
    if (isHypMatched[h] === 0) unmatchedHyp.push(h)
  }

  const anchors: PositionAnchor[] = []
  let cursor = 0
  for (let u = 0; u < refUnits.length; u++) {
    if (refToHyp[u] >= 0) continue
    let prevH = -1
    for (let p = u - 1; p >= 0; p--) {
      if (refToHyp[p] >= 0) {
        prevH = refToHyp[p]
        break
      }
    }
    let nextH = -1
    for (let n = u + 1; n < refUnits.length; n++) {
      if (refToHyp[n] >= 0) {
        nextH = refToHyp[n]
        break
      }
    }
    if (prevH < 0 || nextH < 0) continue
    while (cursor < unmatchedHyp.length && unmatchedHyp[cursor] <= prevH) cursor += 1
    if (cursor >= unmatchedHyp.length) break
    const h = unmatchedHyp[cursor]
    if (h >= nextH) continue
    cursor += 1
    anchors.push({
      unitIndex: u,
      start: hyp[h].start,
      end: hyp[h].end,
      failed: true,
      hypIndex: h,
    })
  }
  return anchors
}
