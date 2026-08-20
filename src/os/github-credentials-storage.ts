import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'

export type GithubCredentials = {
  version: 1
  token: string
}

export const GITHUB_CREDENTIALS_CHANGED_EVENT = 'instant-os:github-credentials-changed'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.githubCredentials

const DEFAULT_CREDENTIALS: GithubCredentials = {
  version: 1,
  token: '',
}

function normalizeGithubCredentials(raw: unknown): GithubCredentials {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_CREDENTIALS }
  }

  const record = raw as Record<string, unknown>
  const token = typeof record.token === 'string' ? record.token.trim() : ''

  return {
    version: 1,
    token,
  }
}

export function loadGithubCredentials(): GithubCredentials {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { ...DEFAULT_CREDENTIALS }
    }
    return normalizeGithubCredentials(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_CREDENTIALS }
  }
}

export function saveGithubCredentials(credentials: GithubCredentials): boolean {
  const payload = normalizeGithubCredentials(credentials)
  if (!writeLocalStorageItem(STORAGE_KEY, JSON.stringify(payload))) {
    return false
  }
  window.dispatchEvent(new CustomEvent(GITHUB_CREDENTIALS_CHANGED_EVENT))
  return true
}

export function clearGithubCredentials(): boolean {
  return saveGithubCredentials({ ...DEFAULT_CREDENTIALS })
}

export function hasGithubCredentials(): boolean {
  return loadGithubCredentials().token.length > 0
}

export function subscribeGithubCredentials(listener: () => void): () => void {
  window.addEventListener(GITHUB_CREDENTIALS_CHANGED_EVENT, listener)
  return () => {
    window.removeEventListener(GITHUB_CREDENTIALS_CHANGED_EVENT, listener)
  }
}
