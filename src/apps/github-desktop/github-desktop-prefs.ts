import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import { getBuiltinAppName } from '../../os/builtin-app-name.ts'
import type { BuiltinAppId } from '../../os/types.ts'
import { loadGithubCachedAccount } from './github-account-cache.ts'

export type GithubExternalEditor = 'vscode' | 'files'

export type GithubDesktopPrefs = {
  version: 1
  externalEditor: GithubExternalEditor
  gitUserName: string
  gitUserEmail: string
  /** 提交时是否附加 Instant Agent 的 Co-authored-by trailer */
  includeCasingAiCoAuthor: boolean
  /** 仓库视图左侧边栏宽度（px） */
  sidebarWidth: number
}

export const GITHUB_DESKTOP_SIDEBAR_WIDTH_MIN = 180
export const GITHUB_DESKTOP_SIDEBAR_WIDTH_MAX = 480

export type GithubCommitIdentityDefaults = {
  gitUserName: string
  gitUserEmail: string
}

export type GithubCoAuthor = {
  name: string
  email: string
}

/**
 * Instant Agent 协作者身份（对齐 Cursor：品牌名 + 自有域名邮箱）。
 * 要在 GitHub 上显示头像，需另有账号绑定并验证此邮箱。
 */
export const INSTANT_AGENT_COAUTHOR: GithubCoAuthor = {
  name: 'Instant Agent',
  email: 'instantagent@casing-ai.com',
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.githubDesktopPrefs

const DEFAULT_PREFS: GithubDesktopPrefs = {
  version: 1,
  externalEditor: 'vscode',
  gitUserName: '',
  gitUserEmail: '',
  includeCasingAiCoAuthor: true,
  sidebarWidth: 250,
}

function normalizeSidebarWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_PREFS.sidebarWidth
  }
  return Math.min(
    GITHUB_DESKTOP_SIDEBAR_WIDTH_MAX,
    Math.max(GITHUB_DESKTOP_SIDEBAR_WIDTH_MIN, Math.round(value)),
  )
}

function normalizePrefs(raw: unknown): GithubDesktopPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS }
  const record = raw as Record<string, unknown>
  const editor = record.externalEditor === 'files' ? 'files' : 'vscode'
  return {
    version: 1,
    externalEditor: editor,
    gitUserName: typeof record.gitUserName === 'string' ? record.gitUserName : '',
    gitUserEmail: typeof record.gitUserEmail === 'string' ? record.gitUserEmail : '',
    includeCasingAiCoAuthor:
      typeof record.includeCasingAiCoAuthor === 'boolean'
        ? record.includeCasingAiCoAuthor
        : DEFAULT_PREFS.includeCasingAiCoAuthor,
    sidebarWidth: normalizeSidebarWidth(record.sidebarWidth),
  }
}

export function loadGithubDesktopPrefs(): GithubDesktopPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    return normalizePrefs(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function saveGithubDesktopPrefs(prefs: GithubDesktopPrefs): boolean {
  const payload = normalizePrefs(prefs)
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(payload))
}

export function updateGithubDesktopPrefs(
  patch: Partial<Omit<GithubDesktopPrefs, 'version'>>,
): GithubDesktopPrefs {
  const next = normalizePrefs({ ...loadGithubDesktopPrefs(), ...patch })
  saveGithubDesktopPrefs(next)
  return next
}

/**
 * 设置里「默认」提交身份：姓名用账户 name/login；
 * 邮箱优先用账户主邮箱，否则回退 GitHub noreply。
 */
export function defaultGithubCommitIdentity(account?: {
  login: string
  name?: string
  email?: string
}): GithubCommitIdentityDefaults | undefined {
  const cached = account ?? loadGithubCachedAccount()
  const login = cached?.login?.trim()
  if (!login) return undefined
  const email = cached?.email?.trim() || `${login}@users.noreply.github.com`
  return {
    gitUserName: cached?.name?.trim() || login,
    gitUserEmail: email,
  }
}

/** 提交时用的作者：prefs 优先，缺省则用账户缓存拼一套 */
export function resolveGithubCommitAuthor(): { name: string; email: string } | undefined {
  const prefs = loadGithubDesktopPrefs()
  const defaults = defaultGithubCommitIdentity()
  const name = prefs.gitUserName.trim() || defaults?.gitUserName || ''
  const email = prefs.gitUserEmail.trim() || defaults?.gitUserEmail || ''
  if (!name || !email) return undefined
  return { name, email }
}

export function formatCoAuthorTrailer(coAuthor: GithubCoAuthor): string {
  return `Co-authored-by: ${coAuthor.name} <${coAuthor.email}>`
}

const CO_AUTHOR_TRAILER_RE = /^Co-authored-by:\s*(.+?)\s*<([^<>\s]+)>\s*$/i

/** 从 commit message 解析 Co-authored-by trailer */
export function parseCoAuthorTrailers(message: string): GithubCoAuthor[] {
  const result: GithubCoAuthor[] = []
  const seen = new Set<string>()
  for (const rawLine of message.split(/\r?\n/)) {
    const match = CO_AUTHOR_TRAILER_RE.exec(rawLine.trim())
    if (!match) continue
    const name = match[1]?.trim() ?? ''
    const email = match[2]?.trim() ?? ''
    if (!name || !email) continue
    const key = `${name.toLowerCase()}\0${email.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ name, email })
  }
  return result
}

/** 展示用：协作者姓名列表 */
export function formatCoAuthorNames(coAuthors: readonly GithubCoAuthor[]): string {
  return coAuthors
    .map((entry) => entry.name.trim())
    .filter((name) => name.length > 0)
    .join('、')
}

/** 组装提交说明；可选附加协作者 trailer（与正文空一行） */
export function buildGithubCommitMessage(
  summary: string,
  description: string,
  coAuthors: readonly GithubCoAuthor[] = [],
): string {
  const head = summary.trim()
  const body = description.trim()
  const trailers = coAuthors
    .map((entry) => formatCoAuthorTrailer(entry))
    .filter((line) => line.length > 0)
  const parts: string[] = []
  if (head) parts.push(head)
  if (body) parts.push(body)
  if (trailers.length > 0) parts.push(trailers.join('\n'))
  return parts.join('\n\n')
}

export function resolveCommitCoAuthors(
  prefs: Pick<GithubDesktopPrefs, 'includeCasingAiCoAuthor'> = loadGithubDesktopPrefs(),
): GithubCoAuthor[] {
  return prefs.includeCasingAiCoAuthor ? [INSTANT_AGENT_COAUTHOR] : []
}

const EXTERNAL_EDITOR_APP_IDS: Record<GithubExternalEditor, BuiltinAppId> = {
  vscode: 'vscode',
  files: 'files',
}

export function externalEditorLabel(editor: GithubExternalEditor): string {
  return getBuiltinAppName(EXTERNAL_EDITOR_APP_IDS[editor])
}
