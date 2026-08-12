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
  type Word = { text: string; start: number }
  const words: Word[] = []
  for (const unit of units) {
    if (isPunctuationOnly(unit.text)) {
      if (words.length > 0) {
        words[words.length - 1].text += unit.text
      } else {
        // 行首标点：单独成词，时间取自身
        words.push({ text: unit.text, start: unit.start })
      }
      continue
    }
    words.push({ text: unit.text, start: unit.start })
  }
  if (words.length === 0) return ''

  const lineStart = formatLrcTimestamp(words[0].start)
  const parts = words.map((w) => `<${formatLrcTimestamp(w.start)}>${w.text}`)
  return `[${lineStart}]${parts.join('')}`
}
