import { filesList } from '../apps/files/files-api.ts'
import { listTerminalMountSummaries } from './terminal-privilege.ts'
import { resolveTerminalPath } from './terminal-path.ts'

const LOCAL_COMMANDS = [
  'help',
  'clear',
  'pwd',
  'cd',
  'ls',
  'demo',
  'npm',
  'npx',
  'mount',
  'umount',
  'unmount',
  'storage',
  'account',
] as const

/** 这些命令的参数位按路径补全（不必是本地命令） */
const PATH_ARG_COMMANDS = new Set([
  'cd',
  'ls',
  'cat',
  'rm',
  'mkdir',
  'touch',
  'mv',
  'cp',
  'head',
  'tail',
  'open',
  'stat',
  'tree',
  'less',
  'more',
  'rmdir',
  'ln',
  'chmod',
])

const STORAGE_SUBCOMMANDS = ['ls', 'get', 'set', 'rm'] as const

export type TerminalTabCompleteResult = {
  /** 补全后的整行草稿 */
  nextDraft: string
  /** 无法继续缩短公共前缀时列出候选（供终端打印） */
  candidates?: string[]
}

function commonPrefix(values: string[]): string {
  if (values.length === 0) return ''
  let prefix = values[0] ?? ''
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index] ?? ''
    let end = 0
    while (end < prefix.length && end < value.length && prefix[end] === value[end]) {
      end += 1
    }
    prefix = prefix.slice(0, end)
    if (!prefix) break
  }
  return prefix
}

function filterByPrefix(candidates: string[], prefix: string): string[] {
  if (!prefix) return [...candidates]
  const lower = prefix.toLowerCase()
  return candidates.filter((item) => item.startsWith(prefix) || item.toLowerCase().startsWith(lower))
}

function needsShellQuote(name: string): boolean {
  return /[\s'"\\]/.test(name)
}

function shellQuoteToken(name: string): string {
  if (!needsShellQuote(name)) return name
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function replaceLastToken(draft: string, nextToken: string): string {
  const endsWithSpace = /\s$/.test(draft)
  if (endsWithSpace) {
    return `${draft}${nextToken}`
  }
  const match = draft.match(/^(.*?)(\S*)$/)
  if (!match) return nextToken
  return `${match[1] ?? ''}${nextToken}`
}

/**
 * 取正在编辑的最后一个参数。
 * 支持简单双引号（补全带空格的文件名后继续 Tab）。
 */
function lastToken(draft: string): { token: string; trailingSpace: boolean; quoted: boolean } {
  if (/\s$/.test(draft)) {
    return { token: '', trailingSpace: true, quoted: false }
  }

  const openQuote = draft.match(/^(.*)\s"([^"]*)$/)
  if (openQuote) {
    return { token: openQuote[2] ?? '', trailingSpace: false, quoted: true }
  }

  const match = draft.match(/(\S*)$/)
  return { token: match?.[1] ?? '', trailingSpace: false, quoted: false }
}

function applyCandidates(
  draft: string,
  token: string,
  matches: string[],
  options?: { quote?: boolean },
): TerminalTabCompleteResult | undefined {
  if (matches.length === 0) return undefined

  const quote = options?.quote ?? false
  const display = quote
    ? matches.map((item) => {
        if (item.endsWith('/')) {
          const body = item.slice(0, -1)
          return `${shellQuoteToken(body)}/`
        }
        return shellQuoteToken(item)
      })
    : matches

  if (display.length === 1) {
    const only = display[0]
    if (only === undefined) return undefined
    return { nextDraft: replaceLastToken(draft, only) }
  }

  // 公共前缀按未加引号的原始名计算，避免引号干扰
  const shared = commonPrefix(matches)
  if (shared.length > token.length) {
    const sharedOut = quote
      ? shared.endsWith('/')
        ? `${shellQuoteToken(shared.slice(0, -1))}/`
        : needsShellQuote(shared) || matches.some((item) => needsShellQuote(item))
          ? `"${shared}`
          : shared
      : shared
    return { nextDraft: replaceLastToken(draft, sharedOut) }
  }

  return {
    nextDraft: draft,
    candidates: display,
  }
}

