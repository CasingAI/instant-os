/**
 * LRC 歌词解析（纯函数，可单测）。
 * 支持：元数据标签 [ti:][ar:][al:][by:][offset:±ms]、
 * 行内多个时间戳 [mm:ss.xx][mm:ss.xx]、增强 LRC 逐字 <mm:ss.xx>词</mm:ss.xx>。
 */

export type LyricsWord = {
  timeMs: number
  text: string
  /** 对齐失败标记：true 表示该词时间戳为插值兜底（增强 LRC <mm:ss.xx|f>） */
  failed?: boolean
}

export type LyricsLine = {
  /** 毫秒；纯文本行（无时间戳）为 undefined */
  timeMs?: number
  text: string
  /** 增强 LRC 的逐字时间戳（无则 undefined） */
  words?: LyricsWord[]
}

export type LrcParseResult = {
  lines: LyricsLine[]
  offsetMs: number
  meta: Record<string, string>
}

const TIME_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/
const TAG_RE = /^\[(ti|ar|al|by|offset|re|ve|length|au):(.*)\]$/
// 增强 LRC 逐字：<mm:ss.xx>词（词到下一个 < 为止，无收尾 >）；时间戳后可带 |f 失败标记
const WORD_RE = /<(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))(?:\|([a-z]+))?>([^<]*)/g

function parseTimeMs(minutes: string, seconds: string, fraction: string | undefined): number {
  const min = Number(minutes)
  const sec = Number(seconds)
  // 分/秒后的小数：2 位（xx）按厘秒、3 位（xxx）按毫秒处理
  let ms = min * 60_000 + sec * 1000
  if (fraction !== undefined && fraction.length > 0) {
    const raw = fraction
    if (raw.length === 2) {
      ms += Number(raw) * 10
    } else {
      ms += Number(raw.padEnd(3, '0').slice(0, 3))
    }
  }
  return ms
}

/** 解析一行内的所有时间戳，返回去除时间戳后的剩余文本 */
function stripTimestamps(line: string): { times: number[]; rest: string } {
  const times: number[] = []
  let rest = line
  TIME_RE.lastIndex = 0
  for (let guard = 0; guard < 30; guard += 1) {
    const match = TIME_RE.exec(rest)
    if (!match) break
    times.push(parseTimeMs(match[1], match[2], match[3]))
    rest = rest.slice(0, match.index) + rest.slice(match.index + match[0].length)
  }
  return { times, rest: rest.trim() }
}

/** 解析增强 LRC 逐字时间戳；无则返回 undefined */
function parseWords(text: string): LyricsWord[] | undefined {
  if (!text.includes('<')) {
    return undefined
  }
  const words: LyricsWord[] = []
  WORD_RE.lastIndex = 0
  let match: RegExpExecArray | null
  let found = false
  while ((match = WORD_RE.exec(text))) {
    found = true
    const wordText = match[5]
    if (wordText) {
      const word: LyricsWord = {
        timeMs: parseTimeMs(match[1], match[2], match[3]),
        text: wordText,
      }
      if (match[4]) {
        word.failed = true
      }
      words.push(word)
    }
  }
  return found && words.length > 0 ? words : undefined
}

/**
 * 解析 LRC 文本。
 * 时间戳行按时间排序（应用 offset 后）；无时间戳的纯文本行保留在 lines 末尾。
 */
export function parseLrc(raw: string): LrcParseResult {
  const meta: Record<string, string> = {}
  let offsetMs = 0
  const timed: LyricsLine[] = []
  const untimed: LyricsLine[] = []

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }
    const tagMatch = TAG_RE.exec(line)
    if (tagMatch) {
      const key = tagMatch[1]
      const value = tagMatch[2].trim()
      if (key === 'offset') {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) {
          offsetMs = parsed
        }
      } else {
        meta[key] = value
      }
      continue
    }

    const { times, rest } = stripTimestamps(line)
    if (rest.length === 0) {
      continue
    }
    const words = parseWords(rest)
    const text = words ? words.map((word) => word.text).join('') : rest
    if (times.length === 0) {
      const untimedLine: LyricsLine = { text }
      if (words) {
        untimedLine.words = words
      }
      untimed.push(untimedLine)
      continue
    }
    for (const timeMs of times) {
      const timedLine: LyricsLine = { timeMs: timeMs + offsetMs, text }
      if (words) {
        timedLine.words = words
      }
      timed.push(timedLine)
    }
  }

  timed.sort((a, b) => (a.timeMs ?? 0) - (b.timeMs ?? 0))
  return { lines: [...timed, ...untimed], offsetMs, meta }
}

/** 判断一段文本是否像 LRC（含时间戳行或元数据标签） */
export function looksLikeLrc(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (TIME_RE.test(trimmed) || /^\[(ti|ar|al|by|offset)\s*:/i.test(trimmed)) {
      return true
    }
  }
  return false
}

/**
 * 卡拉OK逐词渲染时，相邻两词之间需补的空格（'' 或 ' '）。
 * 英文等拉丁词在增强 LRC 词间可能无分隔（旧版生成无空格 / 已被解析吞并），
 * 渲染时按拉丁语境补空格；中文连续词不需要。
 */
export function interWordSpace(prevText: string | undefined, nextText: string): string {
  if (!prevText || prevText.endsWith(' ')) return ''
  return /[A-Za-z0-9]$/.test(prevText) || /^[A-Za-z0-9]/.test(nextText) ? ' ' : ''
}

/** 按词列表拼出显示文本（词间经 interWordSpace 补空格；与逐词渲染一致） */
export function wordsToText(words: readonly LyricsWord[]): string {
  let out = ''
  for (let i = 0; i < words.length; i += 1) {
    out += interWordSpace(i > 0 ? words[i - 1].text : undefined, words[i].text)
    out += words[i].text
  }
  return out
}

/** 所有行均无时间戳（纯文本歌词）时为真 */
export function hasTimedLines(lines: readonly LyricsLine[]): boolean {
  return lines.some((line) => line.timeMs !== undefined)
}

/**
 * 纯文本歌词（无任何行时间戳）时，按播放进度估算当前行索引。
 * 播放进度 = timeMs / durationMs；无时长或非正时长返回 -1。
 */
export function estimateLineIndexForTime(
  lines: readonly LyricsLine[],
  timeMs: number,
  durationMs: number | undefined,
): number {
  if (lines.length === 0 || !durationMs || durationMs <= 0) return -1
  const progress = Math.min(1, Math.max(0, timeMs / durationMs))
  return Math.min(lines.length - 1, Math.floor(progress * lines.length))
}

/** 纯文本歌词点击某行时，估算其对应的播放秒数（无时长返回 0） */
export function estimateLineSeekSec(
  lines: readonly LyricsLine[],
  index: number,
  durationSec: number | undefined,
): number {
  if (lines.length === 0 || !durationSec || durationSec <= 0) return 0
  return Math.min(durationSec, (index / lines.length) * durationSec)
}
