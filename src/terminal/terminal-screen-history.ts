import type { TerminalLine, TerminalLineSource } from './terminal-types.ts'

const MAX_HISTORY_LINES = 80
const MAX_HISTORY_CHARS = 12_000
const MAX_LINE_CHARS = 2_000

export type TerminalScreenHistoryLine = Pick<TerminalLine, 'kind' | 'text'> & {
  source?: TerminalLineSource
}

function formatHistoryLine(line: TerminalScreenHistoryLine): string | undefined {
  const raw = line.text.replace(/\s+$/u, '')
  if (!raw && line.kind !== 'input') return undefined
  if (line.kind === 'status') return undefined

  const clipped =
    raw.length > MAX_LINE_CHARS ? `${raw.slice(0, MAX_LINE_CHARS)}…` : raw

  if (line.kind === 'input') {
    const marker = line.source === 'program' ? '»' : '$'
    return `${marker} ${clipped}`
  }

  if (line.kind === 'error') {
    return clipped ? `错误：${clipped}` : undefined
  }

  return clipped || undefined
}

/**
 * 把终端屏幕上已显示的历史压成一段文本，供本轮 AI 作上下文。
 * 丢弃状态行与空输出；超限时保留较新的尾部。
 */
export function formatTerminalScreenHistory(
  lines: readonly TerminalScreenHistoryLine[],
): string | undefined {
  const formatted: string[] = []
  for (const line of lines) {
    const text = formatHistoryLine(line)
    if (text !== undefined) formatted.push(text)
  }

  if (formatted.length === 0) return undefined

  let selected = formatted
  if (selected.length > MAX_HISTORY_LINES) {
    selected = selected.slice(selected.length - MAX_HISTORY_LINES)
  }

  let joined = selected.join('\n')
  if (joined.length > MAX_HISTORY_CHARS) {
    joined = joined.slice(joined.length - MAX_HISTORY_CHARS)
    const firstBreak = joined.indexOf('\n')
    if (firstBreak > 0 && firstBreak < 200) {
      joined = joined.slice(firstBreak + 1)
    }
    joined = `…（更早内容已省略）\n${joined}`
  }

  return joined
}

export function buildTerminalScreenHistoryMessage(history: string): string {
  return [
    '以下是当前终端窗口里已经显示的内容（屏幕历史），仅作上下文参考。',
    '可据此理解「刚才」「那个」「上面」等指代；不要整段复述历史。',
    '以接下来的用户命令为准执行。',
    '',
    history,
  ].join('\n')
}
