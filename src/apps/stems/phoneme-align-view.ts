/**
 * 双轨对齐视图的纯逻辑：把增强 LRC 解析成逐字时间线（上轨），
 * 再把音素段按时间中点映射到歌词的「行 × 字」（下轨 ↔ 上轨对应关系）。
 * 纯函数模块，不依赖 UI / Agent 运行时，可用 node --experimental-strip-types 单测。
 */

import { parseLrc } from '../music/music-lyrics.ts'
import type { AlignedPhone } from './phoneme-types.ts'
import { ipaToPinyin } from './phoneme-ipa-mapping.ts'

/** 单字时间块（秒） */
export type CharSegment = {
  char: string
  start: number
  end: number
}

/** 一行歌词的时间块 */
export type CharTimeline = {
  /** 行下标（从 0 起，仅计带时间戳的行） */
  lineIndex: number
  /** 行文本（增强 LRC 为逐字拼接后的原文） */
  lineText: string
  /** 行起止（秒） */
  start: number
  end: number
  /** 逐字时间戳（增强 LRC 才有；标准 LRC 无此字段，整行退化为单块） */
  chars?: CharSegment[]
}

export type AlignLrcTimeline = {
  timeline: CharTimeline[]
  /** 是否有逐字时间戳（决定渲染逐字块还是整行块） */
  hasWordTimestamps: boolean
  /** 时间轴总时长（秒）：优先传入的 duration，兜底为末行结束 */
  durationSec: number
  /** LRC 元数据（[ti:] 等） */
  meta: Record<string, string>
}

/**
 * 解析增强/标准 LRC → 逐行时间线。
 * 行 start 取首个时间戳，end 取下一行 start（末行用 duration 兜底，无 duration 按 3 秒）；
 * 逐字 char 的 start 取 `<ts>`，end 取下一字 start（末字用行尾兜底）；
 * word 含多字（`<ts>春天`）时按字数均分该 word 的时长跨度。
 */
export function parseAlignLrcTimeline(
  lrcText: string,
  durationSec?: number,
): AlignLrcTimeline {
  const { lines, meta, offsetMs } = parseLrc(lrcText)
  // 有效行 = 带行时间戳的行 ∪ 带逐字时间戳的行（容忍纯增强行 `[mm:ss.xx]` 缺省）；
  // 起点取行时间戳或首个逐字时间戳（逐字时间戳补 offset，与行时间戳口径一致），
  // 统一按时间排序后重排行号
  const effective = lines
    .filter((line) => line.timeMs !== undefined || (line.words?.length ?? 0) > 0)
    .map((line) => {
      const startMs =
        line.timeMs ??
        (line.words && line.words.length > 0
          ? line.words[0].timeMs + offsetMs
          : 0)
      return { line, startSec: startMs / 1000 }
    })
    .sort((a, b) => a.startSec - b.startSec)

  const timeline: CharTimeline[] = []
  let hasWordTimestamps = false

  for (let i = 0; i < effective.length; i++) {
    const { line, startSec } = effective[i]
    const next = effective[i + 1]
    let end: number
    if (next) {
      end = next.startSec
    } else if (durationSec !== undefined) {
      end = Math.max(durationSec, startSec)
    } else {
      end = startSec + 3 // 无 duration 兜底：末行按 3 秒
    }
    const entry: CharTimeline = { lineIndex: i, lineText: line.text, start: startSec, end }
    if (line.words && line.words.length > 0) {
      hasWordTimestamps = true
      entry.chars = splitWordsToChars(line.words, startSec, end, offsetMs)
    }
    timeline.push(entry)
  }

  const lastEnd = timeline.length > 0 ? timeline[timeline.length - 1].end : 0
  return {
    timeline,
    hasWordTimestamps,
    durationSec: Math.max(durationSec ?? 0, lastEnd),
    meta,
  }
}

/** word 序列（含每个词的起始毫秒）→ 逐字块（秒）；offsetMs 为 [offset:] 偏移，逐字时间戳需补上 */
function splitWordsToChars(
  words: { timeMs: number; text: string }[],
  lineStartSec: number,
  lineEndSec: number,
  offsetMs = 0,
): CharSegment[] {
  const chars: CharSegment[] = []
  for (let w = 0; w < words.length; w++) {
    const word = words[w]
    const text = Array.from(word.text) // 按码点拆字（兼容代理对）
    if (text.length === 0) continue
    const wordStart = Math.max(lineStartSec, (word.timeMs + offsetMs) / 1000)
    const wordEnd =
      w + 1 < words.length ? (words[w + 1].timeMs + offsetMs) / 1000 : lineEndSec
    // 时间戳异常（词序重叠/相同）时给最小跨度，避免零宽块不可见
    const span = Math.max(0.1, wordEnd - wordStart)
    for (let k = 0; k < text.length; k++) {
      chars.push({
        char: text[k],
        start: wordStart + (span * k) / text.length,
        end: wordStart + (span * (k + 1)) / text.length,
      })
    }
  }
  return chars
}

