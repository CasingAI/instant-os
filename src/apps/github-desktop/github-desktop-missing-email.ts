import { hasGithubCredentials } from '../../os/github-credentials-storage.ts'
import { loadGithubCachedAccount } from './github-account-cache.ts'
import { loadGithubDesktopPrefs } from './github-desktop-prefs.ts'

/** 通知中心详情 slug */
export const GITHUB_DESKTOP_MISSING_EMAIL_SLUG = 'github-desktop:missing-email'

export const SHOW_GITHUB_DESKTOP_MISSING_EMAIL_NOTIFICATION_EVENT =
  'instant-os:show-github-desktop-missing-email-notification'

export const OPEN_GITHUB_DESKTOP_GIT_PREFS_EVENT = 'instant-os:open-github-desktop-git-prefs'

export const GITHUB_DESKTOP_MISSING_EMAIL_COPY = {
  bannerTitle: '无法获取 GitHub 邮箱',
  listTitle: '无法获取 GitHub 邮箱',
  listSubtitle: 'GitHub Desktop 正在使用默认 noreply 邮箱，请手动设置',
  detailPhase: 'Commit 作者',
  detailBody:
    '当前 Token 未能读取到账户邮箱，commit 将使用 login@users.noreply.github.com。请在 Git 设置中填写真实邮箱，或在钥匙串为 Token 授予邮箱读权限后刷新账户信息。',
  openSettingsButton: '打开 Git 设置',
  dismissButton: '忽略',
} as const

export function githubNoreplyEmailForLogin(login: string): string {
  return `${login.trim()}@users.noreply.github.com`
}

/**
 * 有账户缓存、拿不到真实邮箱，且当前提交邮箱等于（或将回退到）noreply。
 */
export function shouldWarnGithubDesktopMissingEmail(): boolean {
  if (!hasGithubCredentials()) return false
  const cached = loadGithubCachedAccount()
  const login = cached?.login?.trim()
  if (!login) return false
  if (cached?.email?.trim()) return false
  const noreply = githubNoreplyEmailForLogin(login)
  const prefsEmail = loadGithubDesktopPrefs().gitUserEmail.trim()
  const effective = prefsEmail || noreply
  return effective === noreply
}

export function messageForGithubDesktopMissingEmail(): {
  title: string
  subtitle: string
} {
  return {
    title: GITHUB_DESKTOP_MISSING_EMAIL_COPY.listTitle,
    subtitle: GITHUB_DESKTOP_MISSING_EMAIL_COPY.listSubtitle,
  }
}

export function showGithubDesktopMissingEmailNotification(): void {
  window.dispatchEvent(new CustomEvent(SHOW_GITHUB_DESKTOP_MISSING_EMAIL_NOTIFICATION_EVENT))
}

export function openGithubDesktopGitPrefs(): void {
  window.dispatchEvent(new CustomEvent(OPEN_GITHUB_DESKTOP_GIT_PREFS_EVENT))
}
