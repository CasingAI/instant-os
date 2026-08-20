/**
 * 增强 LRC 生成：把带时间戳的对齐单元按行输出为
 * `[mm:ss.xx]<mm:ss.xx>字<mm:ss.xx>字...`。
 * 标点附在前一个字/词后面；纯标点行退化为单时间戳行。
 * 纯函数，可单测。
 */

import type { AlignedUnit, G2pLine } from './align-types.ts'

/** 秒 → mm:ss.xx（两位厘秒） */
export function formatLrcTimestamp(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const minutes = Math.floor(ms / 60_000)
  const rest = ms % 60_000
  const seconds = Math.floor(rest / 1000)
  const centis = Math.floor((rest % 1000) / 10)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`
}

/** 是否为纯标点/空白（不单独占时间戳） */
export function isPunctuationOnly(text: string): boolean {
  return /^[\s\p{P}\p{S}]*$/u.test(text)
}

const BROKEN_LINE_TS_RE = /^(\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+/
// 兼容增强 LRC 的失败标记 <mm:ss.xx|f>（时间戳后可带 |f）
const BROKEN_WORD_RE = /<\d{1,2}:\d{1,2}(?:[.:]\d{1,3})(?:\|[a-z]+)?>/g
const BROKEN_META_RE = /^\[[a-z]{1,8}:[^\]]*\]/i

/**
 * 判断 LRC 是否为「歌词时间戳未剥离」生成的坏结果。
 * 坏形态：原歌词的 `[mm:ss.xx]` 被当作歌词字符逐字对齐，产出
 * `[00:21.28]<00:21.28>[<00:21.28>00:<00:21.28>00.<00:21.28>00]<00:21.28>新…`
 * 这类嵌套行（剥掉合法行首时间戳与逐字标签后仍残留 `[`/`]`/`<`/`>`）。
 * 用于旁存恢复时跳过损坏的旧对齐结果，避免把坏 LRC 重新显示/保存。
 */
export function looksLikeBrokenLrc(text: string): boolean {
  for (const rawLine of text.split(/\r?\n/)) {
    let rest = rawLine.trim()
    if (!rest) continue
    rest = rest.replace(BROKEN_LINE_TS_RE, '').replace(BROKEN_WORD_RE, '')
    rest = rest.replace(BROKEN_META_RE, '')
    if (/[\[\]<>]/.test(rest)) return true
  }
  return false
}

/**
 * 把已对齐的扁平单元序列，按原始歌词行切分后生成增强 LRC。
 * `lines` 提供行边界（每行的 units 与扁平 units 顺序一致）；
 * 若只传扁平 units，则整首当作一行。
 */
export function buildAlignLrc(
  units: AlignedUnit[],
  lines?: G2pLine[],
): string {
  if (units.length === 0) return ''

  // 按行切分：用 lines 的 unit 计数把扁平序列切开
  const lineChunks: AlignedUnit[][] = []
  if (lines && lines.length > 0) {
    let cursor = 0
    for (const line of lines) {
      const count = line.units.length
      lineChunks.push(units.slice(cursor, cursor + count))
      cursor += count
    }
    // 多余单元并入末行
    if (cursor < units.length && lineChunks.length > 0) {
      lineChunks[lineChunks.length - 1].push(...units.slice(cursor))
    }
  } else {
    lineChunks.push(units)
  }

  const out: string[] = []
  for (const chunk of lineChunks) {
    const line = formatAlignedLine(chunk)
    if (line) out.push(line)
  }
  return out.join('\n')
}

/** 一行对齐单元 → 增强 LRC 行 */
function formatAlignedLine(units: AlignedUnit[]): string {
  if (units.length === 0) return ''

  // 合并：标点附前；无音素的纯标点也附前
  type Word = { text: string; start: number; failed?: boolean }
  const words: Word[] = []
  for (const unit of units) {
    if (isPunctuationOnly(unit.text)) {
      if (words.length > 0) {
        words[words.length - 1].text += unit.text
      } else {
        // 行首标点：单独成词，时间取自身
        words.push({ text: unit.text, start: unit.start, failed: unit.failed })
      }
      continue
    }
    words.push({ text: unit.text, start: unit.start, failed: unit.failed })
  }
  if (words.length === 0) return ''

  const lineStart = formatLrcTimestamp(words[0].start)
  const parts: string[] = []
  for (const word of words) {
    // 拉丁语境词间补空格（中文连续无需分隔）：落在前一词末尾，
    // 增强 LRC 解析会把空格并进前一词文本，渲染端无需再特殊处理
    if (parts.length > 0 && needsInterWordSpace(words[parts.length - 1].text, word.text)) {
      parts[parts.length - 1] += ' '
    }
    const marker = word.failed ? '|f' : ''
    parts.push(`<${formatLrcTimestamp(word.start)}${marker}>${word.text}`)
  }
  return `[${lineStart}]${parts.join('')}`
}

/** 相邻两词之间是否需要空格分隔（任一侧含拉丁/数字字符即需要；前词已带尾随空格则不补） */
function needsInterWordSpace(prevText: string, nextText: string): boolean {
  if (prevText.endsWith(' ')) return false
  return /[A-Za-z0-9]$/.test(prevText) || /^[A-Za-z0-9]/.test(nextText)
}
