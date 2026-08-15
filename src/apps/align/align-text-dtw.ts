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
 * 容错增强：
 *  - 英文匹配用加权编辑距离（浊清辅音/塞音近音低代价、元音保守），
 *    pot→BOK 这类清浊/塞音混淆也能对上。
 *  - 支持一对多块分裂：一个识别段覆盖连续两个歌词词（where we→WERL
 *    连读融合），按字符比例切分段时间。
 *  - 标点单元不进入匹配序列（DP 只在可发音单元上跑），不被逗号等拖累。
 *  - collectFallbackAnchors：无真锚点行复用行区间内识别段时间（标红）。
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

/** 浊清辅音对：同族替换为低代价（ASR 清浊混淆 / 口音变化，Metaphone 同族归并思想） */
const VOICING_PAIRS: [string, string][] = [
  ['b', 'p'],
  ['d', 't'],
  ['g', 'k'],
  ['z', 's'],
  ['v', 'f'],
  ['m', 'n'],
  ['l', 'r'],
]
const voicingGroup = new Map<string, string>()
for (const [a, b] of VOICING_PAIRS) {
  voicingGroup.set(a, a)
  voicingGroup.set(b, a)
}

/** 塞音近音组：清浊塞音口腔位置互串（pot→BOK 的 t→k、p→b 各 0.5）。
 * 快速演唱中塞音爆破听不清，ASR 常在 b/p/d/t/g/k 间互认。 */
const STOP_LETTERS = new Set(['b', 'p', 'd', 't', 'g', 'k'])

/** 单个字符替换代价：浊清辅音同族 0.5；塞音互串 0.5；元音替换 2（保守，避免 love/live 这类被放走）；其余 1 */
function charSubCost(x: string, y: string): number {
  if (x === y) return 0
  const gx = voicingGroup.get(x)
  if (gx !== undefined && gx === voicingGroup.get(y)) return 0.5
  if (STOP_LETTERS.has(x) && STOP_LETTERS.has(y)) return 0.5
  if (/[aeiou]/.test(x) && /[aeiou]/.test(y)) return 2
  return 1
}

/**
 * 加权编辑距离：替换按 charSubCost，插入/删除 1。
 * 比字符级 Levenshtein 更贴近 ASR 混淆形态：清浊音替换（pot→bok 两处各 0.5）
 * 比随机替换便宜，元音替换被罚（保守）。
 */
export function weightedEditDistance(a: string, b: string): number {
  const n = a.length
  const m = b.length
  if (n === 0) return m
  if (m === 0) return n
  let prev = new Float64Array(m + 1)
  let cur = new Float64Array(m + 1)
  for (let j = 0; j <= m; j++) prev[j] = j
  for (let i = 1; i <= n; i++) {
    cur[0] = i
    for (let j = 1; j <= m; j++) {
      cur[j] = Math.min(
        prev[j - 1] + charSubCost(a[i - 1], b[j - 1]),
        prev[j] + 1,
        cur[j - 1] + 1,
      )
    }
    const tmp = prev
    prev = cur
    cur = tmp
  }
  return prev[m]
}

/**
 * 英文识别口误：加权编辑距离 + 截断词尾前缀规则。
 *  - 归一化相同 → true
 *  - 2 字母词允许 1 处差异（HY↔why）
 *  - 长词以短词为前缀且差 ≤3（talki↔talking 截断词尾）
 *  - 一般词加权距离 ≤ round(minLen × 0.3)
 * pot↔bok 加权距离 1（两处清浊 0.5）→ 命中；love↔live 2（元音替换）→ 拒绝。
 */
function latinPhoneticMatch(x: string, y: string): boolean {
  if (x === y) return true
  const short = x.length <= y.length ? x : y
  const long = x.length <= y.length ? y : x
  if (short.length <= 2) return weightedEditDistance(short, long) <= 1
  if (long.startsWith(short) && long.length - short.length <= 3) return true
  return weightedEditDistance(short, long) <= Math.max(1, Math.round(short.length * 0.3))
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
  if (ka.kind === 'lat' && kb.kind === 'lat') return latinPhoneticMatch(ka.norm, kb.norm)
  if (ka.kind === 'han' && kb.kind === 'lat') return ka.py !== '' && ka.py === kb.norm
  if (ka.kind === 'lat' && kb.kind === 'han') return kb.py !== '' && kb.py === ka.norm
  return false
}

/** 纯标点/空白（识别端几乎不输出这类独立单元，不参与匹配，也不消耗位置锚点）。
 * 只剔标点类（\p{P}）与空白；U+FFFD 乱码等符号（\p{S}）保留——它们是
 * 「内容未知但存在声学证据」的识别块，正是位置锚点要钉给歌词词的目标。 */
