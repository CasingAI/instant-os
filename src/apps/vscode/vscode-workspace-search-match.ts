/**
 * 构建工作区搜索用正则；非法正则返回 undefined。
 */

export type VscodeSearchMatchOptions = {
  isCaseSensitive?: boolean
  matchWholeWord?: boolean
  isRegex?: boolean
}

export function escapeRegExpLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function buildSearchRegExp(
  query: string,
  options: VscodeSearchMatchOptions = {},
): RegExp | undefined {
  const trimmed = query.trim()
  if (!trimmed) return undefined

  let source: string
  if (options.isRegex) {
    source = trimmed
  } else {
    source = escapeRegExpLiteral(trimmed)
  }

  if (options.matchWholeWord) {
    source = `(?<!\\w)(?:${source})(?!\\w)`
  }

  const flags = options.isCaseSensitive ? 'g' : 'gi'
  try {
    return new RegExp(source, flags)
  } catch {
    return undefined
  }
}

export type LineMatch = {
  column: number
  matchLength: number
  matchedText: string
}

/** 在单行上找全部非重叠匹配（column 为 1-based） */
export function findMatchesInLine(line: string, pattern: RegExp): LineMatch[] {
  const matches: LineMatch[] = []
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const re = new RegExp(pattern.source, flags)
  let match = re.exec(line)
  while (match) {
    const matchedText = match[0] ?? ''
    if (matchedText.length === 0) {
      if (re.lastIndex === match.index) re.lastIndex += 1
      match = re.exec(line)
      continue
    }
    matches.push({
      column: match.index + 1,
      matchLength: matchedText.length,
      matchedText,
    })
    match = re.exec(line)
  }
  return matches
}
