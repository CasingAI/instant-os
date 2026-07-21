import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import { loadGithubCachedAccount } from './github-account-cache.ts'

export type GithubExternalEditor = 'vscode' | 'files'

export type GithubDesktopPrefs = {
  version: 1
  externalEditor: GithubExternalEditor
  gitUserName: string
  gitUserEmail: string
  /** 提交时是否附加 Instant Agent 的 Co-authored-by trailer */
  includeCasingAiCoAuthor: boolean
}

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

export function externalEditorLabel(editor: GithubExternalEditor): string {
  return editor === 'files' ? '文件' : 'Virtual Studio Code Desktop'
}
