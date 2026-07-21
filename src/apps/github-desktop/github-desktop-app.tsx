import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { GithubDesktopIcon } from '../../icons/app-icons.tsx'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import {
  hasGithubCredentials,
  subscribeGithubCredentials,
} from '../../os/github-credentials-storage.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import {
  isProxyServerConnected,
  subscribeProxyServerSettings,
  openSettingsProxyServerView,
} from '../../os/proxy-server-settings-storage.ts'
import { WindowModal } from '../../window/window-modal.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'
import { SettingsSwitchRow } from '../../ui/settings-switch-row.tsx'
import '../settings/settings.css'
import { filesWatch } from '../files/files-api.ts'
import {
  GITHUB_ZIPBALL_PROXY_REQUIRED_MESSAGE,
  githubGetAuthenticatedUser,
  githubGetCommit,
  githubListBranches,
  githubListUserRepos,
  type GithubBranch,
  type GithubCommitDetail,
  type GithubCommitSummary,
  type GithubRepoSummary,
  type GithubUser,
} from './github-api.ts'
import {
  cachedAccountAsUser,
  clearGithubCachedAccount,
  loadGithubCachedAccount,
  saveGithubCachedAccount,
} from './github-account-cache.ts'
import {
  clearGithubAvatarCache,
  ensureGithubAvatarCached,
  loadGithubAvatarObjectUrl,
} from './github-avatar-cache.ts'
import {
  buildChangePreview,
  detectGithubChanges,
  ensureBaselineIfClean,
  rebuildGithubBaseline,
  type GithubChange,
  type GithubChangePreview,
} from './github-changes.ts'
import { commitAndPushGithubChanges, summarizeChanges } from './github-commit.ts'
import { GithubDesktopDiffView } from './github-desktop-diff-view.tsx'
import {
  buildGithubCommitMessage,
  defaultGithubCommitIdentity,
  externalEditorLabel,
  loadGithubDesktopPrefs,
  resolveCommitCoAuthors,
  updateGithubDesktopPrefs,
  type GithubDesktopPrefs,
  type GithubExternalEditor,
} from './github-desktop-prefs.ts'
import {
  OPEN_GITHUB_DESKTOP_GIT_PREFS_EVENT,
  shouldWarnGithubDesktopMissingEmail,
  showGithubDesktopMissingEmailNotification,
} from './github-desktop-missing-email.ts'
import {
  dismissGithubDesktopMissingEmailNotification,
} from './github-desktop-missing-email-notification-store.ts'
import { fetchGithubRemote } from './github-fetch.ts'
import { pullGithubRepository, switchGithubBranch } from './github-pull.ts'
import { githubRepoRootPath } from './github-repo-paths.ts'
import {
  currentHeadSha,
  deleteGithubRepoMeta,
  getCachedGithubCommitDetail,
  getCachedGithubCommitList,
  getGithubRepoMeta,
  listGithubLocalCommits,
  listGithubRepoMeta,
  putCachedGithubCommitDetail,
  saveGithubRepoMeta,
  type GithubRepoSyncMeta,
} from './github-sync-meta.ts'
import {
  cloneGithubRepository,
  deleteLocalGithubRepository,
} from './github-working-tree.ts'
import './github-desktop.css'

const APP_ID = 'github-desktop' as const

type View =
  | { kind: 'home' }
  | { kind: 'cloning'; owner: string; repo: string }
  | { kind: 'repo'; meta: GithubRepoSyncMeta }

type SidebarTab = 'changes' | 'history'

type BusyKind =
  | 'pull'
  | 'fetch'
  | 'commit'
  | 'switch'
  | 'clone'
  | 'load'
  | 'delete'
  | 'rebuild'
  | undefined

function changeKindMark(kind: GithubChange['kind']): string {
  if (kind === 'added') return 'A'
  if (kind === 'deleted') return 'D'
  return 'M'
}

function commitSummaryLine(message: string): string {
  const line = message.split('\n')[0]?.trim()
  return line || '(无说明)'
}

function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

