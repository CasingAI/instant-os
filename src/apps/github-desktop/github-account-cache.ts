import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import { loadGithubCredentials } from '../../os/github-credentials-storage.ts'
import type { GithubUser } from './github-api.ts'

export type GithubCachedAccount = GithubUser & {
  /** 与当前 token 绑定；token 变更后缓存作废 */
  tokenFingerprint: string
  fetchedAt: number
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.githubAccountCache

/** 不存完整 token，只够判断是否换过凭据 */
export function githubTokenFingerprint(token: string): string {
  const trimmed = token.trim()
  if (!trimmed) return ''
  return `${trimmed.length}:${trimmed.slice(0, 4)}:${trimmed.slice(-4)}`
}

function normalizeCachedAccount(raw: unknown): GithubCachedAccount | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const login = typeof record.login === 'string' ? record.login.trim() : ''
  const tokenFingerprint =
    typeof record.tokenFingerprint === 'string' ? record.tokenFingerprint : ''
  const fetchedAt = typeof record.fetchedAt === 'number' ? record.fetchedAt : 0
  if (!login || !tokenFingerprint || fetchedAt <= 0) return undefined
  return {
    login,
    name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : undefined,
    email:
      typeof record.email === 'string' && record.email.trim() ? record.email.trim() : undefined,
    avatarUrl:
      typeof record.avatarUrl === 'string' && record.avatarUrl.trim()
        ? record.avatarUrl.trim()
        : undefined,
    tokenFingerprint,
    fetchedAt,
  }
}

export function loadGithubCachedAccount(): GithubCachedAccount | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return undefined
    const cached = normalizeCachedAccount(JSON.parse(raw))
    if (!cached) return undefined
    const fingerprint = githubTokenFingerprint(loadGithubCredentials().token)
    if (!fingerprint || cached.tokenFingerprint !== fingerprint) return undefined
    return cached
  } catch {
    return undefined
  }
}

export function saveGithubCachedAccount(user: GithubUser): GithubCachedAccount | undefined {
  const fingerprint = githubTokenFingerprint(loadGithubCredentials().token)
  if (!fingerprint || !user.login.trim()) return undefined
  const payload: GithubCachedAccount = {
    login: user.login.trim(),
    name: user.name?.trim() || undefined,
    email: user.email?.trim() || undefined,
    avatarUrl: user.avatarUrl?.trim() || undefined,
    tokenFingerprint: fingerprint,
    fetchedAt: Date.now(),
  }
  if (!writeLocalStorageItem(STORAGE_KEY, JSON.stringify(payload))) {
    return undefined
  }
  return payload
}

export function clearGithubCachedAccount(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
  // 账户元数据清除时同步丢掉头像字节（异步，不阻塞）
  void import('./github-avatar-cache.ts').then((mod) => mod.clearGithubAvatarCache())
}

export function cachedAccountAsUser(cached: GithubCachedAccount): GithubUser {
  return {
    login: cached.login,
    name: cached.name,
    email: cached.email,
    avatarUrl: cached.avatarUrl,
  }
}