function isPunctOrSpace(text: string): boolean {
  return /^[\s\p{P}]*$/u.test(text)
}

/** 歌词侧可发音单元（汉字/拉丁/数字）；标点等符号不参与编辑距离匹配 */
function isPhonableUnit(text: string): boolean {
  return matchKeyOf(text).kind !== 'other'
}

/** 替换代价：发音匹配 0；否则 3（严格高于跳过 1）→ 不匹配的「硬连」在代价上必败于跳过 */
const SUBSTITUTE_COST = 3

/** 锚点时间窗（秒）：识别段起点落在行区间前后该范围内，发音相同才当真锚点。
 * 窗口 ±5s 是供对齐上下文用的；锚点必须贴近本行时间，否则邻行混入的
 * 同音字/词（如上一句的「爱」）会抢走本行的匹配。 */
export const LINE_MATCH_PAD_SEC = 0.5

/** 段分裂成块的最短时长（秒）：识别段必须长得足以覆盖两个词，才可能是连读融合
 * （如 where we → WERL）；短段（单个词的时长）做块分裂会把独立词误吞。 */
export const BLOCK_MIN_DUR_SEC = 0.35

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

/**
 * 块匹配代价：一个识别段覆盖连续两个歌词词（连读融合，如 where we → WERL）。
 * 前提：段时长足够长（≥ BLOCK_MIN_DUR_SEC）、段无法独立匹配块中任一单词
 * （否则单块路径已覆盖，块分裂会误吞第二个词）、段与「两词拼接」的加权距离
 * 在放宽阈值内。命中 0；否则 3。
 */
function blockMatchCost(
  hypUnit: HypUnit,
  a: G2pUnit,
  b: G2pUnit,
  lineRange?: LineRange,
): number {
  if (lineRange !== undefined) {
    const t = hypUnit.start
    if (t < lineRange.startSec - LINE_MATCH_PAD_SEC || t > lineRange.endSec + LINE_MATCH_PAD_SEC) {
      return SUBSTITUTE_COST
    }
  }
  if (hypUnit.end - hypUnit.start < BLOCK_MIN_DUR_SEC) return SUBSTITUTE_COST
  const hypNorm = normalizeForMatch(hypUnit.text)
  const na = normalizeForMatch(a.text)
  const nb = normalizeForMatch(b.text)
  // 块只对拉丁词成立（中文逐字不会压成一段）
  if (!/^[a-z0-9]+$/u.test(na) || !/^[a-z0-9]+$/u.test(nb)) return SUBSTITUTE_COST
  // 段能独立匹配某个单词 → 单块路径足够，不吞第二个词
  if (latinPhoneticMatch(hypNorm, na)) return SUBSTITUTE_COST
  if (latinPhoneticMatch(hypNorm, nb)) return SUBSTITUTE_COST
  const joined = na + nb
  const totalLen = Math.max(joined.length, hypNorm.length)
  const lenDiff = Math.abs(joined.length - hypNorm.length)
  // 连读吞音最多压缩 40% 字符（WERL 4 字 vs wherewe 7 字 → 差 3 在阈值内）
  if (lenDiff > Math.max(2, Math.round(totalLen * 0.4))) return SUBSTITUTE_COST
  // 块匹配距离阈值比单词匹配宽：段是两词的压缩，补字符较多（werl↔wherewe 距离 4）
  return weightedEditDistance(hypNorm, joined) <= Math.ceil(totalLen * 0.55) ? 0 : SUBSTITUTE_COST
}

/** 行时间范围（秒）：供锚点做时间约束 */
export type LineRange = {
  startSec: number
  endSec: number
}

/**
 * 把 token 段展开成字级单元：每段的符号按分词拆开，各字均分该段时间。
 * 段内空格被分词跳过；纯标点单元（识别端几乎不输出的噪音）不进入匹配序列。
 */
export function expandHypSegments(segments: HypSegment[]): HypUnit[] {
  const out: HypUnit[] = []
  for (const seg of segments) {
    const units = tokenizeLyricsLine(seg.symbol)
    const usable = units.filter((u) => !isPunctOrSpace(u))
    if (usable.length === 0) continue
    const dur = (seg.end - seg.start) / usable.length
    usable.forEach((text, i) => {
      out.push({
        text,
        start: seg.start + i * dur,
        end: seg.start + (i + 1) * dur,
      })
    })
  }
  return out
}

/** 编辑距离 DP + 回溯：返回每个歌词单元匹配到的识别单元下标（-1=未匹配）。
 * 标点单元（不可发音）不进入匹配序列，refToHyp 保持 -1，由插值兜底。
 * 支持一个识别段匹配连续两个可发音歌词单元（连读融合，块分裂）。 */