/** 对齐 Desktop「Last fetched …」/「Never fetched」 */
function formatLastFetchedLabel(lastFetchedAt: number | undefined, nowMs: number): string {
  if (lastFetchedAt === undefined) return '从未获取'
  const deltaSec = Math.max(0, Math.floor((nowMs - lastFetchedAt) / 1000))
  if (deltaSec < 45) return '上次获取 · 刚刚'
  if (deltaSec < 90) return '上次获取 · 1 分钟前'
  if (deltaSec < 3600) return `上次获取 · ${Math.floor(deltaSec / 60)} 分钟前`
  if (deltaSec < 5400) return '上次获取 · 1 小时前'
  if (deltaSec < 86400) return `上次获取 · ${Math.floor(deltaSec / 3600)} 小时前`
  if (deltaSec < 172800) return '上次获取 · 昨天'
  if (deltaSec < 86400 * 30) return `上次获取 · ${Math.floor(deltaSec / 86400)} 天前`
  const date = new Date(lastFetchedAt)
  return `上次获取 · ${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

function CaretIcon() {
  return (
    <svg viewBox="0 0 10 6" width="10" height="6" fill="currentColor" aria-hidden="true">
      <path d="M0 0l5 6 5-6z" />
    </svg>
  )
}

function RepoIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 1 0-2h8ZM5 6.25a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5A.75.75 0 0 1 5 6.25Zm.75 2.25h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1 0-1.5Z" />
      <path d="M0 2.5A2.5 2.5 0 0 1 2.5 0h1a.75.75 0 0 1 0 1.5h-1A1 1 0 0 0 1.5 2.5v9A1 1 0 0 0 2.5 13h1a.75.75 0 0 1 0 1.5h-1A2.5 2.5 0 0 1 0 11.5Z" />
    </svg>
  )
}

function BranchIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
    </svg>
  )
}

function SyncIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M8 2.5c1.645 0 3.123.722 4.131 1.869l-1.204 1.204a.25.25 0 0 0 .177.427h3.646a.25.25 0 0 0 .25-.25V2.104a.25.25 0 0 0-.427-.177l-1.38 1.38A7.001 7.001 0 0 0 1.05 7.16a.75.75 0 1 0 1.49.178A5.501 5.501 0 0 1 8 2.5zm6.294 5.505a.75.75 0 0 0-.833.656 5.501 5.501 0 0 1-9.592 2.97l1.204-1.204A.25.25 0 0 0 4.896 10H1.25a.25.25 0 0 0-.25.25v3.646c0 .223.27.335.427.177l1.38-1.38A7.001 7.001 0 0 0 14.95 8.84a.75.75 0 0 0-.657-.834z" />
    </svg>
  )
}

function ArrowDownIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M13.03 8.22a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.47 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018l2.97 2.97V3.75a.75.75 0 0 1 1.5 0v7.44l2.97-2.97a.75.75 0 0 1 1.06 0Z" />
    </svg>
  )
}

function mergeLocalHistoryLists(
  local: Array<{
    sha: string
    message: string
    author: string
    committedAt: number
  }>,
  cached: GithubCommitSummary[] | undefined,
): GithubCommitSummary[] {
  const seen = new Set<string>()
  const out: GithubCommitSummary[] = []
  for (const item of local) {
    if (seen.has(item.sha)) continue
    seen.add(item.sha)
    out.push({
      sha: item.sha,
      message: item.message,
      authorName: item.author,
      authorDate: new Date(item.committedAt).toISOString(),
    })
  }
  for (const item of cached ?? []) {
    if (seen.has(item.sha)) continue
    seen.add(item.sha)
    out.push(item)
  }
  return out
}

export function GithubDesktopApp() {
  const { setAppWindowTitle, closeWindowsForApp, minimizeWindow, windows, openApp } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const modal = useWindowModal()

  const [hasToken, setHasToken] = useState(() => hasGithubCredentials())
  const [proxyConnected, setProxyConnected] = useState(() => isProxyServerConnected())
  const [view, setView] = useState<View>({ kind: 'home' })
  const [localRepos, setLocalRepos] = useState<GithubRepoSyncMeta[]>([])
  const [user, setUser] = useState<GithubUser | undefined>()
  /** 本地缓存头像的 blob URL；优先于远程 avatarUrl */
  const [avatarDisplayUrl, setAvatarDisplayUrl] = useState<string | undefined>()
  const [busyKind, setBusyKind] = useState<BusyKind>()
  const [progressLabel, setProgressLabel] = useState<string | undefined>()
  /** 0–1，对齐 GitHub Desktop 工具栏按钮进度条；未知进度时用不确定动画 */
  const [progressValue, setProgressValue] = useState<number | undefined>()
  const [repoFoldoutOpen, setRepoFoldoutOpen] = useState(false)
  const [branchFoldoutOpen, setBranchFoldoutOpen] = useState(false)
  const [syncMenuOpen, setSyncMenuOpen] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('changes')

  const [cloneDialogOpen, setCloneDialogOpen] = useState(false)
  const [cloneDialogLoading, setCloneDialogLoading] = useState(false)
  const [cloneDialogError, setCloneDialogError] = useState<string | undefined>()
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [prefsTab, setPrefsTab] = useState<'accounts' | 'integrations' | 'git'>('accounts')
  const [desktopPrefs, setDesktopPrefs] = useState<GithubDesktopPrefs>(() => loadGithubDesktopPrefs())
  const [accountRefreshing, setAccountRefreshing] = useState(false)
  const [accountError, setAccountError] = useState<string | undefined>()
  const [cloneFilter, setCloneFilter] = useState('')
  const [remoteRepos, setRemoteRepos] = useState<GithubRepoSummary[]>([])
  const [cloneOwner, setCloneOwner] = useState('')
  const [cloneRepo, setCloneRepo] = useState('')
  const [cloneBranch, setCloneBranch] = useState('')
  const [cloneBranches, setCloneBranches] = useState<GithubBranch[]>([])

  const [changes, setChanges] = useState<GithubChange[]>([])
  const [selectedPath, setSelectedPath] = useState<string | undefined>()
  const [diffPreview, setDiffPreview] = useState<GithubChangePreview | undefined>()
  const [diffLoading, setDiffLoading] = useState(false)
  const [commitSummary, setCommitSummary] = useState('')
  const [commitDescription, setCommitDescription] = useState('')
  const [branches, setBranches] = useState<GithubBranch[]>([])
  /** 最近一次 Fetch 看到的远端 tip；与本地 tip 不同时主按钮变为「拉取」 */
  const [remoteHeadSha, setRemoteHeadSha] = useState<string | undefined>()
  /** 推动「上次获取」相对时间刷新 */
  const [nowMs, setNowMs] = useState(() => Date.now())

  const [historyCommits, setHistoryCommits] = useState<GithubCommitSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | undefined>()
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | undefined>()
  const [historyDetail, setHistoryDetail] = useState<GithubCommitDetail | undefined>()
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false)
  const [selectedHistoryFile, setSelectedHistoryFile] = useState<string | undefined>()

  const busy = busyKind !== undefined
  const showToolbar = view.kind === 'repo' || view.kind === 'cloning'
  const repoHeadSha = view.kind === 'repo' ? currentHeadSha(view.meta) : ''
  const canPull =
    view.kind === 'repo' &&
    Boolean(remoteHeadSha) &&
    Boolean(repoHeadSha) &&
    remoteHeadSha !== repoHeadSha

  const banner = useMemo(() => {
    if (!hasToken) {
      return {
        message: '尚未配置 GitHub Token。请先在钥匙串中添加 Personal Access Token。',
        actionLabel: '打开钥匙串',
        onAction: () => openApp('keychain'),
      }
    }
    if (!proxyConnected) {
      return {
        message: GITHUB_ZIPBALL_PROXY_REQUIRED_MESSAGE,
        actionLabel: '打开代理设置',
        onAction: () => {
          openApp('settings')
          openSettingsProxyServerView()
        },
      }
    }
    return undefined
  }, [hasToken, proxyConnected, openApp])

  useEffect(() => {
    setAppWindowTitle(APP_ID, 'GitHub Desktop')
  }, [setAppWindowTitle])

  useEffect(() => {
    if (view.kind !== 'repo') return
    const tick = () => setNowMs(Date.now())
    tick()
    const id = window.setInterval(tick, 30_000)
    return () => window.clearInterval(id)
  }, [view.kind])

  useEffect(() => {
    return subscribeGithubCredentials(() => {
      setHasToken(hasGithubCredentials())
    })
  }, [])

  useEffect(() => {
    return subscribeProxyServerSettings(() => {
      setProxyConnected(isProxyServerConnected())
    })
  }, [])

  const openProxySettings = useCallback(() => {
    openApp('settings')
    openSettingsProxyServerView()
  }, [openApp])

  const refreshLocalRepos = useCallback(async () => {
    const list = await listGithubRepoMeta()
    setLocalRepos(list)
  }, [])

  useEffect(() => {
    void refreshLocalRepos()
  }, [refreshLocalRepos])

  useEffect(() => {
    if (!hasToken) {
      clearGithubCachedAccount()
      void clearGithubAvatarCache()
      setUser(undefined)
      setAvatarDisplayUrl(undefined)
      return
    }
    // 只读本地缓存，打开应用绝不打 /user
    const cached = loadGithubCachedAccount()
    setUser(cached ? cachedAccountAsUser(cached) : undefined)
    let cancelled = false
    void (async () => {
      const local = await loadGithubAvatarObjectUrl()
      if (cancelled) return
      if (local) {
        setAvatarDisplayUrl(local)
        return
      }
      // 有账户缓存但还没有头像字节：代理可用时后台补拉
      if (cached?.avatarUrl) {
        const next = await ensureGithubAvatarCached(cached.avatarUrl)
        if (!cancelled && next) setAvatarDisplayUrl(next)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hasToken])

  const refreshAccountProfile = useCallback(async () => {
    if (!hasToken) {
      setUser(undefined)
      setAvatarDisplayUrl(undefined)
      setAccountError('尚未配置 Token，请先在钥匙串中添加。')
      return
    }
    setAccountRefreshing(true)
    setAccountError(undefined)
    try {
      const next = await githubGetAuthenticatedUser()
      saveGithubCachedAccount(next)
      setUser(next)
      const avatarUrl = await ensureGithubAvatarCached(next.avatarUrl)
      setAvatarDisplayUrl(avatarUrl)
      const prefs = loadGithubDesktopPrefs()
      const defaults = defaultGithubCommitIdentity(next)
      if (defaults) {
        const noreply = `${next.login}@users.noreply.github.com`
        const shouldFillName = !prefs.gitUserName.trim()
        const shouldFillEmail =
          !prefs.gitUserEmail.trim() ||
          (Boolean(next.email?.trim()) && prefs.gitUserEmail.trim() === noreply)
        if (shouldFillName || shouldFillEmail) {
          setDesktopPrefs(
            updateGithubDesktopPrefs({
              gitUserName: shouldFillName ? defaults.gitUserName : prefs.gitUserName,
              gitUserEmail: shouldFillEmail ? defaults.gitUserEmail : prefs.gitUserEmail,
            }),
          )
        }
      }
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : String(err))
    } finally {
      setAccountRefreshing(false)
    }
  }, [hasToken])

  const openPreferences = useCallback((tab: 'accounts' | 'integrations' | 'git' = 'accounts') => {
    setPrefsOpen(true)
    setPrefsTab(tab)
    setAccountError(undefined)
    const prefs = loadGithubDesktopPrefs()
    // 首次打开 Git：用账户缓存预填空姓名/邮箱
    const defaults = defaultGithubCommitIdentity()
    let next = prefs
    if (defaults && (!prefs.gitUserName || !prefs.gitUserEmail)) {
      next = updateGithubDesktopPrefs({
        gitUserName: prefs.gitUserName || defaults.gitUserName,
        gitUserEmail: prefs.gitUserEmail || defaults.gitUserEmail,
      })
    }
    setDesktopPrefs(next)
    if (hasToken && !loadGithubCachedAccount()) {
      void refreshAccountProfile()
    }
  }, [hasToken, refreshAccountProfile])

  const closePreferences = useCallback(() => {
    setPrefsOpen(false)
    setAccountError(undefined)
  }, [])

  // 每次打开应用（挂载 / Token 就绪）时若仍缺真实邮箱，弹出通知横幅
  useEffect(() => {
    if (shouldWarnGithubDesktopMissingEmail()) {
      showGithubDesktopMissingEmailNotification()
    } else {
      dismissGithubDesktopMissingEmailNotification()
    }
  }, [hasToken])

  // 用户改邮箱或刷新到真实邮箱后，条件解除则清掉通知（不在此处重新激活，以免覆盖「忽略」）
  useEffect(() => {
    if (!shouldWarnGithubDesktopMissingEmail()) {
      dismissGithubDesktopMissingEmailNotification()
    }
  }, [desktopPrefs.gitUserEmail, user?.email])

  useEffect(() => {
    const handleOpenGitPrefs = () => {
      openPreferences('git')
    }
    window.addEventListener(OPEN_GITHUB_DESKTOP_GIT_PREFS_EVENT, handleOpenGitPrefs)
    return () => window.removeEventListener(OPEN_GITHUB_DESKTOP_GIT_PREFS_EVENT, handleOpenGitPrefs)
  }, [openPreferences])

  const patchDesktopPrefs = useCallback((patch: Partial<Omit<GithubDesktopPrefs, 'version'>>) => {
    setDesktopPrefs(updateGithubDesktopPrefs(patch))
  }, [])

  const openInExternalEditor = useCallback(
    (owner: string, repo: string) => {
      const editor = loadGithubDesktopPrefs().externalEditor
      openApp(editor, {
        documentId: githubRepoRootPath(owner, repo),
      })
    },
    [openApp],
  )

  const refreshRepoState = useCallback(async (meta: GithubRepoSyncMeta) => {
    const latest = (await getGithubRepoMeta(meta.owner, meta.repo)) ?? meta
    setView({ kind: 'repo', meta: latest })
    setSidebarTab('changes')
    setRepoFoldoutOpen(false)
    const nextChanges = await detectGithubChanges(latest)
    // 只本地补齐基线，打开仓库绝不打 Contents / zip / branches API
    await ensureBaselineIfClean(latest, nextChanges.length > 0)
    setChanges(nextChanges)
    setSelectedPath((prev) => {
      if (prev && nextChanges.some((item) => item.path === prev)) return prev
      return nextChanges[0]?.path
    })
    // 分支列表用本地快照；远端分支名在「获取 / 拉取」后更新
    setBranches((prev) => {
      const localNames = Object.keys(latest.branches)
      if (localNames.length === 0) {
        return [
          {
            name: latest.currentBranch,
            commitSha: currentHeadSha(latest),
            protected: false,
          },
        ]
      }
      const fromMeta = localNames.map((name) => ({
        name,
        commitSha: latest.branches[name]?.tipSha ?? '',
        protected: false,
      }))
      if (prev.length === 0) return fromMeta
      const known = new Set(fromMeta.map((item) => item.name))
      const extras = prev.filter((item) => !known.has(item.name))
      return [...fromMeta, ...extras]
    })
    // 用上次 Fetch 缓存的 tip 恢复「获取 / 拉取」按钮状态（不联网）
    const cachedList = await getCachedGithubCommitList(latest.owner, latest.repo)
    setRemoteHeadSha(cachedList?.tipSha)
  }, [])

  const refreshRepoChanges = useCallback(async (owner: string, repo: string) => {
    const latest = await getGithubRepoMeta(owner, repo)
    if (!latest) return
    setView((prev) =>
      prev.kind === 'repo' && prev.meta.owner === latest.owner && prev.meta.repo === latest.repo
        ? { kind: 'repo', meta: latest }
        : prev,
    )
    const nextChanges = await detectGithubChanges(latest)
    await ensureBaselineIfClean(latest, nextChanges.length > 0)
    setChanges(nextChanges)
    setSelectedPath((prev) => {
      if (prev && nextChanges.some((item) => item.path === prev)) return prev
      return nextChanges[0]?.path
    })
  }, [])

  const repoWatchKey =
    view.kind === 'repo' ? `${view.meta.owner}/${view.meta.repo}` : undefined

  useEffect(() => {
    if (!repoWatchKey) return
    const [owner, repo] = repoWatchKey.split('/')
    if (!owner || !repo) return
    const root = githubRepoRootPath(owner, repo)
    let timer: number | undefined
    let cancelled = false
    const unwatch = filesWatch(root, () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (cancelled) return
        void refreshRepoChanges(owner, repo)
      }, 100)
    })
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      unwatch()
    }
  }, [repoWatchKey, refreshRepoChanges])

  useEffect(() => {
    if (view.kind !== 'repo' || !selectedPath) {
      setDiffPreview(undefined)
      setDiffLoading(false)
      return
    }
    const change = changes.find((item) => item.path === selectedPath)
    if (!change) {
      setDiffPreview(undefined)
      setDiffLoading(false)
      return
    }
    let cancelled = false
    setDiffLoading(true)
    setDiffPreview((prev) => (prev?.path === change.path ? prev : undefined))
    void buildChangePreview(view.meta, change).then((preview) => {
      if (cancelled) return
      setDiffPreview(preview)
      setDiffLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [view, selectedPath, changes])

  useEffect(() => {
    if (view.kind !== 'repo' || sidebarTab !== 'history') return
    const tip = currentHeadSha(view.meta)
    if (!tip) {
      setHistoryCommits([])
      setHistoryError('当前分支缺少 tip')
      return
    }
    let cancelled = false
    setHistoryLoading(true)
    setHistoryError(undefined)
    // History 默认只读本地：账本 + 上次拉取缓存的列表，不自动打 API
    void (async () => {
      try {
        const [cached, local] = await Promise.all([
          getCachedGithubCommitList(view.meta.owner, view.meta.repo),
          listGithubLocalCommits(view.meta.owner, view.meta.repo),
        ])
        if (cancelled) return
        const list = mergeLocalHistoryLists(local, cached?.commits)
        setHistoryCommits(list)
        setHistoryError(undefined)
        setSelectedCommitSha((prev) => {
          if (prev && list.some((item) => item.sha === prev)) return prev
          // 不自动选中第一条，避免一进 History 就为详情打 API
          return undefined
        })
        setHistoryLoading(false)
      } catch (err) {
        if (cancelled) return
        setHistoryCommits([])
        setHistoryError(err instanceof Error ? err.message : String(err))
        setHistoryLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [view, sidebarTab])

  const showError = useCallback(
    async (title: string, err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      await modal.alert({ title, message })
    },
    [modal],
  )

  useEffect(() => {
    if (view.kind !== 'repo' || sidebarTab !== 'history' || !selectedCommitSha) {
      setHistoryDetail(undefined)
      setSelectedHistoryFile(undefined)
      return
    }
    let cancelled = false
    const { owner, repo } = view.meta
    const sha = selectedCommitSha
    setHistoryDetailLoading(true)
    setHistoryDetail(undefined)

    void (async () => {
      try {
        const cached = await getCachedGithubCommitDetail(owner, repo, sha)
        if (cancelled) return
        if (cached) {
          setHistoryDetail(cached)
          setSelectedHistoryFile(cached.files[0]?.filename)
          setHistoryDetailLoading(false)
          // 刷新 LRU，不阻塞 UI
          void putCachedGithubCommitDetail(owner, repo, cached)
          return
        }
        const detail = await githubGetCommit(owner, repo, sha)
        if (cancelled) return
        setHistoryDetail(detail)
        setSelectedHistoryFile(detail.files[0]?.filename)
        setHistoryDetailLoading(false)
        void putCachedGithubCommitDetail(owner, repo, detail)
      } catch (err) {
        if (cancelled) return
        setHistoryDetail(undefined)
        setHistoryDetailLoading(false)
        await showError('加载提交详情失败', err)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [view, sidebarTab, selectedCommitSha, showError])

  const runBusy = useCallback(
    async (kind: Exclude<BusyKind, undefined>, label: string, errorTitle: string, task: () => Promise<void>) => {
      setBusyKind(kind)
      setProgressLabel(label)
      setProgressValue(0.08)
      try {
        await task()
        setProgressLabel(undefined)
        setProgressValue(undefined)
      } catch (err) {
        setProgressLabel(undefined)
        setProgressValue(undefined)
        await showError(errorTitle, err)
      } finally {
        setBusyKind(undefined)
      }
    },
    [showError],
  )

  const reportSyncProgress = useCallback((message: string, fraction?: number) => {
    setProgressLabel(message)
    if (fraction !== undefined) {
      setProgressValue(Math.min(0.98, Math.max(0.08, fraction)))
      return
    }
    // 常见文案 → 粗粒度进度，让按钮进度条能动起来
    if (message.includes('检查远端') || message.includes('检查远端分支')) {
      setProgressValue(0.2)
    } else if (message.includes('分支列表') || message.includes('比较本地')) {
      setProgressValue(0.45)
    } else if (message.includes('提交历史') || message.includes('压缩包')) {
      setProgressValue(0.7)
    } else if (message.includes('应用变更') || message.includes('写入文件')) {
      const match = /(\d+)\s*\/\s*(\d+)/.exec(message)
      if (match) {
        const done = Number(match[1])
        const total = Number(match[2])
        if (total > 0) setProgressValue(0.35 + (done / total) * 0.55)
        else setProgressValue(0.6)
      } else {
        setProgressValue(0.6)
      }
    } else if (message.includes('更新同步') || message.includes('建立同步')) {
      setProgressValue(0.92)
    } else if (message.includes('已是最新')) {
      setProgressValue(1)
    } else {
      setProgressValue((prev) => Math.min(0.9, (prev ?? 0.15) + 0.08))
    }
  }, [])

  const closeCloneDialog = useCallback(() => {
    setCloneDialogOpen(false)
    setCloneDialogError(undefined)
    setCloneFilter('')
  }, [])

  const openClone = useCallback(async () => {
    if (!hasToken) {
      await modal.alert({
        title: '需要登录',
        message: '请先在钥匙串中配置 GitHub Personal Access Token，然后再克隆仓库。',
      })
      return
    }
    setCloneDialogOpen(true)
    setCloneDialogError(undefined)
    setCloneFilter('')
    setCloneDialogLoading(true)
    try {
      const repos = await githubListUserRepos({ perPage: 50 })
      setRemoteRepos(repos)
      const first = repos[0]
      if (first) {
        setCloneOwner(first.owner)
        setCloneRepo(first.name)
        setCloneBranch(first.defaultBranch)
        const branchList = await githubListBranches(first.owner, first.name)
        setCloneBranches(branchList)
      } else {
        setCloneOwner('')
        setCloneRepo('')
        setCloneBranch('')
        setCloneBranches([])
      }
    } catch (err) {
      setCloneDialogError(err instanceof Error ? err.message : String(err))
      setRemoteRepos([])
    } finally {
      setCloneDialogLoading(false)
    }
  }, [hasToken, modal])

  const handleSelectRemote = useCallback(
    async (fullName: string) => {
      const hit = remoteRepos.find((item) => item.fullName === fullName)
      if (!hit) return
      setCloneOwner(hit.owner)
      setCloneRepo(hit.name)
      setCloneBranch(hit.defaultBranch)
      setCloneDialogError(undefined)
      try {
        const branchList = await githubListBranches(hit.owner, hit.name)
        setCloneBranches(branchList)
      } catch (err) {
        setCloneDialogError(err instanceof Error ? err.message : String(err))
      }
    },
    [remoteRepos],
  )

  const applyFetchResult = useCallback(
    async (
      meta: GithubRepoSyncMeta,
      result: Awaited<ReturnType<typeof fetchGithubRemote>>,
    ) => {
      const fetchedAt = Date.now()
      const nextMeta: GithubRepoSyncMeta = {
        ...meta,
        lastFetchedAt: fetchedAt,
        updatedAt: fetchedAt,
      }
      await saveGithubRepoMeta(nextMeta)
      setView((prev) =>
        prev.kind === 'repo' &&
        prev.meta.owner === nextMeta.owner &&
        prev.meta.repo === nextMeta.repo
          ? { kind: 'repo', meta: nextMeta }
          : prev,
      )
      setRemoteHeadSha(result.remoteSha)
      setBranches(result.branches)
      const local = await listGithubLocalCommits(meta.owner, meta.repo)
      setHistoryCommits(mergeLocalHistoryLists(local, result.commits))
      setHistoryError(undefined)
      setSelectedCommitSha((prev) => {
        if (prev && result.commits.some((item) => item.sha === prev)) return prev
        return undefined
      })
    },
    [],
  )

  /** 克隆 / 提交 / 拉取 / 重建后：统一走 Fetch（不动工作区）刷新远端缓存 */
  const syncRemoteCaches = useCallback(
    async (meta: GithubRepoSyncMeta) => {
      try {
        const result = await fetchGithubRemote({ meta })
        await applyFetchResult(meta, result)
      } catch {
        // History 仍可读本地缓存；主流程不因刷新失败而中断
      }
    },
    [applyFetchResult],
  )

  const handleFetch = useCallback(() => {
    if (view.kind !== 'repo') return
    void runBusy('fetch', '正在获取…', '获取失败', async () => {
      const result = await fetchGithubRemote({
        meta: view.meta,
        onProgress: reportSyncProgress,
      })
      await applyFetchResult(view.meta, result)
      // 对齐 Desktop：不弹窗；若远端超前，主按钮会变成「拉取」
    })
  }, [view, runBusy, applyFetchResult, reportSyncProgress])

  const handlePull = useCallback(() => {
    if (view.kind !== 'repo') return
    void runBusy('pull', '正在拉取…', '拉取失败', async () => {
      const next = await pullGithubRepository({
        meta: view.meta,
        onProgress: reportSyncProgress,
      })
      await refreshRepoState(next)
      await syncRemoteCaches(next)
    })
  }, [view, runBusy, refreshRepoState, syncRemoteCaches, reportSyncProgress])

  /** Desktop 式：同一主按钮，Fetch / Pull 随远端是否超前切换 */
  const handleFetchOrPull = useCallback(() => {
    if (canPull) handlePull()
    else handleFetch()
  }, [canPull, handleFetch, handlePull])

  const handleClone = useCallback(async () => {
    if (!proxyConnected) {
      setCloneDialogError(GITHUB_ZIPBALL_PROXY_REQUIRED_MESSAGE)
      return
    }
    const owner = cloneOwner.trim()
    const repo = cloneRepo.trim()
    if (!owner || !repo) {
      setCloneDialogError('请选择要克隆的仓库')
      return
    }
    closeCloneDialog()
    setView({ kind: 'cloning', owner, repo })
    setBusyKind('clone')
    setProgressLabel('正在准备克隆…')
    try {
      const meta = await cloneGithubRepository({
        owner,
        repo,
        branch: cloneBranch.trim() || undefined,
        onProgress: setProgressLabel,
      })
      await refreshLocalRepos()
      await refreshRepoState(meta)
      await syncRemoteCaches(meta)
      setProgressLabel(undefined)
    } catch (err) {
      setProgressLabel(undefined)
      setView({ kind: 'home' })
      await showError('克隆失败', err)
    } finally {
      setBusyKind(undefined)
    }
  }, [
    proxyConnected,
    cloneOwner,
    cloneRepo,
    cloneBranch,
    closeCloneDialog,
    refreshLocalRepos,
    refreshRepoState,
    syncRemoteCaches,
    showError,
  ])

  const handleOpenLocal = useCallback(
    (meta: GithubRepoSyncMeta) => {
      setRepoFoldoutOpen(false)
      void runBusy('load', '加载仓库…', '打开仓库失败', async () => {
        await refreshRepoState(meta)
      })
    },
    [runBusy, refreshRepoState],
  )

  const handleDeleteLocal = useCallback(
    async (meta: GithubRepoSyncMeta) => {
      const confirmed = await modal.confirm({
        title: '删除本地仓库',
        message: `确定删除本地副本 ${meta.owner}/${meta.repo}？不会影响 GitHub 上的远端仓库。`,
        confirmLabel: '删除',
        confirmTone: 'danger',
      })
      if (!confirmed) return
      void runBusy('delete', '删除本地仓库…', '删除失败', async () => {
        await deleteLocalGithubRepository(meta.owner, meta.repo)
        await deleteGithubRepoMeta(meta.owner, meta.repo)
        await refreshLocalRepos()
        setView({ kind: 'home' })
        setRepoFoldoutOpen(false)
      })
    },
    [modal, runBusy, refreshLocalRepos],
  )

  const handleCommit = useCallback(() => {
    if (view.kind !== 'repo') return
    const message = buildGithubCommitMessage(
      commitSummary,
      commitDescription,
      resolveCommitCoAuthors(desktopPrefs),
    )
    if (!message.trim()) return
    void runBusy('commit', '提交并推送…', '提交失败', async () => {
      const next = await commitAndPushGithubChanges({
        meta: view.meta,
        message,
      })
      setCommitSummary('')
      setCommitDescription('')
      await refreshRepoState(next)
      await syncRemoteCaches(next)
    })
  }, [view, commitSummary, commitDescription, desktopPrefs, runBusy, refreshRepoState, syncRemoteCaches])

  const handleRebuildBaseline = useCallback(() => {
    if (view.kind !== 'repo') return
    if (!proxyConnected) {
      void modal.alert({
        title: '需要代理服务器',
        message: GITHUB_ZIPBALL_PROXY_REQUIRED_MESSAGE,
      })
      return
    }
    void runBusy('rebuild', '重建本地基线…', '重建基线失败', async () => {
      // 一次 zipball 重建 tip 基线，避免按文件狂打 Contents API
      const result = await rebuildGithubBaseline(view.meta, { force: true })
      const latest = await getGithubRepoMeta(view.meta.owner, view.meta.repo)
      const metaAfter = latest ?? view.meta
      await refreshRepoState(metaAfter)

      if (result.status === 'empty') {
        await modal.alert({
          title: '无法重建',
          message: '当前分支还没有 tip，或压缩包为空。请先拉取或重新克隆仓库。',
        })
        return
      }
      if (result.status === 'incomplete') {
        await modal.alert({
          title: '基线未完全重建',
          message: `已写入 ${result.written} 个快照，仍有 ${result.missing} 个失败。请检查网络/Token 后重试，或重新克隆。`,
        })
        return
      }
      // 重建已联网：顺便刷新分支名与 History 列表缓存，避免 Diff 好了但 History 仍空
      await syncRemoteCaches(metaAfter)
      await modal.alert({
        title: '基线已重建',
        message: `已用 tip 压缩包写入 ${result.written} 个本地快照（未改动工作区），并已刷新提交历史缓存。`,
      })
    })
  }, [view, runBusy, modal, refreshRepoState, proxyConnected, syncRemoteCaches])

  const handleSwitchBranch = useCallback(
    (branch: string) => {
      if (view.kind !== 'repo') return
      void runBusy('switch', `切换分支 ${branch}…`, '切换分支失败', async () => {
        const next = await switchGithubBranch({
          meta: view.meta,
          branch,
          onProgress: reportSyncProgress,
        })
        await refreshRepoState(next)
      })
    },
    [view, runBusy, refreshRepoState, reportSyncProgress],
  )

  const goHome = useCallback(() => {
    setView({ kind: 'home' })
    setRepoFoldoutOpen(false)
    setBranchFoldoutOpen(false)
    setSyncMenuOpen(false)
    setRemoteHeadSha(undefined)
    void refreshLocalRepos()
  }, [refreshLocalRepos])

  const filteredRemotes = useMemo(() => {
    const q = cloneFilter.trim().toLowerCase()
    if (!q) return remoteRepos
    return remoteRepos.filter(
      (repo) =>
        repo.fullName.toLowerCase().includes(q) ||
        (repo.description?.toLowerCase().includes(q) ?? false),
    )
  }, [remoteRepos, cloneFilter])

  const cloneLocalPath =
    cloneOwner.trim() && cloneRepo.trim()
      ? githubRepoRootPath(cloneOwner.trim(), cloneRepo.trim())
      : '/repo/github/…'

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === APP_ID && !window.minimized)
    const repoMeta = view.kind === 'repo' ? view.meta : undefined

    return [
      {
        label: 'GitHub Desktop',
        items: [
          ...aboutAppMenuPrefix('关于 GitHub Desktop', () => showBuiltinAbout(APP_ID)),
          {
            type: 'action',
            label: '隐藏 GitHub Desktop',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '设置…',
            shortcut: '⌘,',
            onClick: openPreferences,
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出 GitHub Desktop',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
      {
        label: '文件',
        items: [
          {
            type: 'action',
            label: '克隆仓库…',
            shortcut: '⇧⌘O',
            disabled: busy,
            onClick: () => {
              void openClone()
            },
          },
        ],
      },
      {
        label: '仓库',
        items: [
          {
            type: 'action',
            label: '返回仓库列表',
            onClick: goHome,
          },
          { type: 'separator' },
          {
            type: 'action',
            label: `在${externalEditorLabel(desktopPrefs.externalEditor)}中打开`,
            disabled: !repoMeta,
            onClick: () => {
              if (!repoMeta) return
              openInExternalEditor(repoMeta.owner, repoMeta.repo)
            },
          },
          {
            type: 'action',
            label: '在「文件」中显示',
            disabled: !repoMeta,
            onClick: () => {
              if (!repoMeta) return
              openApp('files', {
                documentId: githubRepoRootPath(repoMeta.owner, repoMeta.repo),
              })
            },
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '重建本地基线…',
            disabled: !repoMeta || busy,
            onClick: () => handleRebuildBaseline(),
          },
          {
            type: 'action',
            label: '删除本地仓库…',
            disabled: !repoMeta,
            onClick: () => {
              if (repoMeta) void handleDeleteLocal(repoMeta)
            },
          },
        ],
      },
      {
        label: '分支',
        items: [
          {
            type: 'action',
            label: canPull ? '拉取' : '获取',
            disabled: view.kind !== 'repo' || busy,
            onClick: () => handleFetchOrPull(),
          },
          ...(canPull
            ? [
                {
                  type: 'action' as const,
                  label: '获取',
                  disabled: view.kind !== 'repo' || busy,
                  onClick: () => handleFetch(),
                },
              ]
            : []),
        ],
      },
    ]
  }, [
    windows,
    view,
    showBuiltinAbout,
    minimizeWindow,
    closeWindowsForApp,
    openClone,
    goHome,
    openApp,
    openPreferences,
    openInExternalEditor,
    desktopPrefs.externalEditor,
    handleDeleteLocal,
    handleRebuildBaseline,
    busy,
    canPull,
    handleFetch,
    handleFetchOrPull,
  ])

  useAppMenuBar(APP_ID, menuBar)

  const syncNetworkBusy =
    busyKind === 'pull' ||
    busyKind === 'fetch' ||
    busyKind === 'switch' ||
    busyKind === 'commit'

  const syncButtonTitle = (() => {
    if (busyKind === 'pull') return '拉取 origin'
    if (busyKind === 'fetch') return '获取 origin'
    if (busyKind === 'switch') return '切换分支'
    if (busyKind === 'commit') return '推送 origin'
    return canPull ? '拉取 origin' : '获取 origin'
  })()

  const syncButtonSubtitle = (() => {
    if (syncNetworkBusy) return progressLabel ?? '请稍候…'
    if (view.kind !== 'repo') return '准备中…'
    return formatLastFetchedLabel(view.meta.lastFetchedAt, nowMs)
  })()

  const syncIconKind: 'sync' | 'pull' = canPull && !syncNetworkBusy ? 'pull' : 'sync'
  const branchList =
    view.kind === 'repo'
      ? branches.length > 0
        ? branches
        : [
            {
              name: view.meta.currentBranch,
              commitSha: repoHeadSha,
              protected: false,
            },
          ]
      : []

  const closeToolbarMenus = useCallback(() => {
    setRepoFoldoutOpen(false)
    setBranchFoldoutOpen(false)
    setSyncMenuOpen(false)
  }, [])

  const toggleRepoFoldout = useCallback(() => {
    setBranchFoldoutOpen(false)
    setSyncMenuOpen(false)
    setRepoFoldoutOpen((open) => !open)
  }, [])

  const toggleBranchFoldout = useCallback(() => {
    setRepoFoldoutOpen(false)
    setSyncMenuOpen(false)
    setBranchFoldoutOpen((open) => !open)
  }, [])

  const toggleSyncMenu = useCallback(() => {
    setRepoFoldoutOpen(false)
    setBranchFoldoutOpen(false)
    setSyncMenuOpen((open) => !open)
  }, [])

  return (
    <div class="github-desktop">
      {showToolbar ? (
        <div class="github-desktop__toolbar-wrap">
          <div class="github-desktop__toolbar">
            <button
              type="button"
              class={`github-desktop__toolbar-btn github-desktop__toolbar-btn--repo${
                repoFoldoutOpen ? ' is-open' : ''
              }`}
              disabled={busy && busyKind === 'clone'}
              onClick={toggleRepoFoldout}
              title={
                view.kind === 'repo'
                  ? `${view.meta.owner}/${view.meta.repo}`
                  : view.kind === 'cloning'
                    ? `${view.owner}/${view.repo}`
                    : undefined
              }
            >
              <span class="github-desktop__toolbar-icon">
                <RepoIcon />
              </span>
              <span class="github-desktop__toolbar-btn-text">
                <span class="github-desktop__toolbar-btn-description">
                  {view.kind === 'cloning' ? '正在克隆…' : '当前仓库'}
                </span>
                <span class="github-desktop__toolbar-btn-title">
                  {view.kind === 'repo'
                    ? view.meta.repo
                    : view.kind === 'cloning'
                      ? view.repo
                      : '选择仓库'}
                </span>
              </span>
              <span class="github-desktop__toolbar-caret">
                <CaretIcon />
              </span>
            </button>

            {view.kind === 'repo' ? (
              <button
                type="button"
                class={`github-desktop__toolbar-btn github-desktop__toolbar-btn--branch${
                  branchFoldoutOpen ? ' is-open' : ''
                }`}
                disabled={busy}
                onClick={toggleBranchFoldout}
              >
                <span class="github-desktop__toolbar-icon">
                  <BranchIcon />
                </span>
                <span class="github-desktop__toolbar-btn-text">
                  <span class="github-desktop__toolbar-btn-description">当前分支</span>
                  <span class="github-desktop__toolbar-btn-title">{view.meta.currentBranch}</span>
                </span>
                <span class="github-desktop__toolbar-caret">
                  <CaretIcon />
                </span>
              </button>
            ) : undefined}

            <div
              class={`github-desktop__toolbar-sync${canPull && !syncNetworkBusy ? ' has-menu' : ''}`}
            >
              <button
                type="button"
                class={`github-desktop__toolbar-btn github-desktop__toolbar-btn--sync${
                  syncNetworkBusy ? ' has-progress' : ''
                }${syncMenuOpen ? ' is-open' : ''}`}
                disabled={view.kind !== 'repo' || busy}
                onClick={handleFetchOrPull}
                aria-busy={syncNetworkBusy ? 'true' : undefined}
                title={
                  syncNetworkBusy
                    ? syncButtonSubtitle
                    : canPull
                      ? '将远端变更合入本地工作区（需无未提交改动）'
                      : '从 GitHub 获取远端信息，不改动工作区'
                }
              >
                {syncNetworkBusy && progressValue !== undefined ? (
                  <span
                    class="github-desktop__toolbar-progress"
                    style={{ transform: `scaleX(${progressValue})` }}
                    aria-hidden="true"
                  />
                ) : undefined}
                <span
                  class={`github-desktop__toolbar-icon${syncNetworkBusy ? ' is-spinning' : ''}`}
                >
                  {syncIconKind === 'pull' ? <ArrowDownIcon /> : <SyncIcon />}
                </span>
                <span class="github-desktop__toolbar-btn-text">
                  <span class="github-desktop__toolbar-btn-title">{syncButtonTitle}</span>
                  <span class="github-desktop__toolbar-btn-description">{syncButtonSubtitle}</span>
                </span>
                {canPull && !syncNetworkBusy ? (
                  <span class="github-desktop__toolbar-ahead-behind" aria-hidden="true">
                    <span>
                      <ArrowDownIcon size={10} />
                    </span>
                  </span>
                ) : undefined}
              </button>
              {canPull && !syncNetworkBusy ? (
                <button
                  type="button"
                  class={`github-desktop__toolbar-btn github-desktop__toolbar-btn--sync-menu${
                    syncMenuOpen ? ' is-open' : ''
                  }`}
                  disabled={view.kind !== 'repo' || busy}
                  aria-label="获取与拉取选项"
                  onClick={toggleSyncMenu}
                >
                  <CaretIcon />
                </button>
              ) : undefined}
            </div>
          </div>

          {repoFoldoutOpen ? (
            <div class="github-desktop__toolbar-foldout">
              {localRepos.map((repo) => {
                const active =
                  view.kind === 'repo' &&
                  view.meta.owner === repo.owner &&
                  view.meta.repo === repo.repo
                return (
                  <button
                    key={`${repo.owner}/${repo.repo}`}
                    type="button"
                    class={`github-desktop__foldout-item${active ? ' is-active' : ''}`}
                    onClick={() => {
                      closeToolbarMenus()
                      handleOpenLocal(repo)
                    }}
                  >
                    <strong>{repo.repo}</strong>
                    <span>
                      {repo.owner}/{repo.repo} · {repo.currentBranch}
                    </span>
                  </button>
                )
              })}
              <div class="github-desktop__foldout-footer">
                <button
                  type="button"
                  class="github-desktop__btn--link"
                  onClick={() => {
                    closeToolbarMenus()
                    goHome()
                  }}
                >
                  查看全部仓库…
                </button>
              </div>
            </div>
          ) : undefined}

          {branchFoldoutOpen && view.kind === 'repo' ? (
            <div class="github-desktop__toolbar-foldout github-desktop__toolbar-foldout--branch">
              {branchList.map((branch) => {
                const active = branch.name === view.meta.currentBranch
                return (
                  <button
                    key={branch.name}
                    type="button"
                    class={`github-desktop__foldout-item${active ? ' is-active' : ''}`}
                    disabled={busy}
                    onClick={() => {
                      closeToolbarMenus()
                      if (!active) handleSwitchBranch(branch.name)
                    }}
                  >
                    <strong>{branch.name}</strong>
                    <span>{shortSha(branch.commitSha || '???????')}</span>
                  </button>
                )
              })}
            </div>
          ) : undefined}

          {syncMenuOpen && view.kind === 'repo' ? (
            <div class="github-desktop__toolbar-foldout github-desktop__toolbar-foldout--sync">
              <button
                type="button"
                class="github-desktop__foldout-item github-desktop__foldout-item--action"
                disabled={busy}
                onClick={() => {
                  closeToolbarMenus()
                  handleFetch()
                }}
              >
                <strong>获取 origin</strong>
                <span>从 origin 获取最新变更（不改动工作区）</span>
              </button>
            </div>
          ) : undefined}
        </div>
      ) : undefined}

      {showToolbar && banner ? (
        <div class="github-desktop__banner">
          <p>{banner.message}</p>
          <button type="button" class="github-desktop__btn" onClick={banner.onAction}>
            {banner.actionLabel}
          </button>
        </div>
      ) : undefined}

      <div class="github-desktop__body">
        {view.kind === 'home' ? (
          <div class="github-desktop__blank">
            <div class="github-desktop__blank-left">
              <GithubDesktopIcon size={56} />
              <h2>开始使用吧！</h2>
              <p>把仓库添加到 GitHub Desktop，即可开始协作。</p>
              {user ? (
                <p>
                  已登录为 <strong>@{user.login}</strong>
                  {' · '}
                  <button type="button" class="github-desktop__btn--link" onClick={openPreferences}>
                    设置
                  </button>
                </p>
              ) : hasToken ? (
                <p>
                  已配置 Token
                  {' · '}
                  <button type="button" class="github-desktop__btn--link" onClick={openPreferences}>
                    查看账户
                  </button>
                </p>
              ) : undefined}
              <div class="github-desktop__blank-actions">
                {!hasToken ? (
                  <button
                    type="button"
                    class="github-desktop__blank-cta github-desktop__blank-cta--primary"
                    onClick={() => openApp('keychain')}
                  >
                    登录到 GitHub.com…
                  </button>
                ) : !proxyConnected ? (
                  <>
                    <button
                      type="button"
                      class="github-desktop__blank-cta github-desktop__blank-cta--primary"
                      onClick={openProxySettings}
                    >
                      打开代理设置
                    </button>
                    <button
                      type="button"
                      class="github-desktop__blank-cta"
                      disabled={busy}
                      onClick={() => {
                        void openClone()
                      }}
                    >
                      从互联网克隆仓库…
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    class="github-desktop__blank-cta github-desktop__blank-cta--primary"
                    disabled={busy}
                    onClick={() => {
                      void openClone()
                    }}
                  >
                    从互联网克隆仓库…
                  </button>
                )}
              </div>
            </div>
            <div class="github-desktop__blank-right">
              <h3>本地仓库</h3>
              <div class="github-desktop__blank-list">
                {localRepos.length === 0 ? (
                  <div class="github-desktop__blank-empty">
                    还没有本地副本。克隆后会保存在 /repo/github/…
                  </div>
                ) : (
                  localRepos.map((repo) => (
                    <div key={`${repo.owner}/${repo.repo}`} class="github-desktop__repo-row">
                      <button
                        type="button"
                        class="github-desktop__repo-row-main"
                        onClick={() => handleOpenLocal(repo)}
                      >
                        <strong>
                          {repo.owner}/{repo.repo}
                        </strong>
                        <span>
                          {repo.currentBranch} · {shortSha(currentHeadSha(repo) || '???????')}
                        </span>
                      </button>
                      <button
                        type="button"
                        class="github-desktop__repo-row-delete"
                        title="删除本地仓库"
                        disabled={busy}
                        onClick={() => {
                          void handleDeleteLocal(repo)
                        }}
                      >
                        删除
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : undefined}

        {view.kind === 'cloning' ? (
          <div class="github-desktop__cloning">
            <div class="github-desktop__spinner" />
            <h2>
              正在克隆 {view.owner}/{view.repo}
            </h2>
            <p>{progressLabel ?? '请稍候…'}</p>
          </div>
        ) : undefined}

        {view.kind === 'repo' ? (
          <div class="github-desktop__repo">
            <div class="github-desktop__sidebar">
              <div class="github-desktop__tabs">
                <button
                  type="button"
                  class={`github-desktop__tab${sidebarTab === 'changes' ? ' is-active' : ''}`}
                  onClick={() => setSidebarTab('changes')}
                >
                  Changes
                  {changes.length > 0 ? (
                    <span class="github-desktop__tab-badge">{changes.length}</span>
                  ) : undefined}
                </button>
                <button
                  type="button"
                  class={`github-desktop__tab${sidebarTab === 'history' ? ' is-active' : ''}`}
                  onClick={() => setSidebarTab('history')}
                >
                  History
                </button>
              </div>

              {sidebarTab === 'changes' ? (
                <>
                  <div class="github-desktop__changes-header">
                    {changes.length === 0 ? 'No local changes' : summarizeChanges(changes)}
                  </div>
                  <div class="github-desktop__changes-list">
                    {changes.map((change) => (
                      <button
                        key={change.path}
                        type="button"
                        class={`github-desktop__change${
                          selectedPath === change.path ? ' is-selected' : ''
                        }`}
                        onClick={() => setSelectedPath(change.path)}
                      >
                        <span
                          class={`github-desktop__change-kind github-desktop__change-kind--${change.kind}`}
                        >
                          {changeKindMark(change.kind)}
                        </span>
                        <span class="github-desktop__change-path">{change.path}</span>
                      </button>
                    ))}
                  </div>
                  <div class="github-desktop__commit">
                    <input
                      value={commitSummary}
                      disabled={busy || changes.length === 0}
                      placeholder="Summary（必填）"
                      onInput={(event) =>
                        setCommitSummary((event.target as HTMLInputElement).value)
                      }
                    />
                    <textarea
                      value={commitDescription}
                      disabled={busy || changes.length === 0}
                      placeholder="Description"
                      onInput={(event) =>
                        setCommitDescription((event.target as HTMLTextAreaElement).value)
                      }
                    />
                    <button
                      type="button"
                      class="github-desktop__commit-btn"
                      disabled={busy || changes.length === 0 || !commitSummary.trim()}
                      onClick={handleCommit}
                    >
                      Commit to {view.meta.currentBranch}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div class="github-desktop__changes-header">
                    {historyLoading
                      ? '加载提交历史…'
                      : historyError
                        ? '无法加载历史'
                        : `${historyCommits.length} commits`}
                  </div>
                  <div class="github-desktop__changes-list">
                    {historyError ? (
                      <div class="github-desktop__sidebar-empty">{historyError}</div>
                    ) : historyLoading && historyCommits.length === 0 ? (
                      <div class="github-desktop__sidebar-empty">正在加载…</div>
                    ) : historyCommits.length === 0 ? (
                      <div class="github-desktop__sidebar-empty">
                        本地还没有提交历史缓存。点击工具栏「获取」从 GitHub 刷新（不改动工作区）。
                      </div>
                    ) : (
                      historyCommits.map((commit) => (
                        <button
                          key={commit.sha}
                          type="button"
                          class={`github-desktop__history-item${
                            selectedCommitSha === commit.sha ? ' is-selected' : ''
                          }`}
                          onClick={() => setSelectedCommitSha(commit.sha)}
                        >
                          <span class="github-desktop__history-message">
                            {commitSummaryLine(commit.message)}
                          </span>
                          <span class="github-desktop__history-meta">
                            {shortSha(commit.sha)} · {commit.authorName}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            <div class="github-desktop__diff">
              {sidebarTab === 'history' ? (
                !selectedCommitSha ? (
                  <div class="github-desktop__diff-empty">
                    <h3>选择一个提交</h3>
                    <p>在左侧列表中选择提交以查看变更。</p>
                  </div>
                ) : historyDetailLoading && !historyDetail ? (
                  <div class="github-desktop__diff-empty">
                    <h3>正在加载提交详情…</h3>
                  </div>
                ) : historyDetail ? (
                  <div class="github-desktop__history-detail">
                    <div class="github-desktop__history-detail-head">
                      <h3>{commitSummaryLine(historyDetail.message)}</h3>
                      <p>
                        {shortSha(historyDetail.sha)} · {historyDetail.authorName}
                        {historyDetail.authorDate
                          ? ` · ${new Date(historyDetail.authorDate).toLocaleString()}`
                          : ''}
                      </p>
                    </div>
                    <div class="github-desktop__history-files">
                      {historyDetail.files.length === 0 ? (
                        <div class="github-desktop__sidebar-empty">此提交没有文件变更信息</div>
                      ) : (
                        historyDetail.files.map((file) => (
                          <button
                            key={file.filename}
                            type="button"
                            class={`github-desktop__change${
                              selectedHistoryFile === file.filename ? ' is-selected' : ''
                            }`}
                            onClick={() => setSelectedHistoryFile(file.filename)}
                          >
                            <span class="github-desktop__change-kind">{file.status[0]?.toUpperCase() ?? 'M'}</span>
                            <span class="github-desktop__change-path">{file.filename}</span>
                          </button>
                        ))
                      )}
                    </div>
                    <div class="github-desktop__history-patch">
                      {(() => {
                        const file = historyDetail.files.find(
                          (item) => item.filename === selectedHistoryFile,
                        )
                        if (!file) {
                          return (
                            <div class="github-desktop__diff-empty">
                              <h3>选择一个文件</h3>
                            </div>
                          )
                        }
                        if (!file.patch) {
                          return (
                            <div class="github-desktop__diff-notice">
                              此文件没有可用的 patch（可能是二进制或变更过大）。
                            </div>
                          )
                        }
                        return <GithubDesktopDiffView patch={file.patch} />
                      })()}
                    </div>
                  </div>
                ) : (
                  <div class="github-desktop__diff-empty">
                    <h3>无法显示提交</h3>
                  </div>
                )
              ) : changes.length === 0 ? (
                <div class="github-desktop__diff-empty">
                  <h3>No local changes</h3>
                  <p>当前工作区与最近一次同步的快照一致。</p>
                </div>
              ) : !selectedPath ? (
                <div class="github-desktop__diff-empty">
                  <h3>选择一个文件</h3>
                  <p>在左侧列表中选择文件以查看变更预览。</p>
                </div>
              ) : diffLoading && !diffPreview ? (
                <div class="github-desktop__diff-empty">
                  <h3>正在计算差异…</h3>
                </div>
              ) : diffPreview ? (
                <div class="github-desktop__diff-panel">
                  {diffPreview.notice ? (
                    <div class="github-desktop__diff-notice">{diffPreview.notice}</div>
                  ) : undefined}
                  {!diffPreview.notice ||
                  diffPreview.original.length > 0 ||
                  diffPreview.modified.length > 0 ? (
                    <GithubDesktopDiffView
                      original={diffPreview.original}
                      modified={diffPreview.modified}
                    />
                  ) : undefined}
                </div>
              ) : (
                <div class="github-desktop__diff-empty">
                  <h3>选择一个文件</h3>
                  <p>在左侧列表中选择文件以查看变更预览。</p>
                </div>
              )}
            </div>
          </div>
        ) : undefined}
      </div>

      <WindowModal
        open={cloneDialogOpen}
        title="克隆仓库"
        wide
        scrollBody
        onClose={closeCloneDialog}
        actions={[
          {
            label: '取消',
            tone: 'secondary',
            disabled: busy,
            onClick: closeCloneDialog,
          },
          {
            label: '克隆',
            tone: 'primary',
            disabled:
              cloneDialogLoading ||
              !proxyConnected ||
              !cloneOwner.trim() ||
              !cloneRepo.trim() ||
              busy,
            onClick: () => {
              void handleClone()
            },
          },
        ]}
      >
        <div class="github-desktop__clone-dialog">
          {cloneDialogError ? (
            <div class="github-desktop__clone-error">{cloneDialogError}</div>
          ) : undefined}
          {!proxyConnected ? (
            <div class="github-desktop__clone-error">
              {GITHUB_ZIPBALL_PROXY_REQUIRED_MESSAGE}{' '}
              <button type="button" class="github-desktop__btn--link" onClick={openProxySettings}>
                打开代理设置
              </button>
            </div>
          ) : undefined}
          <input
            class="settings__input github-desktop__clone-filter"
            value={cloneFilter}
            placeholder="过滤仓库…"
            disabled={cloneDialogLoading}
            onInput={(event) => setCloneFilter((event.target as HTMLInputElement).value)}
          />
          <div class="github-desktop__clone-list">
            {cloneDialogLoading ? (
              <div class="github-desktop__clone-loading">正在加载仓库列表…</div>
            ) : filteredRemotes.length === 0 ? (
              <div class="github-desktop__clone-loading">没有匹配的仓库</div>
            ) : (
              filteredRemotes.map((repo) => {
                const selected = cloneOwner === repo.owner && cloneRepo === repo.name
                return (
                  <button
                    key={repo.fullName}
                    type="button"
                    class={`github-desktop__clone-item${selected ? ' is-selected' : ''}`}
                    onClick={() => {
                      void handleSelectRemote(repo.fullName)
                    }}
                  >
                    <strong>
                      {repo.fullName}
                      {repo.private ? '（私有）' : ''}
                    </strong>
                    <span>{repo.description || `默认分支 ${repo.defaultBranch}`}</span>
                  </button>
                )
              })
            )}
          </div>
          <div class="settings__form github-desktop__clone-fields">
            <SettingsChoiceField
              label="分支"
              value={cloneBranch}
              options={(cloneBranches.length > 0
                ? cloneBranches
                : cloneBranch
                  ? [{ name: cloneBranch, commitSha: '', protected: false }]
                  : []
              ).map((branch) => ({
                id: branch.name,
                label: branch.name,
              }))}
              onChange={setCloneBranch}
              wideLayout
              presentation="form"
              disabled={cloneDialogLoading || busy || !cloneBranch}
            />
            <div class="settings__field">
              <span class="settings__field-label">本地路径</span>
              <div class="github-desktop__clone-path">{cloneLocalPath}</div>
            </div>
          </div>
        </div>
      </WindowModal>

      <WindowModal
        open={prefsOpen}
        title="设置"
        wide
        scrollBody
        panelClass="github-desktop__prefs-modal"
        onClose={closePreferences}
        actions={[
          {
            label: '完成',
            tone: 'primary',
            onClick: closePreferences,
          },
        ]}
      >
        <div class="github-desktop__prefs">
          <SegmentedControl
            value={prefsTab}
            ariaLabel="设置分类"
            className="github-desktop__prefs-tabs"
            items={[
              { id: 'accounts', label: '账户' },
              { id: 'integrations', label: '集成' },
              { id: 'git', label: 'Git' },
            ]}
            onChange={setPrefsTab}
          />
          <div class="github-desktop__prefs-panel">
            {prefsTab === 'accounts' ? (
              <section class="settings__section">
                <h2 class="settings__section-title">GitHub.com</h2>
                {!hasToken ? (
                  <div class="settings__box github-desktop__prefs-cta">
                    <p>登录到你的 GitHub.com 账户以访问仓库。</p>
                    <button
                      type="button"
                      class="settings__btn settings__btn--default"
                      onClick={() => {
                        closePreferences()
                        openApp('keychain')
                      }}
                    >
                      登录到 GitHub.com
                    </button>
                  </div>
                ) : (
                  <div class="settings__list">
                    <div class="github-desktop__prefs-account-row">
                      {avatarDisplayUrl || user?.avatarUrl ? (
                        <img
                          class="github-desktop__prefs-avatar"
                          src={avatarDisplayUrl ?? user?.avatarUrl}
                          alt=""
                          width={36}
                          height={36}
                        />
                      ) : (
                        <div class="github-desktop__prefs-avatar github-desktop__prefs-avatar--placeholder">
                          {(user?.login ?? '?').slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div class="github-desktop__prefs-user">
                        {accountRefreshing && !user ? (
                          <div class="github-desktop__prefs-login">正在获取账户信息…</div>
                        ) : user ? (
                          <>
                            {user.name ? (
                              <div class="github-desktop__prefs-name">{user.name}</div>
                            ) : undefined}
                            <div class="github-desktop__prefs-login">@{user.login}</div>
                          </>
                        ) : (
                          <div class="github-desktop__prefs-login">尚未缓存账户信息</div>
                        )}
                      </div>
                      <button
                        type="button"
                        class="settings__btn settings__btn--small settings__btn--plain"
                        onClick={() => {
                          closePreferences()
                          openApp('keychain')
                        }}
                      >
                        管理凭证…
                      </button>
                    </div>
                    {accountError ? (
                      <div class="github-desktop__prefs-error">{accountError}</div>
                    ) : undefined}
                    <button
                      type="button"
                      class="settings__row settings__row--button github-desktop__prefs-refresh"
                      disabled={accountRefreshing}
                      onClick={() => {
                        void refreshAccountProfile()
                      }}
                    >
                      <span class="settings__row-name">
                        {accountRefreshing ? '刷新中…' : '刷新账户信息'}
                      </span>
                    </button>
                  </div>
                )}
                <p class="settings__section-footnote">
                  Token 由系统钥匙串保管；本应用只读取是否已配置。要更改或移除凭证，请在钥匙串中操作。账户资料仅在本机缓存，打开应用时不会请求 GitHub。
                </p>
              </section>
            ) : undefined}

            {prefsTab === 'integrations' ? (
              <section class="settings__section">
                <h2 class="settings__section-title">应用程序</h2>
                <div class="settings__box">
                  <div class="settings__form">
                    <SettingsChoiceField
                      label="外部编辑器"
                      value={desktopPrefs.externalEditor}
                      options={[
                        { id: 'vscode', label: 'Virtual Studio Code Desktop' },
                        { id: 'files', label: '文件' },
                      ]}
                      onChange={(value) => {
                        patchDesktopPrefs({
                          externalEditor: value as GithubExternalEditor,
                        })
                      }}
                      wideLayout
                      presentation="form"
                    />
                  </div>
                </div>
                <p class="settings__section-footnote">
                  「仓库 → 在编辑器中打开」会使用此处选择的应用打开当前仓库。默认是 Virtual Studio
                  Code Desktop。
                </p>
              </section>
            ) : undefined}

            {prefsTab === 'git' ? (
              <>
                <section class="settings__section">
                  <h2 class="settings__section-title">提交作者</h2>
                  <p class="settings__section-subtitle">
                    这些信息会写入你推送到 GitHub 的 commit（author / committer）。可与账户资料不同。
                  </p>
                  <div class="settings__box">
                    <div class="settings__form">
                      <label class="settings__field">
                        <span class="settings__field-label">姓名</span>
                        <input
                          class="settings__input"
                          type="text"
                          value={desktopPrefs.gitUserName}
                          placeholder="例如 Your Name"
                          autoComplete="name"
                          onInput={(event) => {
                            patchDesktopPrefs({
                              gitUserName: (event.target as HTMLInputElement).value,
                            })
                          }}
                        />
                      </label>
                      <label class="settings__field">
                        <span class="settings__field-label">邮箱</span>
                        <input
                          class="settings__input"
                          type="email"
                          value={desktopPrefs.gitUserEmail}
                          placeholder="login@users.noreply.github.com"
                          autoComplete="email"
                          onInput={(event) => {
                            patchDesktopPrefs({
                              gitUserEmail: (event.target as HTMLInputElement).value,
                            })
                          }}
                        />
                      </label>
                      <div class="github-desktop__prefs-form-actions">
                        <button
                          type="button"
                          class="settings__btn settings__btn--small settings__btn--plain"
                          disabled={!defaultGithubCommitIdentity()}
                          onClick={() => {
                            const defaults = defaultGithubCommitIdentity()
                            if (!defaults) return
                            patchDesktopPrefs(defaults)
                          }}
                        >
                          恢复默认
                        </button>
                      </div>
                    </div>
                  </div>
                  <p class="settings__section-footnote">
                    默认取自账户显示名与主邮箱；拉不到邮箱时用 noreply。Token 需有邮箱读权限。留空则提交时同样回退。
                  </p>
                </section>
                <section class="settings__section">
                  <h2 class="settings__section-title">协作者</h2>
                  <div class="settings__list">
                    <SettingsSwitchRow
                      label="添加 Instant Agent"
                      checked={desktopPrefs.includeCasingAiCoAuthor}
                      onChange={(checked) => {
                        patchDesktopPrefs({ includeCasingAiCoAuthor: checked })
                      }}
                    />
                  </div>
                  <p class="settings__section-footnote">
                    开启后提交说明会附带 Instant Agent 的 Co-authored-by。
                  </p>
                </section>
              </>
            ) : undefined}
          </div>
        </div>
      </WindowModal>
    </div>
  )
}
