/**
 * 确定性 G2P：歌词 → 逐字/词 → 带调拼音 → wav2vec2 vocab 候选符号组。
 *
 * 链路：pinyin-pro（vendor，纯 JS）做汉字→拼音与声/韵母拆分；
 * 用 phoneme-ipa-mapping 的 ipaToPinyin 反向建索引，把每个拼音音节映射回
 * vocab 里的一组等价符号（例如韵母 i 可对应 i / i.5 / i̪5 / iː / ɪ …）。
 * 对齐时取组内最大 logits，天然容忍模型输出的符号形式漂移。
 *
 * 纯逻辑模块，可 node --experimental-strip-types 单测。
 */

import { getFinalParts, getInitialAndFinal, pinyin } from '../../vendor/pinyin-pro/index.mjs'
import { tokenizeLyricsLine } from './align-g2p.ts'
import { ipaToPinyin } from '../stems/phoneme-ipa-mapping.ts'
import type { G2pLine } from './align-types.ts'

/** 一个歌词单元（字/词）对应的音素候选组序列 */
export type PinyinUnit = {
  text: string
  /** 每个音素一组等价 vocab 符号；空数组表示该单元无可映射音素（对齐时走插值） */
  symbolGroups: string[][]
}

export type PinyinLine = {
  text: string
  units: PinyinUnit[]
}

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/u

export function isHanzi(ch: string): boolean {
  return CJK_RE.test(ch)
}

/** LRC 行内时间戳 [mm:ss.xx] / [mm:ss:xx]，或增强逐字 <mm:ss.xx>（可嵌套出现） */
const LRC_TIME_RE = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]|<\d{1,2}:\d{1,2}(?:[.:]\d{1,3})>/g
/** 元数据标签（可后接歌词文本） */
const LRC_META_TAG_RE = /^\[(?:ti|ar|al|by|offset|re|ve|length|au):[^\]]*\]/i

/**
 * 剥离 LRC 标记，返回纯歌词文本。
 * 用户常把现成的 .lrc 文件内容直接粘贴/载入当歌词，其中的行时间戳
 * `[mm:ss.xx]`、增强逐字 `<mm:ss.xx>`、元数据标签 `[ti:…]` 若不清洗，
 * 会被当作歌词字符逐字对齐（生成 `<00:21.28>[<00:21.28>00:…` 这类坏行）。
 * 时间戳可能嵌套（如坏 LRC 的 `[<00:21.28>00:<00:21.28>00.<00:21.28>00]`），
 * 反复剥离直到稳定。清洗后空行丢弃。
 */
export function stripLrcMarkup(lyrics: string): string {
  const out: string[] = []
  for (const rawLine of lyrics.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    let cleaned = line.replace(LRC_META_TAG_RE, '')
    for (let guard = 0; guard < 5; guard += 1) {
      const next = cleaned.replace(LRC_TIME_RE, '')
      if (next === cleaned) break
      cleaned = next
    }
    cleaned = cleaned.trim()
    if (cleaned) out.push(cleaned)
  }
  return out.join('\n')
}

/**
 * 规范化拼音：去组合声调符号，ü 统一转成 yu。
 * 这样 ipaToPinyin 的输出（带调拼音字母）与目标音节可归一到同一键。
 */
export function normalizePinyin(py: string): string {
  let out = py.normalize('NFD')
  // ü（U+00FC）在 NFD 下分解为 u + U+0308
  out = out.replace(/u\u0308/g, 'yu')
  out = out.replace(/[\u0300-\u036f]/g, '')
  return out
}

/** 单个汉字 → 无调拼音（供「识别文本 ↔ 歌词」的发音匹配；非汉字/查不到返回空串） */
export function hanziToPinyin(char: string): string {
  const py = String(pinyin(char, { toneType: 'symbol', type: 'string' }))
  return py && py !== char ? normalizePinyin(py) : ''
}

/**
 * 构建 拼音(规范化) → vocab 符号等价类 索引。
 * 遍历 vocab 符号，经 ipaToPinyin 映射为拼音后归一化入组；
 * 仅收录归一化结果为纯拉丁字母（即真的映射到了拼音）的符号，
 * 未识别而原样返回的 IPA 符号（含非 ASCII 字母）被跳过。
 */