function alignTextDp(
  hyp: HypUnit[],
  refUnits: G2pUnit[],
  lineRange?: LineRange,
): Int32Array {
  // 可发音单元（汉字/拉丁/数字）下标；标点等不参与编辑距离匹配
  const phonable: number[] = []
  for (let j = 0; j < refUnits.length; j++) {
    if (isPhonableUnit(refUnits[j].text)) phonable.push(j)
  }
  const m = phonable.length
  const n = hyp.length
  const refToHyp = new Int32Array(refUnits.length).fill(-1)
  if (n === 0 || m === 0) return refToHyp

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
        cost[idx(i - 1, j - 1)] +
        matchCost(hyp[i - 1], refUnits[phonable[j - 1]], lineRange)
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
      // 一个识别段覆盖连续两个歌词单元（连读融合）：代价 0 则比「跳过其一」更优
      if (j >= 2) {
        const block =
          cost[idx(i - 1, j - 2)] +
          blockMatchCost(
            hyp[i - 1],
            refUnits[phonable[j - 2]],
            refUnits[phonable[j - 1]],
            lineRange,
          )
        if (block < best) {
          best = block
          bp = 3
        }
      }
      cost[idx(i, j)] = best
      ptr[idx(i, j)] = bp
    }
  }

  // 回溯：记录每个歌词单元匹配到的识别单元下标（-1=未匹配）
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const p = ptr[idx(i, j)] as 0 | 1 | 2 | 3
    if (p === 0) {
      refToHyp[phonable[j - 1]] = i - 1
      i -= 1
      j -= 1
    } else if (p === 1) {
      i -= 1
    } else if (p === 2) {
      j -= 1
    } else {
      // 块分裂：两个歌词单元共享同一识别段
      refToHyp[phonable[j - 2]] = i - 1
      refToHyp[phonable[j - 1]] = i - 1
      i -= 1
      j -= 2
    }
  }
  return refToHyp
}

/**
 * 单个歌词单元 → 识别段时间戳。块分裂时（两个连续 ref 共享同一 hyp 段），
 * 按块内字符长度比例切分段时长，避免两个词都拿到整段时间。
 */
export function anchorSpanForUnit(
  j: number,
  refToHyp: Int32Array,
  hyp: HypUnit[],
  refUnits: G2pUnit[],
): { start: number; end: number } | undefined {
  const h = refToHyp[j]
  if (h < 0 || h >= hyp.length) return undefined
  const sharedPrev = j > 0 && refToHyp[j - 1] === h
  const sharedNext = j + 1 < refToHyp.length && refToHyp[j + 1] === h
  if (!sharedPrev && !sharedNext) return { start: hyp[h].start, end: hyp[h].end }
  const startIdx = sharedPrev ? j - 1 : j
  const endIdx = sharedNext ? j + 1 : j
  const lenA = Math.max(1, normalizeForMatch(refUnits[startIdx].text).length)
  const lenB = Math.max(1, normalizeForMatch(refUnits[endIdx].text).length)
  const total = lenA + lenB
  const dur = hyp[h].end - hyp[h].start
  if (sharedPrev) {
    return { start: hyp[h].start + (dur * lenA) / total, end: hyp[h].end }
  }
  return { start: hyp[h].start, end: hyp[h].start + (dur * lenA) / total }
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
    const span = anchorSpanForUnit(j, refToHyp, hyp, refUnits)
    if (span) {
      result[j].start = span.start
      result[j].end = span.end
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
    // 歌词侧标点不消耗识别块（识别端几乎不输出标点，配给它等于浪费）
    if (!isPhonableUnit(refUnits[u].text)) continue
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

/**
 * 无真锚点行的声学证据兜底：把落在行区间内的识别块按顺序配给歌词可发音单元，
 * 钉其识别时间但内容未对上 → 一律标红。避免整行只有行时间戳均摊时，
 * 把识别到的（即使内容对不上）声学时间浪费掉。
 * range 约束识别块起点必须落在行区间内（防止邻行块混入）。
 */
export function collectFallbackAnchors(
  hyp: HypUnit[],
  refUnits: G2pUnit[],
  range?: { startSec: number; endSec: number },
): PositionAnchor[] {
  const anchors: PositionAnchor[] = []
  let u = 0
  for (let h = 0; h < hyp.length && u < refUnits.length; h++) {
    if (range !== undefined && (hyp[h].start < range.startSec || hyp[h].start > range.endSec)) {
      continue
    }
    while (u < refUnits.length && !isPhonableUnit(refUnits[u].text)) u += 1
    if (u >= refUnits.length) break
    anchors.push({
      unitIndex: u,
      start: hyp[h].start,
      end: hyp[h].end,
      failed: true,
      hypIndex: h,
    })
    u += 1
  }
  return anchors
}
