import { filesReadText } from '../files/files-api.ts'
import { writeTextFile } from '../files/files-vfs.ts'
import { buildSearchRegExp, type VscodeSearchMatchOptions } from './vscode-workspace-search-match.ts'

export type VscodeSearchReplaceOptions = VscodeSearchMatchOptions & {
  preserveCase?: boolean
}

function applyPreserveCase(matched: string, replacement: string): string {
  if (!matched) return replacement
  if (matched === matched.toUpperCase() && matched !== matched.toLowerCase()) {
    return replacement.toUpperCase()
  }
  if (matched === matched.toLowerCase() && matched !== matched.toUpperCase()) {
    return replacement.toLowerCase()
  }
  if (matched[0] === matched[0]?.toUpperCase() && matched.slice(1) === matched.slice(1).toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase()
  }
  return replacement
}

/**
 * 展开替换串中的 `$n` 捕获组，以及 `\u` `\U` `\l` `\L` 大小写修饰（VS Code 子集）。
 */
export function expandReplaceString(template: string, match: RegExpExecArray): string {
  let out = ''
  let i = 0
  while (i < template.length) {
    const ch = template[i]!
    if (ch === '\\' && i + 1 < template.length) {
      const mod = template[i + 1]
      if (mod === 'u' || mod === 'U' || mod === 'l' || mod === 'L') {
        // 修饰符作用在随后的 $n 或下一段文本的首字符 / 整段
        i += 2
        let target = ''
        if (template[i] === '$' && i + 1 < template.length && /\d/.test(template[i + 1]!)) {
          i += 1
          let num = ''
          while (i < template.length && /\d/.test(template[i]!)) {
            num += template[i]
            i += 1
          }
          target = match[Number(num)] ?? ''
        } else if (i < template.length) {
          target = template[i]!
          i += 1
        }
        if (mod === 'u') out += target.charAt(0).toUpperCase() + target.slice(1)
        else if (mod === 'l') out += target.charAt(0).toLowerCase() + target.slice(1)
        else if (mod === 'U') out += target.toUpperCase()
        else out += target.toLowerCase()
        continue
      }
      if (mod === 'n') {
        out += '\n'
        i += 2
        continue
      }
      if (mod === 't') {
        out += '\t'
        i += 2
        continue
      }
      out += template[i + 1]
      i += 2
      continue
    }
    if (ch === '$' && i + 1 < template.length) {
      if (template[i + 1] === '$') {
        out += '$'
        i += 2
        continue
      }
      if (template[i + 1] === '&') {
        out += match[0] ?? ''
        i += 2
        continue
      }
      if (/\d/.test(template[i + 1]!)) {
        i += 1
        let num = ''
        while (i < template.length && /\d/.test(template[i]!)) {
          num += template[i]
          i += 1
        }
        out += match[Number(num)] ?? ''
        continue
      }
    }
    out += ch
    i += 1
  }
  return out
}

export function replaceInText(
  text: string,
  query: string,
  replaceValue: string,
  options: VscodeSearchReplaceOptions,
  scope?: { line: number; column: number; matchLength: number },
): { text: string; count: number } | undefined {
  const pattern = buildSearchRegExp(query, options)
  if (!pattern) return undefined

  if (scope) {
    const lines = text.split('\n')
    const lineIndex = scope.line - 1
    if (lineIndex < 0 || lineIndex >= lines.length) return { text, count: 0 }
    const line = lines[lineIndex]!
    const start = scope.column - 1
    const end = start + scope.matchLength
    if (start < 0 || end > line.length) return { text, count: 0 }
    const matched = line.slice(start, end)
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    const re = new RegExp(pattern.source, flags)
    re.lastIndex = 0
    const exec = re.exec(matched)
    // 整段必须被匹配（单条替换）
    if (!exec || exec.index !== 0 || (exec[0]?.length ?? 0) !== matched.length) {
      // 退一步：在整行上找与 scope 重叠的匹配
      const lineRe = new RegExp(pattern.source, flags)
      let m = lineRe.exec(line)
      let found: RegExpExecArray | undefined
      while (m) {
        const mStart = m.index
        const mEnd = mStart + (m[0]?.length ?? 0)
        if (mStart === start && mEnd === end) {
          found = m
          break
        }
        m = lineRe.exec(line)
      }
      if (!found) return { text, count: 0 }
      const replacement = options.preserveCase
        ? applyPreserveCase(found[0] ?? '', expandReplaceString(replaceValue, found))
        : expandReplaceString(replaceValue, found)
      lines[lineIndex] = line.slice(0, start) + replacement + line.slice(end)
      return { text: lines.join('\n'), count: 1 }
    }
    const replacement = options.preserveCase
      ? applyPreserveCase(matched, expandReplaceString(replaceValue, exec))
      : expandReplaceString(replaceValue, exec)
    lines[lineIndex] = line.slice(0, start) + replacement + line.slice(end)
    return { text: lines.join('\n'), count: 1 }
  }

  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const re = new RegExp(pattern.source, flags)
  let count = 0
  const next = text.replace(re, (...args: string[]) => {
    count += 1
    const matched = args[0] ?? ''
    const offset = args[args.length - 2]
    const groups = args.slice(1, -2)
    const fake = [matched, ...groups] as unknown as RegExpExecArray
    fake.index = typeof offset === 'number' ? offset : Number(offset)
    fake.input = text
    const expanded = expandReplaceString(replaceValue, fake)
    return options.preserveCase ? applyPreserveCase(matched, expanded) : expanded
  })
  return { text: next, count }
}

export type VscodeReplaceTarget = {
  path: string
  /** 打开标签：直接改内存；否则读写磁盘 */
  openText: string | undefined
}

export async function applyReplaceToTarget(
  target: VscodeReplaceTarget,
  query: string,
  replaceValue: string,
  options: VscodeSearchReplaceOptions,
  scope?: { line: number; column: number; matchLength: number },
): Promise<{ path: string; text: string; count: number; fromOpenTab: boolean } | undefined> {
  const source =
    target.openText !== undefined ? target.openText : await filesReadText(target.path)
  const result = replaceInText(source, query, replaceValue, options, scope)
  if (!result || result.count === 0) return undefined

  if (target.openText === undefined) {
    await writeTextFile(target.path, result.text)
  }

  return {
    path: target.path,
    text: result.text,
    count: result.count,
    fromOpenTab: target.openText !== undefined,
  }
}

/** 替换预览：生成单条命中的 after 文本 */
export function previewReplaceLine(
  linePreview: string,
  matchedText: string,
  query: string,
  replaceValue: string,
  options: VscodeSearchReplaceOptions,
): string {
  const pattern = buildSearchRegExp(query, options)
  if (!pattern || !matchedText) return linePreview
  const flags = pattern.flags.includes('g') ? pattern.flags.replace('g', '') : pattern.flags
  const re = new RegExp(pattern.source, flags)
  const exec = re.exec(matchedText)
  if (!exec) return linePreview
  const expanded = expandReplaceString(replaceValue, exec)
  const replacement = options.preserveCase ? applyPreserveCase(matchedText, expanded) : expanded
  const idx = linePreview.indexOf(matchedText)
  if (idx < 0) return linePreview
  return linePreview.slice(0, idx) + replacement + linePreview.slice(idx + matchedText.length)
}
