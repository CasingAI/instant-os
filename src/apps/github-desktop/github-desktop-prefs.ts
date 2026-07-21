import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import { loadGithubCachedAccount } from './github-account-cache.ts'

export type GithubExternalEditor = 'vscode' | 'files'

export type GithubDesktopPrefs = {
  version: 1
  externalEditor: GithubExternalEditor
  gitUserName: string
  gitUserEmail: string
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.githubDesktopPrefs

const DEFAULT_PREFS: GithubDesktopPrefs = {
  version: 1,
  externalEditor: 'vscode',
  gitUserName: '',
  gitUserEmail: '',
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

/** 提交时用的作者：prefs 优先，缺省则用账户缓存拼一套 */
export function resolveGithubCommitAuthor(): { name: string; email: string } | undefined {
  const prefs = loadGithubDesktopPrefs()
  const cached = loadGithubCachedAccount()
  const name =
    prefs.gitUserName.trim() ||
    cached?.name?.trim() ||
    cached?.login?.trim() ||
    ''
  const email =
    prefs.gitUserEmail.trim() ||
    (cached?.login ? `${cached.login}@users.noreply.github.com` : '')
  if (!name || !email) return undefined
  return { name, email }
}

export function externalEditorLabel(editor: GithubExternalEditor): string {
  return editor === 'files' ? '文件' : 'Virtual Studio Code Desktop'
}