export function buildPinyinReverseIndex(vocabSymbols: string[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const symbol of vocabSymbols) {
    const mapped = ipaToPinyin(symbol)
    if (!mapped) continue
    const norm = normalizePinyin(mapped)
    if (!/^[a-z]+$/u.test(norm)) continue
    const group = index.get(norm)
    if (group) group.push(symbol)
    else index.set(norm, [symbol])
  }
  return index
}

/**
 * 韵母查索引失败时的降级拆分：按 韵头/韵腹/韵尾 组合出可映射的音素组。
 * 优先 (韵头) + (韵腹+韵尾)，其次 (韵头+韵腹) + (韵尾)，最后逐部分独立。
 */
function splitFinalFallback(
  rawFinal: string,
  normFinal: string,
  index: Map<string, string[]>,
): string[][] {
  const { head, body, tail } = getFinalParts(rawFinal)
  const headN = normalizePinyin(head)
  const bodyTailN = normalizePinyin(body + tail)
  const headBodyN = normalizePinyin(head + body)
  const tailN = normalizePinyin(tail)

  const lookup = (key: string): string[] | undefined => {
    if (!key) return undefined
    const group = index.get(key)
    return group && group.length > 0 ? group : undefined
  }

  if (headN && bodyTailN && bodyTailN !== normFinal) {
    const h = lookup(headN)
    const bt = lookup(bodyTailN)
    if (h && bt) return [h, bt]
  }
  if (headBodyN && tailN && headBodyN !== normFinal) {
    const hb = lookup(headBodyN)
    const t = lookup(tailN)
    if (hb && t) return [hb, t]
  }
  const parts: string[][] = []
  for (const part of [head, body, tail]) {
    const group = lookup(normalizePinyin(part))
    if (group) parts.push(group)
  }
  return parts
}

/** 单个带调音节（nǐ / yī / ǚ）→ 候选符号组序列 */
export function syllableToSymbolGroups(
  syllable: string,
  index: Map<string, string[]>,
): string[][] {
  const { initial, final } = getInitialAndFinal(syllable)
  const groups: string[][] = []

  if (initial) {
    const group = index.get(normalizePinyin(initial))
    if (group && group.length > 0) groups.push(group)
  }
  if (final) {
    const norm = normalizePinyin(final)
    const group = index.get(norm)
    if (group && group.length > 0) {
      groups.push(group)
    } else {
      groups.push(...splitFinalFallback(final, norm, index))
    }
  }
  return groups
}

/**
 * 歌词全文 → 按行、逐字的 PinyinLine[]。
 * 多音字消歧：对整行调用 pinyin(type:'array') 拿到带上下文的逐字拼音，
 * 再按 tokenizeLyricsLine 的单元顺序消费；array 长度不匹配时回退逐字调用。
 */
export function lyricsToPinyinLines(
  lyrics: string,
  index: Map<string, string[]>,
): PinyinLine[] {
  return lyrics
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => {
      const chars = Array.from(text)
      const pinyinArr = pinyin(text, {
        toneType: 'symbol',
        type: 'array',
        segment: true,
      }) as unknown as string[]
      const perChar = pinyinArr.length === chars.length ? pinyinArr : undefined

      const units: PinyinUnit[] = []
      let cursor = 0
      for (const unitText of tokenizeLyricsLine(text)) {
        if (unitText.length === 1 && isHanzi(unitText)) {
          const py =
            perChar !== undefined
              ? perChar[cursor]
              : String(pinyin(unitText, { toneType: 'symbol', type: 'string' }))
          const groups =
            py && py !== unitText ? syllableToSymbolGroups(py, index) : []
          units.push({ text: unitText, symbolGroups: groups })
          cursor += 1
        } else if (unitText.length === 1) {
          // 标点/空白：单字符占位
          cursor += 1
          units.push({ text: unitText, symbolGroups: [] })
        } else {
          // 拉丁词等成串单元：游标推进其字符数，无音素（对齐时插值）
          cursor += Array.from(unitText).length
          units.push({ text: unitText, symbolGroups: [] })
        }
      }
      return { text, units }
    })
}

/** PinyinLine[] → G2pLine[]（取每组代表符号作 phones，供 buildAlignLrc / 视图展示） */
export function toG2pLines(pinyinLines: PinyinLine[]): G2pLine[] {
  return pinyinLines.map((line) => ({
    text: line.text,
    units: line.units.map((unit) => ({
      text: unit.text,
      phones: unit.symbolGroups.map((group) => group[0] ?? ''),
    })),
  }))
}
