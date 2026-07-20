/**
 * Search 视图用 glob：`,` 分隔；无 `/` 的模式隐含递归（同 VS Code Search 视图语义）。
 */

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
    if (pattern[i] === '{') {
      const end = pattern.indexOf('}', i)
      if (end > i) {
        const inner = pattern.slice(i + 1, end)
        const alts = inner.split(',').map((part) => globToRegexSource(part.trim()))
        out += `(?:${alts.join('|')})`
        i = end + 1
        continue
      }
    }
    if (pattern[i] === '[') {
      const end = pattern.indexOf(']', i)
      if (end > i) {
        out += pattern.slice(i, end + 1)
        i = end + 1
        continue
      }
    }
    out += escapeRegex(pattern[i]!)
    i += 1
  }
  return out
}

/** 规范化 Search 视图 glob：无斜杠时加递归前缀；去掉 ./ 前缀 */
export function normalizeSearchGlob(raw: string): string {
  let pattern = raw.trim().replace(/\\/g, '/')
  if (!pattern) return ''
  if (pattern.startsWith('./')) pattern = pattern.slice(2)
  pattern = pattern.replace(/^\/+/, '')
  if (!pattern.includes('/')) {
    return `**/${pattern}`
  }
  return pattern
}

export function parseSearchGlobList(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw
    .split(',')
    .map((part) => normalizeSearchGlob(part))
    .filter(Boolean)
}

export function compileSearchGlobs(patterns: readonly string[]): RegExp[] {
  return patterns.map((pattern) => {
    const source = globToRegexSource(pattern)
    return new RegExp(`^${source}$`, 'i')
  })
}

export function pathMatchesAnyGlob(
  workspaceRelativePath: string,
  globs: readonly RegExp[],
): boolean {
  if (globs.length === 0) return false
  const path = workspaceRelativePath.replace(/^\/+/, '').replace(/\/+$/, '')
  return globs.some((glob) => glob.test(path))
}

/** 目录前缀匹配：include 命中文件自身或其祖先路径段 */
export function pathMatchesIncludeGlobs(
  workspaceRelativePath: string,
  includeGlobs: readonly RegExp[],
): boolean {
  if (includeGlobs.length === 0) return true
  const path = workspaceRelativePath.replace(/^\/+/, '').replace(/\/+$/, '')
  if (pathMatchesAnyGlob(path, includeGlobs)) return true
  const segments = path.split('/')
  for (let i = 1; i < segments.length; i += 1) {
    const ancestor = segments.slice(0, i).join('/')
    if (pathMatchesAnyGlob(ancestor, includeGlobs)) return true
  }
  return false
}

/** include 为空视为全部匹配；exclude 命中则否 */
export function pathPassesIncludeExclude(
  workspaceRelativePath: string,
  includeGlobs: readonly RegExp[],
  excludeGlobs: readonly RegExp[],
): boolean {
  const path = workspaceRelativePath.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!pathMatchesIncludeGlobs(path, includeGlobs)) return false
  if (excludeGlobs.length > 0 && pathMatchesAnyGlob(path, excludeGlobs)) return false
  return true
}

/** 默认 search.exclude（内存级，非设置编辑器） */
export const DEFAULT_SEARCH_EXCLUDE_GLOBS = [
  '**/node_modules',
  '**/node_modules/**',
  '**/dist',
  '**/dist/**',
  '**/build',
  '**/build/**',
  '**/.git',
  '**/.git/**',
  '**/coverage',
  '**/coverage/**',
] as const