async function completePathToken(cwd: string, token: string): Promise<string[]> {
  let dirPath: string
  let namePrefix: string

  if (token === '' || token.endsWith('/')) {
    dirPath = token === '' ? cwd : resolveTerminalPath(cwd, token)
    namePrefix = ''
  } else if (token.startsWith('/')) {
    const slash = token.lastIndexOf('/')
    dirPath = slash <= 0 ? '/' : token.slice(0, slash) || '/'
    namePrefix = token.slice(slash + 1)
  } else {
    const relSlash = token.lastIndexOf('/')
    if (relSlash === -1) {
      dirPath = cwd
      namePrefix = token
    } else {
      dirPath = resolveTerminalPath(cwd, token.slice(0, relSlash + 1) || '.')
      namePrefix = token.slice(relSlash + 1)
    }
  }

  // 命名空间根
  if (dirPath === '/' || token === '/') {
    try {
      const entries = await filesList('/')
      return entries
        .filter((entry) => {
          if (!namePrefix) return true
          return (
            entry.name.startsWith(namePrefix) ||
            entry.name.toLowerCase().startsWith(namePrefix.toLowerCase())
          )
        })
        .map((entry) => {
          const suffix = entry.kind === 'folder' ? '/' : ''
          if (token.startsWith('/')) {
            return `/${entry.name}${suffix}`
          }
          return `${entry.name}${suffix}`
        })
        .sort((a, b) => a.localeCompare(b))
    } catch {
      return []
    }
  }

  try {
    const entries = await filesList(dirPath)
    const matches: string[] = []
    for (const entry of entries) {
      if (
        namePrefix &&
        !entry.name.startsWith(namePrefix) &&
        !entry.name.toLowerCase().startsWith(namePrefix.toLowerCase())
      ) {
        continue
      }
      const suffix = entry.kind === 'folder' ? '/' : ''
      if (token.startsWith('/')) {
        const base = dirPath === '/' ? '' : dirPath
        matches.push(`${base}/${entry.name}${suffix}`.replace(/\/{2,}/g, '/'))
      } else {
        const relSlash = token.lastIndexOf('/')
        const parentRel = relSlash === -1 ? '' : token.slice(0, relSlash + 1)
        matches.push(`${parentRel}${entry.name}${suffix}`)
      }
    }
    return matches.sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

function listLocalStorageKeys(): string[] {
  const keys: string[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key) keys.push(key)
  }
  return keys.sort((a, b) => a.localeCompare(b))
}

function shouldCompletePath(head: string, parts: string[], trailingSpace: boolean, token: string): boolean {
  if (head === 'storage' || head === 'help' || head === 'clear' || head === 'pwd' || head === 'demo' || head === 'mount') {
    return false
  }
  if (PATH_ARG_COMMANDS.has(head)) {
    // `cat` / `cat ` / `cat foo` 都进入路径补全；裸 `cat` 先补空格
    return trailingSpace || parts.length >= 2 || (parts.length === 1 && PATH_ARG_COMMANDS.has(token.toLowerCase()))
  }
  if (token.includes('/') || token === '.' || token === '..' || token.startsWith('./') || token.startsWith('../')) {
    return true
  }
  // 任意未知命令的参数位也按路径试补全
  return parts.length >= 2 || (parts.length === 1 && trailingSpace)
}

/**
 * Tab 补全：本地命令 / 子命令 / 路径 / 挂载点 / storage key。
 * 行为接近 bash：唯一则填入；多候选则填公共前缀，否则返回候选列表。
 */
export async function completeTerminalTab(
  draft: string,
  cwd: string,
): Promise<TerminalTabCompleteResult> {
  const trimmedStart = draft.replace(/^\s+/, '')
  const { token, trailingSpace, quoted } = lastToken(draft)
  const parts = trimmedStart.length === 0 ? [] : trimmedStart.trimEnd().split(/\s+/)
  const head = (parts[0] ?? '').toLowerCase()

  // 首词：本地命令（尚未输入参数时）
  if (parts.length === 0 || (parts.length === 1 && !trailingSpace && !PATH_ARG_COMMANDS.has(token.toLowerCase()))) {
    const matches = filterByPrefix([...LOCAL_COMMANDS], token).map((name) => `${name} `)
    const applied = applyCandidates(draft, token, matches)
    if (applied) return applied
  }

  // 路径类命令敲全名后 Tab → 先补空格，便于再 Tab 出文件名
  if (parts.length === 1 && !trailingSpace && PATH_ARG_COMMANDS.has(token.toLowerCase())) {
    return { nextDraft: `${token} ` }
  }

  // storage 子命令 / key
  if (head === 'storage') {
    if (parts.length === 1 && trailingSpace) {
      const matches = STORAGE_SUBCOMMANDS.map((name) => `${name} `)
      const applied = applyCandidates(draft, '', matches)
      if (applied) return applied
    }
    if (parts.length === 2 && !trailingSpace) {
      const matches = filterByPrefix([...STORAGE_SUBCOMMANDS], token).map((name) =>
        name === 'ls' ? name : `${name} `,
      )
      const applied = applyCandidates(draft, token, matches)
      if (applied) return applied
    }
    const sub = (parts[1] ?? '').toLowerCase()
    // get / rm：补全 key；set：仅在第三段（key）上补全，不碰 value
    const completingStorageKey =
      (parts.length === 2 && trailingSpace) ||
      (parts.length === 3 && !trailingSpace && (sub === 'get' || sub === 'rm' || sub === 'set' || sub === 'read' || sub === 'remove' || sub === 'delete'))
    if (
      completingStorageKey &&
      (sub === 'rm' ||
        sub === 'get' ||
        sub === 'set' ||
        sub === 'remove' ||
        sub === 'delete' ||
        sub === 'read')
    ) {
      const keys = filterByPrefix(listLocalStorageKeys(), token)
      const applied = applyCandidates(draft, token, keys)
      if (applied) return applied
    }
  }

  // umount：挂载路径 / 标签
  if (head === 'umount' || head === 'unmount') {
    if ((parts.length === 1 && trailingSpace) || parts.length >= 2) {
      const mounts = await listTerminalMountSummaries()
      const options = [
        ...mounts.map((item) => item.path),
        ...mounts.map((item) => item.label),
      ]
      const matches = filterByPrefix(options, token)
      const applied = applyCandidates(draft, token, matches)
      if (applied) return applied
    }
  }

  if (shouldCompletePath(head, parts, trailingSpace, token)) {
    let pathMatches = await completePathToken(cwd, token)
    // 前缀无匹配时列出当前目录全部条目，避免「按了 Tab 完全没反应」
    if (pathMatches.length === 0 && token.length > 0 && !token.includes('/')) {
      pathMatches = await completePathToken(cwd, '')
    }
    const applied = applyCandidates(draft, token, pathMatches, {
      quote: quoted || pathMatches.some((item) => needsShellQuote(item.replace(/\/$/, ''))),
    })
    if (applied) return applied
  }

  return { nextDraft: draft }
}