/** 一个音素被映射到歌词的「行 × 字」的结果 */
export type PhoneCharAssignment = {
  phone: AlignedPhone
  /** 拼音（ipaToPinyin 结果，CTC 特殊标记在此前已过滤） */
  pinyin: string
  /** 命中的行下标；行外（句首/句尾静音）为 -1 */
  lineIndex: number
  /** 命中的字下标；行内字间间隙为 -1；无逐字时间戳时整行归 0 */
  charIndex: number
  /** 命中的字；间隙/行外为空串 */
  char: string
  /** 所属行文本 */
  lineText: string
}

/**
 * 每个音素按时间中点 (start+end)/2 落入所属行/字区间。
 * CTC 特殊标记（ipaToPinyin 为空）不参与映射，与工作区素材口径一致。
 */
export function assignPhonesToChars(
  phones: AlignedPhone[],
  timeline: CharTimeline[],
): PhoneCharAssignment[] {
  const assignments: PhoneCharAssignment[] = []
  for (const phone of phones) {
    const pinyin = ipaToPinyin(phone.symbol)
    if (!pinyin) continue
    const mid = (phone.start + phone.end) / 2
    let lineIndex = -1
    let charIndex = -1
    let char = ''
    let lineText = ''
    for (const line of timeline) {
      if (mid < line.start) break
      if (mid > line.end) continue
      lineIndex = line.lineIndex
      lineText = line.lineText
      if (line.chars) {
        for (let c = 0; c < line.chars.length; c++) {
          const seg = line.chars[c]
          if (mid >= seg.start && mid < seg.end) {
            charIndex = c
            char = seg.char
            break
          }
        }
      } else {
        // 无逐字时间戳：整行视为一个「字块」，行内都归到 0
        charIndex = 0
        char = line.lineText
      }
      break
    }
    assignments.push({ phone, pinyin, lineIndex, charIndex, char, lineText })
  }
  return assignments
}

/** 明细表的一行：某个字 → 归属它的音素清单 */
export type CharPhoneRow = {
  lineIndex: number
  lineText: string
  /** 字在行内的下标（与时间线 chars 对齐，供 hover 联动） */
  charIndex: number
  char: string
  charStart: number
  charEnd: number
  phones: { pinyin: string; symbol: string; start: number; end: number }[]
}

/**
 * 按时间线骨架（行 × 字）聚合音素 → 明细行。
 * 以 timeline 的 chars 为骨架，保证没有音素命中的字也出现在表里；
 * 间隙音素（charIndex < 0）不占行，由调用方统计提示。
 */
export function buildCharPhoneRows(
  assignments: PhoneCharAssignment[],
  timeline: CharTimeline[],
): CharPhoneRow[] {
  const byChar = new Map<string, PhoneCharAssignment[]>()
  for (const a of assignments) {
    if (a.lineIndex < 0 || a.charIndex < 0) continue
    const key = `${a.lineIndex}:${a.charIndex}`
    const list = byChar.get(key)
    if (list) list.push(a)
    else byChar.set(key, [a])
  }

  const rows: CharPhoneRow[] = []
  for (const line of timeline) {
    const blocks = line.chars ?? [
      { char: line.lineText, start: line.start, end: line.end },
    ]
    for (let c = 0; c < blocks.length; c++) {
      const block = blocks[c]
      const list = byChar.get(`${line.lineIndex}:${c}`) ?? []
      rows.push({
        lineIndex: line.lineIndex,
        lineText: line.lineText,
        charIndex: c,
        char: block.char,
        charStart: block.start,
        charEnd: block.end,
        phones: list.map((a) => ({
          pinyin: a.pinyin,
          symbol: a.phone.symbol,
          start: a.phone.start,
          end: a.phone.end,
        })),
      })
    }
  }
  return rows
}

/** 字/音素块的稳定配色下标（同「行 × 字」同色，跨 lineIndex 取模分散） */
export function charColorIndex(lineIndex: number, charIndex: number): number {
  return (Math.max(0, lineIndex) * 31 + Math.max(0, charIndex)) % 8
}
