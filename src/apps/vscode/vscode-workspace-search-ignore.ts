/**
 * 轻量 .gitignore 匹配（搜索用）。
 * 支持：注释、! 取反、目录尾 /、* ? **、含 / 时锚定到该 .gitignore 目录。
 */

export type GitIgnoreRule = {
  negated: boolean
  directoryOnly: boolean
  /** 模式相对 .gitignore 所在目录 */
  regex: RegExp
  /** 仅目录规则：匹配该目录名后，其子路径一律视为命中 */
  dirPrefixRegex: RegExp | undefined
}

export type GitIgnoreSet = {
  /** 相对工作区根，无首尾 /；根目录为空串 */
  baseRel: string
  rules: GitIgnoreRule[]
}

function escapeRegex(text: string): string {
  return text.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function globToRegexSource(pattern: string): string {
  let i = 0
  let out = ''
  while (i < pattern.length) {
    if (pattern.startsWith('**/', i)) {
      out += '(?:.*/)?' 
      i += 3
      continue
    }
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      out += '.*'
      i += 2
      continue
    }
    if (pattern[i] === '*') {
      out += '[^/]*'
      i += 1
      continue
    }
    if (pattern[i] === '?') {
      out += '[^/]'
      i += 1
      continue
    }
    out += escapeRegex(pattern[i]!)
    i += 1
  }
  return out
}

function compileRule(rawPattern: string, directoryOnly: boolean, negated: boolean): GitIgnoreRule {
  const anchored = rawPattern.includes('/')
  const pattern = rawPattern.replace(/^\/+/, '').replace(/\/+$/, '')
  const body = globToRegexSource(pattern)

  // 锚定：相对 .gitignore 目录；未锚定：可出现在任意子路径段
  const regex = anchored
    ? new RegExp(`^${body}$`)
    : new RegExp(`(?:^|/)${body}$`)

  const dirPrefixRegex = directoryOnly
    ? anchored
      ? new RegExp(`^${body}(?:/|$)`)
      : new RegExp(`(?:^|/)${body}(?:/|$)`)
    : undefined

  return { negated, directoryOnly, regex, dirPrefixRegex }
}

export function parseGitIgnoreRules(text: string): GitIgnoreRule[] {
  const rules: GitIgnoreRule[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trimEnd()
    if (!line.trim() || line.trimStart().startsWith('#')) continue

    let negated = false
    if (line.startsWith('!')) {
      negated = true
      line = line.slice(1)
    }

    let directoryOnly = false
    if (line.endsWith('/')) {
      directoryOnly = true
      line = line.slice(0, -1)
    }

    line = line.trim()
    if (!line) continue

    rules.push(compileRule(line, directoryOnly, negated))
  }

  return rules
}

function pathRelativeToBase(baseRel: string, workspaceRelativePath: string): string | undefined {
  const path = workspaceRelativePath.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!baseRel) return path
  if (path === baseRel) return ''
  const prefix = `${baseRel}/`
  if (!path.startsWith(prefix)) return undefined
  return path.slice(prefix.length)
}

function ruleMatches(rule: GitIgnoreRule, relPath: string, isDirectory: boolean): boolean {
  if (!relPath) return false

  if (rule.directoryOnly) {
    if (isDirectory && rule.regex.test(relPath)) return true
    return rule.dirPrefixRegex ? rule.dirPrefixRegex.test(relPath) : false
  }

  if (isDirectory) {
    return rule.regex.test(relPath) || Boolean(rule.dirPrefixRegex?.test(relPath))
  }

  return rule.regex.test(relPath)
}

/** 多层 .gitignore：自根到叶依次应用，后匹配的规则覆盖先前结果 */
export function isIgnoredBySets(
  sets: readonly GitIgnoreSet[],
  workspaceRelativePath: string,
  isDirectory: boolean,
): boolean {
  let ignored = false

  for (const set of sets) {
    const rel = pathRelativeToBase(set.baseRel, workspaceRelativePath)
    if (rel === undefined) continue
    if (!rel && !isDirectory) continue

    for (const rule of set.rules) {
      if (!rel) continue
      if (ruleMatches(rule, rel, isDirectory)) {
        ignored = !rule.negated
      }
    }
  }

  return ignored
}

export async function tryLoadGitIgnoreSet(
  dirAbsolutePath: string,
  baseRel: string,
  readText: (path: string) => Promise<string>,
): Promise<GitIgnoreSet | undefined> {
  const ignorePath = `${dirAbsolutePath.replace(/\/+$/, '')}/.gitignore`
  try {
    const text = await readText(ignorePath)
    const rules = parseGitIgnoreRules(text)
    if (rules.length === 0) return undefined
    return { baseRel, rules }
  } catch {
    return undefined
  }
}

export function relativeToWorkspace(workspaceFolder: string, absolutePath: string): string {
  const root = workspaceFolder.replace(/\/+$/, '') || '/'
  if (absolutePath === root) return ''
  if (absolutePath.startsWith(`${root}/`)) return absolutePath.slice(root.length + 1)
  return absolutePath.replace(/^\/+/, '')
}
