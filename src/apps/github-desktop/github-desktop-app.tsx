import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { GithubDesktopIcon, ReloadIcon } from '../../icons/app-icons.tsx'
import {
  hasGithubCredentials,
  subscribeGithubCredentials,
} from '../../os/github-credentials-storage.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import {
  formatOpenInBuiltinAppLabel,
  getBuiltinAppName,
} from '../../os/builtin-app-name.ts'
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
  githubListUserRepos,
  formatGithubRepoVisibilityLabel,
  formatGithubRepoVisibilitySuffix,
  githubRepoOwnerLogin,
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
  ensureGithubRevisionIdsReady,
  rebuildGithubBaseline,
  type GithubChange,
  type GithubChangePreview,
} from './github-changes.ts'
import { generateGithubCommitMessage } from './github-commit-agent.ts'
import { buildLocalCommitDetail, buildLocalCommitFilePreview, commitGithubChanges, formatStagedChangesSummary, pushGithubBranch } from './github-commit.ts'
import { discardGithubChanges } from './github-discard.ts'
import { createGithubBranch, validateGithubBranchName } from './github-branch.ts'
import {
  amendUnpushedCommit,
  undoLastUnpushedCommit,
} from './github-local-history.ts'
import {
  stashListGithub,
  stashPopGithubChanges,
  stashSaveGithubChanges,
} from './github-stash.ts'
import { FixedRowVirtualList } from '../../ui/fixed-row-virtual-list.tsx'
import { GithubDesktopDiffView } from './github-desktop-diff-view.tsx'
import {
  buildGithubCommitMessage,
  defaultGithubCommitIdentity,
  externalEditorLabel,
  formatCoAuthorNames,
  GITHUB_DESKTOP_SIDEBAR_WIDTH_MAX,
  GITHUB_DESKTOP_SIDEBAR_WIDTH_MIN,
  loadGithubDesktopPrefs,
  parseCoAuthorTrailers,
  resolveCommitCoAuthors,
  updateGithubDesktopPrefs,
  type GithubDesktopPrefs,
  type GithubExternalEditor,
} from './github-desktop-prefs.ts'
import {
  consumePendingOpenGithubDesktopGitPrefs,
  OPEN_GITHUB_DESKTOP_GIT_PREFS_EVENT,
  shouldWarnGithubDesktopMissingEmail,
  showGithubDesktopMissingEmailNotification,
  GITHUB_DESKTOP_MISSING_EMAIL_SLUG,
} from './github-desktop-missing-email.ts'
import { dismissOsNotification } from '../../os/os-notifications.ts'
import { applyGithubFetchResult, fetchGithubRemote, GITHUB_REMOTE_COMMIT_LIST_LIMIT } from './github-fetch.ts'
import { pullGithubRepository, switchGithubBranch } from './github-pull.ts'
import { githubRepoRootPath, parseGithubRepoUrl } from './github-repo-paths.ts'
import { reconcileGithubRepoAttributes } from './github-repo-attributes.ts'
import {
  currentBranchRemoteSha,
  branchHasUnpushedCommits,
  currentBranchPushedSha,
  isLocalCommitSha,
  currentHeadSha,
  buildRepoBranchList,
  deleteGithubRepoMeta,
  getCachedGithubCommitDetail,
  getCachedGithubCommitList,
  getGithubRepoMeta,
  groupRepoBranchList,
  listGithubLocalCommits,
  listUnpushedLocalCommits,
  listGithubRepoMeta,
  putCachedGithubCommitDetail,
  saveGithubMissingRepoMeta,
  subscribeGithubRepoMeta,
  type GithubDesktopBranchListItem,
  type GithubRepoSyncMeta,
} from './github-sync-meta.ts'
import {
  deleteLocalGithubRepository,
  describeGithubRepoClonePathBlockReason,
  describeGithubRepoReclonePathBlockReason,
  isGithubRepoWorkingTreePresent,
} from './github-working-tree.ts'
import {
  getGithubCloningProgress,
  getGithubCloningProgressFraction,
  getGithubCloningRepository,
  listGithubCloningRepositories,
  startGithubClone,
  subscribeGithubCloningRepositories,
  type GithubCloningRepository,
} from './github-cloning-store.ts'
import type { GithubProgress, GithubProgressDetail } from './github-progress.ts'
import { useOpenAiReady } from '../../ai/use-openai-ready.ts'
import { IosCheckToggle } from '../../ui/ios-check-toggle.tsx'
import '../../ui/ios-check-toggle.css'
import './github-desktop.css'

const APP_ID = 'github-desktop' as const

type View =
  | { kind: 'home' }
  | { kind: 'cloning'; id: number; owner: string; repo: string }
  | { kind: 'missing'; meta: GithubRepoSyncMeta }
  | { kind: 'repo'; meta: GithubRepoSyncMeta }

type SidebarTab = 'changes' | 'history'
type CommitMode = 'manual' | 'auto'

type BusyKind =
  | 'pull'
  | 'fetch'
  | 'push'
  | 'commit'
  | 'switch'
  | 'load'
  | 'delete'
  | 'rebuild'
  | 'discard'
  | 'stash'
  | 'branch'
  | 'undo'
  | undefined

type ChangeKindMarkKind = 'added' | 'modified' | 'deleted'

function commitFileStatusKind(status: string): ChangeKindMarkKind {
  const normalized = status.toLowerCase()
  if (normalized === 'added') return 'added'
  if (normalized === 'removed' || normalized === 'deleted') return 'deleted'
  return 'modified'
}

function ChangeKindMark({ kind }: { kind: ChangeKindMarkKind }) {
  return (
    <span class={`github-desktop__change-kind github-desktop__change-kind--${kind}`}>
      <svg
        class="github-desktop__change-kind-icon"
        viewBox="0 0 10 10"
        width="10"
        height="10"
        aria-hidden="true"
      >
        {kind === 'added' ? (
          <>
            <path
              d="M5 2v6"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              fill="none"
            />
            <path
              d="M2 5h6"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              fill="none"
            />
          </>
        ) : kind === 'deleted' ? (
          <path
            d="M2 5h6"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            fill="none"
          />
        ) : (
          <circle cx="5" cy="5" r="2" fill="currentColor" />
        )}
      </svg>
    </span>
  )
}

function commitSummaryLine(message: string): string {
  const line = message.split('\n')[0]?.trim()
  return line || '(无说明)'
}

function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

function formatLocalRepoHint(repo: GithubRepoSyncMeta): string {
  if (repo.missing) return '找不到本地文件 · 可重新克隆'
  const branchLine = `${repo.currentBranch} · ${shortSha(currentHeadSha(repo) || '???????')}`
  const description = repo.remote?.description?.trim()
  if (description) return `${description} · ${branchLine}`
  return branchLine
}

function isGithubRepoCloning(
  owner: string,
  repo: string,
  cloningRepos: readonly GithubCloningRepository[],
): boolean {
  return cloningRepos.some((entry) => entry.owner === owner && entry.repo === repo)
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
      <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" />
    </svg>
  )
}

function PrivateRepoIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M4 4a4 4 0 0 1 8 0v2h.25c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5C2 6.784 2.784 6 3.75 6H4Zm8.25 3.5h-8.5a.25.25 0 0 0-.25.25v5.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25ZM10.5 6V4a2.5 2.5 0 1 0-5 0v2Z" />
    </svg>
  )
}

function ForkRepoIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z" />
    </svg>
  )
}

function CloningRepoIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="m4.927 5.427 2.896 2.896a.25.25 0 0 0 .354 0l2.896-2.896A.25.25 0 0 0 10.896 5H8.75V.75a.75.75 0 1 0-1.5 0V5H5.104a.25.25 0 0 0-.177.427Z" />
      <path d="M1.573 2.573a.25.25 0 0 0-.073.177v7.5a.25.25 0 0 0 .25.25h12.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-3a.75.75 0 1 1 0-1.5h3A1.75 1.75 0 0 1 16 2.75v7.5A1.75 1.75 0 0 1 14.25 12h-3.727c.099 1.041.52 1.872 1.292 2.757A.75.75 0 0 1 11.25 16h-6.5a.75.75 0 0 1-.565-1.243c.772-.885 1.192-1.716 1.292-2.757H1.75A1.75 1.75 0 0 1 0 10.25v-7.5A1.75 1.75 0 0 1 1.75 1h3a.75.75 0 0 1 0 1.5h-3a.25.25 0 0 0-.177.073ZM6.982 12a5.72 5.72 0 0 1-.765 2.5h3.566a5.72 5.72 0 0 1-.765-2.5H6.982Z" />
    </svg>
  )
}

function MissingRepoIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
    </svg>
  )
}

type ToolbarRepoIconKind = 'default' | 'repo' | 'private' | 'fork' | 'cloning' | 'missing'

function resolveToolbarRepoIconKind(view: View): ToolbarRepoIconKind {
  if (view.kind === 'cloning') return 'cloning'
  if (view.kind === 'missing') return 'missing'
  if (view.kind === 'repo') {
    return resolveLocalRepoIconKind(view.meta)
  }
  return 'default'
}

function resolveLocalRepoIconKind(meta: GithubRepoSyncMeta): ToolbarRepoIconKind {
  if (meta.missing) return 'missing'
  if (meta.remote?.private) return 'private'
  if (meta.remote?.fork) return 'fork'
  return 'repo'
}

function ToolbarRepoIcon({ kind }: { kind: ToolbarRepoIconKind }) {
  switch (kind) {
    case 'private':
      return <PrivateRepoIcon />
    case 'fork':
      return <ForkRepoIcon />
    case 'cloning':
      return <CloningRepoIcon />
    case 'missing':
      return <MissingRepoIcon />
    case 'repo':
    case 'default':
    default:
      return <RepoIcon />
  }
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

/** GitHub octicon arrow-up：推送 / 超前 */
function CoAuthorsIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5.5 7a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Zm5 0a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM1.75 12.25c0-1.66 1.79-3 3.75-3s3.75 1.34 3.75 3v.5a.75.75 0 0 1-.75.75H2.5a.75.75 0 0 1-.75-.75v-.5Zm7.25.5v-.5c0-.7-.23-1.35-.63-1.9.55-.2 1.16-.35 1.88-.35 1.96 0 3.75 1.34 3.75 3v.5a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75Z"
      />
    </svg>
  )
}

function PushIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M3.47 7.78A.75.75 0 0 1 4.53 7.78L7.25 5.061V14.25a.75.75 0 0 0 1.5 0V5.061l2.72 2.719a.75.75 0 1 0 1.06-1.061l-4.25-4.25a.75.75 0 0 0-1.06 0l-4.25 4.25a.75.75 0 0 0 0 1.061Z" />
    </svg>
  )
}

/** GitHub octicon arrow-down：拉取 / 落后 */
function PullIcon({ size = 16 }: { size?: number }) {
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
  const { setAppWindowTitle, openApp } = useOs()
  const modal = useWindowModal()

  const [hasToken, setHasToken] = useState(() => hasGithubCredentials())
  const [proxyConnected, setProxyConnected] = useState(() => isProxyServerConnected())
  const [view, setView] = useState<View>({ kind: 'home' })
  const [localRepos, setLocalRepos] = useState<GithubRepoSyncMeta[]>([])
  const [cloningRepos, setCloningRepos] = useState<GithubCloningRepository[]>(() =>
    listGithubCloningRepositories().slice(),
  )
  const [user, setUser] = useState<GithubUser | undefined>()
  /** 本地缓存头像的 blob URL；优先于远程 avatarUrl */
  const [avatarDisplayUrl, setAvatarDisplayUrl] = useState<string | undefined>()
  const [busyKind, setBusyKind] = useState<BusyKind>()
  const busyKindRef = useRef<BusyKind>(undefined)
  const viewRef = useRef(view)
  const repoWatchTimerRef = useRef<number | undefined>(undefined)
  const localReposWatchTimerRef = useRef<number | undefined>(undefined)
  const progressValueRef = useRef(0.08)
  const [progressLabel, setProgressLabel] = useState<string | undefined>()
  /** 0–1，对齐 GitHub Desktop 工具栏按钮进度条；未知进度时用不确定动画 */
  const [progressValue, setProgressValue] = useState<number | undefined>()
  const [repoFoldoutOpen, setRepoFoldoutOpen] = useState(false)
  const [branchFoldoutOpen, setBranchFoldoutOpen] = useState(false)
  const [syncMenuOpen, setSyncMenuOpen] = useState(false)
  const [repoFoldoutFilter, setRepoFoldoutFilter] = useState('')
  const [branchFoldoutFilter, setBranchFoldoutFilter] = useState('')
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('changes')

  const [cloneDialogOpen, setCloneDialogOpen] = useState(false)
  const [cloneDialogLoading, setCloneDialogLoading] = useState(false)
  const [cloneDialogError, setCloneDialogError] = useState<string | undefined>()
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [prefsTab, setPrefsTab] = useState<'accounts' | 'integrations' | 'git'>('accounts')
  const [desktopPrefs, setDesktopPrefs] = useState<GithubDesktopPrefs>(() => loadGithubDesktopPrefs())
  const [accountRefreshing, setAccountRefreshing] = useState(false)
  const [accountError, setAccountError] = useState<string | undefined>()
  const [cloneSourceTab, setCloneSourceTab] = useState<'github' | 'url'>('github')
  const [cloneFilter, setCloneFilter] = useState('')
  const [cloneUrl, setCloneUrl] = useState('')
  const [remoteRepos, setRemoteRepos] = useState<GithubRepoSummary[]>([])
  const [cloneOwner, setCloneOwner] = useState('')
  const [cloneRepo, setCloneRepo] = useState('')
  const [clonePathBlockReason, setClonePathBlockReason] = useState<string | undefined>()

  const [changes, setChanges] = useState<GithubChange[]>([])
  /** 未勾选、不参与本次提交的路径 */
  const [unstagedPaths, setUnstagedPaths] = useState<Set<string>>(() => new Set())
  const [selectedPath, setSelectedPath] = useState<string | undefined>()
  const [diffPreview, setDiffPreview] = useState<GithubChangePreview | undefined>()
  const [diffLoading, setDiffLoading] = useState(false)
  const [commitSummary, setCommitSummary] = useState('')
  const [commitDescription, setCommitDescription] = useState('')
  const [commitMode, setCommitMode] = useState<CommitMode>('auto')
  const aiReady = useOpenAiReady()
  /** 推动「上次获取」相对时间刷新 */
  const [nowMs, setNowMs] = useState(() => Date.now())

  const [historyCommits, setHistoryCommits] = useState<GithubCommitSummary[]>([])
  const [historyRemoteTruncated, setHistoryRemoteTruncated] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | undefined>()
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | undefined>()
  const [historyDetail, setHistoryDetail] = useState<GithubCommitDetail | undefined>()
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false)
  const [selectedHistoryFile, setSelectedHistoryFile] = useState<string | undefined>()
  const [historyFilePreview, setHistoryFilePreview] = useState<GithubChangePreview | undefined>()
  const [historyFilePreviewLoading, setHistoryFilePreviewLoading] = useState(false)
  const [unpushedCommitCount, setUnpushedCommitCount] = useState(0)
  const [stashCount, setStashCount] = useState(0)
  const [tipUnpushedSha, setTipUnpushedSha] = useState<string | undefined>()

  const busy = busyKind !== undefined
  const showNonRepoToolbar = view.kind === 'cloning' || view.kind === 'missing'
  const showRepoWorkspace = view.kind === 'repo'
  const showToolbar = showNonRepoToolbar || showRepoWorkspace
  const branchRemoteSha =
    view.kind === 'repo' ? currentBranchRemoteSha(view.meta) : undefined
  const branchPushedSha =
    view.kind === 'repo' ? currentBranchPushedSha(view.meta) : undefined
  const canPush = view.kind === 'repo' && branchHasUnpushedCommits(view.meta)
  const canPull =
    view.kind === 'repo' &&
    Boolean(branchRemoteSha) &&
    Boolean(branchPushedSha) &&
    branchRemoteSha !== branchPushedSha

  useEffect(() => {
    if (view.kind !== 'repo') {
      setUnpushedCommitCount(0)
      setTipUnpushedSha(undefined)
      setStashCount(0)
      return
    }
    let cancelled = false
    const { owner, repo, currentBranch } = view.meta
    void listUnpushedLocalCommits(owner, repo, currentBranch).then((commits) => {
      if (cancelled) return
      setUnpushedCommitCount(commits.length)
      setTipUnpushedSha(commits.length > 0 ? commits[commits.length - 1]!.sha : undefined)
    })
    void stashListGithub(view.meta).then((entries) => {
      if (!cancelled) setStashCount(entries.length)
    })
    return () => {
      cancelled = true
    }
  }, [view, canPush])

  const canAmend = canPush && Boolean(tipUnpushedSha)
  const canUndoTip =
    canPush && Boolean(tipUnpushedSha) && selectedCommitSha === tipUnpushedSha

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
    return subscribeGithubCloningRepositories(() => {
      setCloningRepos(listGithubCloningRepositories().slice())
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
    await reconcileGithubRepoAttributes().catch(() => undefined)
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

  const openPreferences = useCallback((tab?: 'accounts' | 'integrations' | 'git') => {
    const resolvedTab =
      tab === 'accounts' || tab === 'integrations' || tab === 'git' ? tab : 'accounts'
    setPrefsOpen(true)
    setPrefsTab(resolvedTab)
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
      dismissOsNotification(GITHUB_DESKTOP_MISSING_EMAIL_SLUG)
    }
  }, [hasToken])

  // 用户改邮箱或刷新到真实邮箱后，条件解除则清掉通知（不在此处重新激活，以免覆盖「忽略」）
  useEffect(() => {
    if (!shouldWarnGithubDesktopMissingEmail()) {
      dismissOsNotification(GITHUB_DESKTOP_MISSING_EMAIL_SLUG)
    }
  }, [desktopPrefs.gitUserEmail, user?.email])

  useEffect(() => {
    const handleOpenGitPrefs = () => {
      consumePendingOpenGithubDesktopGitPrefs()
      openPreferences('git')
    }

    if (consumePendingOpenGithubDesktopGitPrefs()) {
      openPreferences('git')
    }

    window.addEventListener(OPEN_GITHUB_DESKTOP_GIT_PREFS_EVENT, handleOpenGitPrefs)
    return () => window.removeEventListener(OPEN_GITHUB_DESKTOP_GIT_PREFS_EVENT, handleOpenGitPrefs)
  }, [openPreferences])

  const patchDesktopPrefs = useCallback((patch: Partial<Omit<GithubDesktopPrefs, 'version'>>) => {
    setDesktopPrefs(updateGithubDesktopPrefs(patch))
  }, [])

  const repoWorkspaceRef = useRef<HTMLDivElement>(null)
  const sidebarWidthRef = useRef(desktopPrefs.sidebarWidth)
  sidebarWidthRef.current = desktopPrefs.sidebarWidth

  const clampSidebarWidth = useCallback((value: number) => {
    return Math.min(
      GITHUB_DESKTOP_SIDEBAR_WIDTH_MAX,
      Math.max(GITHUB_DESKTOP_SIDEBAR_WIDTH_MIN, Math.round(value)),
    )
  }, [])

  const applySidebarWidthVar = useCallback((width: number) => {
    repoWorkspaceRef.current?.style.setProperty('--gd-sidebar-width', `${width}px`)
  }, [])

  useEffect(() => {
    if (!showRepoWorkspace) return
    applySidebarWidthVar(desktopPrefs.sidebarWidth)
  }, [showRepoWorkspace, desktopPrefs.sidebarWidth, applySidebarWidthVar])

  const onSidebarSashPointerDown = useCallback(
    (event: PointerEvent) => {
      const sash = event.currentTarget as HTMLElement
      event.preventDefault()
      sash.setPointerCapture(event.pointerId)
      const startX = event.clientX
      const startWidth = sidebarWidthRef.current

      const onMove = (moveEvent: PointerEvent) => {
        const next = clampSidebarWidth(startWidth + (moveEvent.clientX - startX))
        sidebarWidthRef.current = next
        applySidebarWidthVar(next)
      }
      const onUp = (upEvent: PointerEvent) => {
        sash.releasePointerCapture(upEvent.pointerId)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        patchDesktopPrefs({ sidebarWidth: sidebarWidthRef.current })
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [applySidebarWidthVar, clampSidebarWidth, patchDesktopPrefs],
  )

  const openInExternalEditor = useCallback(
    (owner: string, repo: string) => {
      const editor = loadGithubDesktopPrefs().externalEditor
      openApp(editor, {
        documentId: githubRepoRootPath(owner, repo),
      })
    },
    [openApp],
  )

  const openRepoInVscode = useCallback(
    (owner: string, repo: string) => {
      openApp('vscode', {
        documentId: githubRepoRootPath(owner, repo),
      })
    },
    [openApp],
  )

  const openRepoInFiles = useCallback(
    (owner: string, repo: string) => {
      openApp('files', {
        documentId: githubRepoRootPath(owner, repo),
      })
    },
    [openApp],
  )

  const refreshRepoState = useCallback(async (
    meta: GithubRepoSyncMeta,
    onProgress?: GithubProgress,
  ) => {
    let latest = (await getGithubRepoMeta(meta.owner, meta.repo)) ?? meta
    latest = await ensureGithubRevisionIdsReady(latest, onProgress)
    setView({ kind: 'repo', meta: latest })
    setSidebarTab('changes')
    setRepoFoldoutOpen(false)
    onProgress?.('检查本地更改…')
    const nextChanges = await detectGithubChanges(latest)
    setChanges(nextChanges)
    setSelectedPath((prev) => {
      if (prev && nextChanges.some((item) => item.path === prev)) return prev
      return nextChanges[0]?.path
    })
    onProgress?.('更新界面状态…')
  }, [])

  const refreshRepoChanges = useCallback(async (owner: string, repo: string) => {
    if (busyKindRef.current) return
    try {
      const latest = await getGithubRepoMeta(owner, repo)
      if (!latest) return
      if (busyKindRef.current) return
      setView((prev) =>
        prev.kind === 'repo' && prev.meta.owner === latest.owner && prev.meta.repo === latest.repo
          ? { kind: 'repo', meta: latest }
          : prev,
      )
      const nextChanges = await detectGithubChanges(latest)
      if (busyKindRef.current) return
      setChanges(nextChanges)
      setSelectedPath((prev) => {
        if (prev && nextChanges.some((item) => item.path === prev)) return prev
        return nextChanges[0]?.path
      })
    } catch {
      // 工作区重写中途扫描可能遇到短暂不一致，忽略即可
    }
  }, [])

  const scheduleRepoRefresh = useCallback(
    (owner: string, repo: string) => {
      if (busyKindRef.current) return
      if (repoWatchTimerRef.current !== undefined) {
        window.clearTimeout(repoWatchTimerRef.current)
      }
      repoWatchTimerRef.current = window.setTimeout(() => {
        repoWatchTimerRef.current = undefined
        if (busyKindRef.current) return
        void refreshRepoChanges(owner, repo)
      }, 100)
    },
    [refreshRepoChanges],
  )

  const repoWatchKey =
    view.kind === 'repo' ? `${view.meta.owner}/${view.meta.repo}` : undefined

  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    busyKindRef.current = busyKind
    if (busyKind && repoWatchTimerRef.current !== undefined) {
      window.clearTimeout(repoWatchTimerRef.current)
      repoWatchTimerRef.current = undefined
    }
  }, [busyKind])

  useEffect(() => {
    if (!repoWatchKey) return
    const [owner, repo] = repoWatchKey.split('/')
    if (!owner || !repo) return
    const root = githubRepoRootPath(owner, repo)
    let cancelled = false
    const unwatch = filesWatch(root, () => {
      if (cancelled || busyKindRef.current) return
      scheduleRepoRefresh(owner, repo)
    })
    return () => {
      cancelled = true
      if (repoWatchTimerRef.current !== undefined) {
        window.clearTimeout(repoWatchTimerRef.current)
        repoWatchTimerRef.current = undefined
      }
      unwatch()
    }
  }, [repoWatchKey, scheduleRepoRefresh])

  useEffect(() => {
    const unsubscribe = subscribeGithubRepoMeta((change) => {
      if (localReposWatchTimerRef.current !== undefined) {
        window.clearTimeout(localReposWatchTimerRef.current)
      }
      localReposWatchTimerRef.current = window.setTimeout(() => {
        localReposWatchTimerRef.current = undefined
        void refreshLocalRepos()
      }, 100)

      const current = viewRef.current
      if (
        current.kind === 'repo' &&
        current.meta.owner === change.owner &&
        current.meta.repo === change.repo
      ) {
        if (change.kind === 'deleted') {
          setView({ kind: 'home' })
          setChanges([])
          setSelectedPath(undefined)
          return
        }
        scheduleRepoRefresh(change.owner, change.repo)
      }
    })
    return () => {
      unsubscribe()
      if (localReposWatchTimerRef.current !== undefined) {
        window.clearTimeout(localReposWatchTimerRef.current)
        localReposWatchTimerRef.current = undefined
      }
    }
  }, [refreshLocalRepos, scheduleRepoRefresh])

  useEffect(() => {
    setUnstagedPaths((prev) => {
      const paths = new Set(changes.map((change) => change.path))
      const next = new Set<string>()
      for (const path of prev) {
        if (paths.has(path)) next.add(path)
      }
      return next
    })
  }, [changes])

  const stagedChanges = useMemo(
    () => changes.filter((change) => !unstagedPaths.has(change.path)),
    [changes, unstagedPaths],
  )

  const toggleChangeStaged = useCallback((path: string, staged: boolean) => {
    setUnstagedPaths((prev) => {
      const next = new Set(prev)
      if (staged) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const allChangesStaged =
    changes.length > 0 && stagedChanges.length === changes.length
  const partialCommit = stagedChanges.length > 0 && stagedChanges.length < changes.length
  const pendingCoAuthors = resolveCommitCoAuthors(desktopPrefs)
  const pendingCoAuthorLabel = formatCoAuthorNames(pendingCoAuthors)
  const commitButtonTitle =
    view.kind === 'repo'
      ? partialCommit
        ? `Commit ${stagedChanges.length} 项变更到 ${view.meta.currentBranch}，其余 ${changes.length - stagedChanges.length} 项留在本地`
        : `Commit 到 ${view.meta.currentBranch}`
      : undefined

  const toggleAllChangesStaged = useCallback(
    (staged: boolean) => {
      if (staged) setUnstagedPaths(new Set())
      else setUnstagedPaths(new Set(changes.map((change) => change.path)))
    },
    [changes],
  )

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
    void buildChangePreview(view.meta, change)
      .then((preview) => {
        if (cancelled) return
        setDiffPreview(preview)
        setDiffLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setDiffPreview({
          path: change.path,
          original: '',
          modified: '',
          notice: '无法读取该文件（可能已被删除或移动）',
        })
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
        setHistoryRemoteTruncated(
          (cached?.commits.length ?? 0) >= GITHUB_REMOTE_COMMIT_LIST_LIMIT,
        )
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
        // 本地 commit 优先走本地账本，避免缓存里没有 patch 时误走远端详情路径
        if (isLocalCommitSha(sha)) {
          const localCommits = await listGithubLocalCommits(owner, repo)
          const local = localCommits.find((item) => item.sha === sha)
          if (cancelled) return
          if (local) {
            const detail = buildLocalCommitDetail(local)
            setHistoryDetail(detail)
            setSelectedHistoryFile(detail.files[0]?.filename)
            setHistoryDetailLoading(false)
            void putCachedGithubCommitDetail(owner, repo, detail)
            return
          }
        }
        const cached = await getCachedGithubCommitDetail(owner, repo, sha)
        if (cancelled) return
        if (cached) {
          setHistoryDetail(cached)
          setSelectedHistoryFile(cached.files[0]?.filename)
          setHistoryDetailLoading(false)
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
        await showError('加载 commit 详情失败', err)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [view, sidebarTab, selectedCommitSha, showError])

  useEffect(() => {
    if (view.kind !== 'repo' || sidebarTab !== 'history' || !selectedCommitSha || !selectedHistoryFile) {
      setHistoryFilePreview(undefined)
      setHistoryFilePreviewLoading(false)
      return
    }
    if (!isLocalCommitSha(selectedCommitSha)) {
      setHistoryFilePreview(undefined)
      setHistoryFilePreviewLoading(false)
      return
    }

    let cancelled = false
    const { owner, repo } = view.meta
    const sha = selectedCommitSha
    const path = selectedHistoryFile
    setHistoryFilePreviewLoading(true)
    setHistoryFilePreview(undefined)

    void (async () => {
      try {
        const localCommits = await listGithubLocalCommits(owner, repo)
        const local = localCommits.find((item) => item.sha === sha)
        if (cancelled) return
        if (!local) {
          setHistoryFilePreviewLoading(false)
          return
        }
        const preview = await buildLocalCommitFilePreview(owner, repo, local, path)
        if (cancelled) return
        setHistoryFilePreview(preview)
        setHistoryFilePreviewLoading(false)
      } catch {
        if (cancelled) return
        setHistoryFilePreview(undefined)
        setHistoryFilePreviewLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [view, sidebarTab, selectedCommitSha, selectedHistoryFile])

  const runBusy = useCallback(
    async (kind: Exclude<BusyKind, undefined>, label: string, errorTitle: string, task: () => Promise<void>) => {
      if (kind === 'switch' || kind === 'pull' || kind === 'discard') {
        setChanges([])
        setSelectedPath(undefined)
        setDiffPreview(undefined)
      }
      busyKindRef.current = kind
      setBusyKind(kind)
      setProgressLabel(label)
      progressValueRef.current = 0.08
      setProgressValue(0.08)
      try {
        await task()
        setProgressLabel(undefined)
        progressValueRef.current = 0.08
        setProgressValue(undefined)
      } catch (err) {
        setProgressLabel(undefined)
        progressValueRef.current = 0.08
        setProgressValue(undefined)
        await showError(errorTitle, err)
      } finally {
        busyKindRef.current = undefined
        setBusyKind(undefined)
      }
    },
    [showError],
  )

  const bumpSyncProgress = useCallback((candidate: number) => {
    const next = Math.min(0.98, Math.max(progressValueRef.current, candidate))
    progressValueRef.current = next
    setProgressValue(next)
  }, [])

  const reportSyncProgress = useCallback((message: string, detail?: GithubProgressDetail) => {
    setProgressLabel(message)
    let candidate: number | undefined
    if (detail?.fraction !== undefined) {
      let mapped = detail.fraction
      if (message.includes('下载') || message.includes('压缩包')) {
        mapped = 0.35 + detail.fraction * 0.35
      } else if (message.includes('写入文件') || message.includes('写入基线快照')) {
        mapped = 0.7 + detail.fraction * 0.22
      }
      candidate = Math.max(0.08, mapped)
    } else if (message.includes('检查远端') || message.includes('检查远端分支')) {
      candidate = 0.2
    } else if (
      message.includes('扫描工作区') ||
      message.includes('检查本地更改') ||
      message.includes('检查本地是否有未 commit')
    ) {
      candidate = 0.28
    } else if (message.includes('更新界面状态') || message.includes('正在打开仓库')) {
      candidate = 0.82
    } else if (message.includes('分支列表') || message.includes('比较本地')) {
      candidate = 0.45
    } else if (message.includes('commit 历史')) {
      candidate = 0.32
    } else if (message.includes('压缩包') || message.includes('下载')) {
      candidate = 0.38
    } else if (
      message.includes('应用变更') ||
      message.includes('写入文件') ||
      message.includes('写入基线快照') ||
      message.includes('上传文件') ||
      message.includes('推送 commit') ||
      message.includes('合并远端变更')
    ) {
      const match = /(\d+)\s*\/\s*(\d+)/.exec(message)
      if (match) {
        const done = Number(match[1])
        const total = Number(match[2])
        const base = message.includes('上传文件') || message.includes('推送 commit') ? 0.45 : 0.35
        const span = message.includes('上传文件') || message.includes('推送 commit') ? 0.45 : 0.55
        candidate = total > 0 ? base + (done / total) * span : base + 0.2
      } else {
        candidate = 0.6
      }
    } else if (message.includes('创建 commit') || message.includes('更新远端分支')) {
      candidate = 0.9
    } else if (message.includes('推送完成')) {
      candidate = 1
    } else if (message.includes('读取远端 tree') || message.includes('检查未 commit')) {
      candidate = Math.max(0.35, progressValueRef.current)
    } else if (message.includes('解压压缩包')) {
      candidate = 0.68
    } else if (message.includes('更新同步') || message.includes('建立同步')) {
      candidate = 0.92
    } else if (message.includes('已是最新')) {
      candidate = 1
    } else {
      candidate = Math.min(0.9, progressValueRef.current + 0.08)
    }
    if (candidate !== undefined) {
      bumpSyncProgress(candidate)
    }
  }, [bumpSyncProgress])

  const closeCloneDialog = useCallback(() => {
    setCloneDialogOpen(false)
    setCloneDialogError(undefined)
    setClonePathBlockReason(undefined)
    setCloneSourceTab('github')
    setCloneFilter('')
    setCloneUrl('')
  }, [])

  const loadCloneRepos = useCallback(
    async (preserveSelection = false) => {
      setCloneDialogError(undefined)
      setCloneDialogLoading(true)
      try {
        const repos = await githubListUserRepos({ perPage: 50 })
        setRemoteRepos(repos)
        if (preserveSelection) {
          const stillSelected = repos.find(
            (item) =>
              githubRepoOwnerLogin(item.owner) === cloneOwner && item.name === cloneRepo,
          )
          if (!stillSelected) {
            const first = repos[0]
            setCloneOwner(first ? githubRepoOwnerLogin(first.owner) : '')
            setCloneRepo(first?.name ?? '')
          }
        } else {
          const first = repos[0]
          setCloneOwner(first ? githubRepoOwnerLogin(first.owner) : '')
          setCloneRepo(first?.name ?? '')
        }
      } catch (err) {
        setCloneDialogError(err instanceof Error ? err.message : String(err))
        setRemoteRepos([])
        if (!preserveSelection) {
          setCloneOwner('')
          setCloneRepo('')
        }
      } finally {
        setCloneDialogLoading(false)
      }
    },
    [cloneOwner, cloneRepo],
  )

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
    setCloneSourceTab('github')
    setCloneFilter('')
    setCloneUrl('')
    setCloneOwner('')
    setCloneRepo('')
    await loadCloneRepos(false)
  }, [hasToken, modal, loadCloneRepos])

  const handleSelectRemote = useCallback(
    (fullName: string) => {
      const hit = remoteRepos.find((item) => item.fullName === fullName)
      if (!hit) return
      setCloneOwner(githubRepoOwnerLogin(hit.owner))
      setCloneRepo(hit.name)
      setCloneDialogError(undefined)
    },
    [remoteRepos],
  )

  const applyFetchResult = useCallback(
    async (
      meta: GithubRepoSyncMeta,
      result: Awaited<ReturnType<typeof fetchGithubRemote>>,
    ) => {
      const fetchedAt = Date.now()
      const nextMeta = await applyGithubFetchResult(meta, result, fetchedAt)
      setNowMs(fetchedAt)
      setLocalRepos((prev) =>
        prev.map((item) =>
          item.owner === nextMeta.owner && item.repo === nextMeta.repo ? nextMeta : item,
        ),
      )
      setView((prev) =>
        prev.kind === 'repo' &&
        prev.meta.owner === nextMeta.owner &&
        prev.meta.repo === nextMeta.repo
          ? { kind: 'repo', meta: nextMeta }
          : prev,
      )
      const local = await listGithubLocalCommits(meta.owner, meta.repo)
      setHistoryCommits(mergeLocalHistoryLists(local, result.commits))
      setHistoryRemoteTruncated(result.commits.length >= GITHUB_REMOTE_COMMIT_LIST_LIMIT)
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
      await refreshRepoState(next, reportSyncProgress)
      await syncRemoteCaches(next)
    })
  }, [view, runBusy, refreshRepoState, syncRemoteCaches, reportSyncProgress])

  const handlePush = useCallback(() => {
    if (view.kind !== 'repo') return
    void runBusy('push', '正在推送到 origin…', '推送失败', async () => {
      const next = await pushGithubBranch(view.meta, reportSyncProgress)
      await refreshRepoState(next, reportSyncProgress)
      await syncRemoteCaches(next)
    })
  }, [view, runBusy, refreshRepoState, syncRemoteCaches, reportSyncProgress])

  /** Desktop 式：同一主按钮，Push / Pull / Fetch 随状态切换 */
  const handleSyncPrimary = useCallback(() => {
    if (canPush) handlePush()
    else if (canPull) handlePull()
    else handleFetch()
  }, [canPush, canPull, handlePush, handleFetch, handlePull])

  const beginClone = useCallback(
    async (owner: string, repo: string, options?: { reclone?: boolean }) => {
      const blockReason = options?.reclone
        ? await describeGithubRepoReclonePathBlockReason(owner, repo)
        : await describeGithubRepoClonePathBlockReason(owner, repo)
      if (blockReason) {
        await modal.alert({
          title: options?.reclone ? '无法重新克隆' : '无法克隆',
          message: blockReason,
        })
        return
      }

      const alreadyCloning = listGithubCloningRepositories().find(
        (entry) => entry.owner === owner && entry.repo === repo,
      )
      if (alreadyCloning) {
        setView({
          kind: 'cloning',
          id: alreadyCloning.id,
          owner: alreadyCloning.owner,
          repo: alreadyCloning.repo,
        })
        return
      }

      // 一开始就写入可恢复占位：刷新/中断后列表仍有记录，可点进重新克隆
      await saveGithubMissingRepoMeta(owner, repo)
      await refreshLocalRepos()

      const { repository, promise } = startGithubClone({ owner, repo })
      setView({ kind: 'cloning', id: repository.id, owner, repo })

      try {
        const meta = await promise
        await refreshLocalRepos()
        await refreshRepoState(meta)
        await syncRemoteCaches(meta)
      } catch (err) {
        const missingMeta = await saveGithubMissingRepoMeta(owner, repo)
        await refreshLocalRepos()
        setView((prev) =>
          prev.kind === 'cloning' && prev.id === repository.id
            ? { kind: 'missing', meta: missingMeta }
            : prev,
        )
        await showError('克隆失败', err)
      }
    },
    [refreshLocalRepos, refreshRepoState, syncRemoteCaches, showError, modal],
  )

  const handleClone = useCallback(async () => {
    if (!proxyConnected) {
      setCloneDialogError(GITHUB_ZIPBALL_PROXY_REQUIRED_MESSAGE)
      return
    }
    let owner = cloneOwner.trim()
    let repo = cloneRepo.trim()

    if (cloneSourceTab === 'url') {
      const parsed = parseGithubRepoUrl(cloneUrl)
      if (!parsed) {
        setCloneDialogError('请输入有效的 GitHub 仓库 URL')
        return
      }
      owner = parsed.owner
      repo = parsed.repo
    } else if (!owner || !repo) {
      setCloneDialogError('请选择要克隆的仓库')
      return
    }

    const alreadyCloning = listGithubCloningRepositories().some(
      (entry) => entry.owner === owner && entry.repo === repo,
    )
    if (alreadyCloning) {
      setCloneDialogError(`正在克隆 ${owner}/${repo}，请稍候`)
      return
    }

    const blockReason = await describeGithubRepoClonePathBlockReason(owner, repo)
    if (blockReason) {
      setCloneDialogError(blockReason)
      return
    }

    closeCloneDialog()
    await beginClone(owner, repo)
  }, [
    proxyConnected,
    cloneSourceTab,
    cloneUrl,
    cloneOwner,
    cloneRepo,
    closeCloneDialog,
    beginClone,
  ])

  const handleSelectCloning = useCallback((entry: GithubCloningRepository) => {
    setRepoFoldoutOpen(false)
    setView({ kind: 'cloning', id: entry.id, owner: entry.owner, repo: entry.repo })
  }, [])

  const handleOpenLocal = useCallback(
    (meta: GithubRepoSyncMeta) => {
      setRepoFoldoutOpen(false)
      // 先切到仓库视图，让工具栏「获取 origin」同款区块立刻显示打开进度
      setView({ kind: 'repo', meta })
      setChanges([])
      setSelectedPath(undefined)
      setDiffPreview(undefined)
      void runBusy('load', '正在打开仓库…', '打开仓库失败', async () => {
        const present = await isGithubRepoWorkingTreePresent(meta.owner, meta.repo)
        if (meta.missing || !present) {
          const missingMeta = await saveGithubMissingRepoMeta(meta.owner, meta.repo)
          await refreshLocalRepos()
          setView({ kind: 'missing', meta: missingMeta })
          return
        }
        await refreshRepoState(meta, reportSyncProgress)
      })
    },
    [runBusy, refreshRepoState, refreshLocalRepos, reportSyncProgress],
  )

  const handleCloneAgain = useCallback(
    (meta: GithubRepoSyncMeta) => {
      if (!proxyConnected) {
        void modal.alert({
          title: '需要代理服务器',
          message: GITHUB_ZIPBALL_PROXY_REQUIRED_MESSAGE,
        })
        return
      }
      void beginClone(meta.owner, meta.repo, { reclone: true })
    },
    [proxyConnected, modal, beginClone],
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

  const submitCommit = useCallback(
    async (message: string, selectedPaths: ReadonlySet<string>) => {
      if (view.kind !== 'repo') return
      const next = await commitGithubChanges({
        meta: view.meta,
        message,
        selectedPaths,
      })
      setCommitSummary('')
      setCommitDescription('')
      await refreshRepoState(next, reportSyncProgress)
    },
    [view, refreshRepoState, reportSyncProgress],
  )

  const handleCommit = useCallback(() => {
    if (view.kind !== 'repo') return
    const message = buildGithubCommitMessage(
      commitSummary,
      commitDescription,
      resolveCommitCoAuthors(desktopPrefs),
    )
    if (!message.trim()) return
    const selectedPaths = new Set(stagedChanges.map((change) => change.path))
    if (selectedPaths.size === 0) return
    void runBusy('commit', '正在 commit…', 'Commit 失败', async () => {
      await submitCommit(message, selectedPaths)
    })
  }, [view, commitSummary, commitDescription, desktopPrefs, stagedChanges, runBusy, submitCommit])

  const handleAutoCommit = useCallback(() => {
    if (view.kind !== 'repo') return
    const selectedPaths = new Set(stagedChanges.map((change) => change.path))
    if (selectedPaths.size === 0) return
    void runBusy('commit', '正在生成 commit 说明…', '自动 commit 失败', async () => {
      const generated = await generateGithubCommitMessage({
        meta: view.meta,
        changes: stagedChanges,
      })
      const message = buildGithubCommitMessage(
        generated.summary,
        generated.description,
        resolveCommitCoAuthors(desktopPrefs),
      )
      setProgressLabel('正在 commit…')
      await submitCommit(message, selectedPaths)
    })
  }, [view, stagedChanges, desktopPrefs, runBusy, submitCommit])

  const handleUndoTipCommit = useCallback(() => {
    if (view.kind !== 'repo') return
    void runBusy('undo', '正在撤销未推送 commit…', '撤销失败', async () => {
      const next = await undoLastUnpushedCommit(view.meta)
      setSelectedCommitSha(undefined)
      await refreshRepoState(next, reportSyncProgress)
    })
  }, [view, runBusy, refreshRepoState, reportSyncProgress])

  const handleAmend = useCallback(() => {
    if (view.kind !== 'repo' || !canAmend) return
    const message = buildGithubCommitMessage(
      commitSummary,
      commitDescription,
      resolveCommitCoAuthors(desktopPrefs),
    )
    if (!message.trim()) {
      void modal.alert({ title: '无法 Amend', message: '请先填写 commit 摘要。' })
      return
    }
    void runBusy('commit', '正在 amend…', 'Amend 失败', async () => {
      const next = await amendUnpushedCommit({
        meta: view.meta,
        message,
      })
      setCommitSummary('')
      setCommitDescription('')
      await refreshRepoState(next, reportSyncProgress)
    })
  }, [
    view,
    canAmend,
    commitSummary,
    commitDescription,
    desktopPrefs,
    runBusy,
    modal,
    refreshRepoState,
    reportSyncProgress,
  ])

  const handleCreateBranch = useCallback(() => {
    if (view.kind !== 'repo') return
    void (async () => {
      const name = await modal.prompt({
        title: '新建分支',
        label: '分支名',
        placeholder: 'feature/…',
        confirmLabel: '继续',
        validate: (value) => validateGithubBranchName(value),
      })
      if (!name) return
      const checkout = await modal.confirm({
        title: '切换到新分支？',
        message: `创建 ${name.trim()} 后切换过去（推荐）。取消则仅创建本地快照。`,
        confirmLabel: '创建并切换',
        cancelLabel: '仅创建',
      })
      const publish = await modal.confirm({
        title: '发布到 origin？',
        message: `在 GitHub 上创建 refs/heads/${name.trim()}（基于已推送基点）。`,
        confirmLabel: '发布',
        cancelLabel: '仅本地',
      })
      void runBusy('branch', `创建分支 ${name.trim()}…`, '创建分支失败', async () => {
        const next = await createGithubBranch({
          meta: view.meta,
          name,
          checkout,
          publish,
        })
        setBranchFoldoutOpen(false)
        await refreshRepoState(next, reportSyncProgress)
        if (publish) await syncRemoteCaches(next)
      })
    })()
  }, [view, modal, runBusy, refreshRepoState, reportSyncProgress, syncRemoteCaches])

  const handleStashSave = useCallback(() => {
    if (view.kind !== 'repo' || changes.length === 0) return
    void runBusy('stash', '正在贮藏…', '贮藏失败', async () => {
      const { meta: next } = await stashSaveGithubChanges({
        meta: view.meta,
        onProgress: reportSyncProgress,
      })
      await refreshRepoState(next, reportSyncProgress)
    })
  }, [view, changes.length, runBusy, refreshRepoState, reportSyncProgress])

  const handleStashPop = useCallback(() => {
    if (view.kind !== 'repo') return
    void runBusy('stash', '正在弹出贮藏…', '弹出贮藏失败', async () => {
      const next = await stashPopGithubChanges({
        meta: view.meta,
        onProgress: reportSyncProgress,
      })
      await refreshRepoState(next, reportSyncProgress)
    })
  }, [view, runBusy, refreshRepoState, reportSyncProgress])

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
      const result = await rebuildGithubBaseline(view.meta, {
        force: true,
        onProgress: reportSyncProgress,
      })
      const latest = await getGithubRepoMeta(view.meta.owner, view.meta.repo)
      const metaAfter = latest ?? view.meta
      await refreshRepoState(metaAfter, reportSyncProgress)

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
      if (result.status !== 'rebuilt') return
      // 重建已联网：顺便刷新分支名与 History 列表缓存，避免 Diff 好了但 History 仍空
      await syncRemoteCaches(metaAfter)
      await modal.alert({
        title: '基线已重建',
        message: `已用 tip 压缩包写入 ${result.written} 个本地快照（未改动工作区），并已刷新 commit 历史缓存。`,
      })
    })
  }, [view, runBusy, modal, refreshRepoState, proxyConnected, syncRemoteCaches, reportSyncProgress])

  const handleSwitchBranch = useCallback(
    (branch: string) => {
      if (view.kind !== 'repo') return
      void runBusy('switch', `切换分支 ${branch}…`, '切换分支失败', async () => {
        const { meta: next, syncedWithRemote } = await switchGithubBranch({
          meta: view.meta,
          branch,
          onProgress: reportSyncProgress,
        })
        await refreshRepoState(next, reportSyncProgress)
        if (syncedWithRemote) {
          await syncRemoteCaches(next)
        }
      })
    },
    [view, runBusy, refreshRepoState, syncRemoteCaches, reportSyncProgress],
  )

  const handleDiscardAll = useCallback(() => {
    if (view.kind !== 'repo' || changes.length === 0) return
    void modal
      .confirm({
        title: '丢弃全部更改',
        message:
          '将把工作区恢复为当前分支最后一次同步的状态，未 commit 的本地修改会全部丢失。此操作无法撤销。',
        confirmLabel: '丢弃全部',
        confirmTone: 'danger',
      })
      .then((confirmed) => {
        if (!confirmed) return
        void runBusy('discard', '正在丢弃更改…', '丢弃更改失败', async () => {
          const next = await discardGithubChanges({
            meta: view.meta,
            changes,
            discardAll: true,
            onProgress: reportSyncProgress,
          })
          await refreshRepoState(next, reportSyncProgress)
        })
      })
  }, [view, changes, modal, runBusy, refreshRepoState, reportSyncProgress])

  const handleDiscardChange = useCallback(
    (change: GithubChange) => {
      if (view.kind !== 'repo') return
      void runBusy('discard', `丢弃 ${change.path}…`, '丢弃更改失败', async () => {
        const next = await discardGithubChanges({
          meta: view.meta,
          changes: [change],
          discardAll: false,
        })
        await refreshRepoState(next, reportSyncProgress)
      })
    },
    [view, runBusy, refreshRepoState, reportSyncProgress],
  )

  const goHome = useCallback(() => {
    setView({ kind: 'home' })
    setRepoFoldoutOpen(false)
    setBranchFoldoutOpen(false)
    setSyncMenuOpen(false)
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

  const parsedCloneUrl = useMemo(() => parseGithubRepoUrl(cloneUrl), [cloneUrl])

  const cloneLocalPath = useMemo(() => {
    if (cloneSourceTab === 'url') {
      return parsedCloneUrl
        ? githubRepoRootPath(parsedCloneUrl.owner, parsedCloneUrl.repo)
        : '/dev/github/…'
    }
    if (cloneOwner.trim() && cloneRepo.trim()) {
      return githubRepoRootPath(cloneOwner.trim(), cloneRepo.trim())
    }
    return '/dev/github/…'
  }, [cloneSourceTab, parsedCloneUrl, cloneOwner, cloneRepo])

  const canCloneFromGithub =
    Boolean(cloneOwner.trim()) && Boolean(cloneRepo.trim())
  const canCloneFromUrl = Boolean(parsedCloneUrl)
  const canClone =
    cloneSourceTab === 'url' ? canCloneFromUrl : canCloneFromGithub

  useEffect(() => {
    if (!cloneDialogOpen) {
      setClonePathBlockReason(undefined)
      return
    }

    let owner = cloneOwner.trim()
    let repo = cloneRepo.trim()
    if (cloneSourceTab === 'url') {
      const parsed = parseGithubRepoUrl(cloneUrl)
      if (!parsed) {
        setClonePathBlockReason(undefined)
        return
      }
      owner = parsed.owner
      repo = parsed.repo
    }

    if (!owner || !repo) {
      setClonePathBlockReason(undefined)
      return
    }

    let cancelled = false
    void describeGithubRepoClonePathBlockReason(owner, repo).then((reason) => {
      if (!cancelled) setClonePathBlockReason(reason)
    })
    return () => {
      cancelled = true
    }
  }, [cloneDialogOpen, cloneSourceTab, cloneOwner, cloneRepo, cloneUrl])

  const menuBar = useMemo((): MenuDefinition[] => {
    const repoMeta = view.kind === 'repo' ? view.meta : undefined

    return [
      {
        label: 'GitHub Desktop',
        items: [
          {
            type: 'action',
            label: '设置…',
            shortcut: '⌘,',
            onClick: () => openPreferences(),
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
            label: '新建分支…',
            disabled: view.kind !== 'repo' || busy,
            onClick: () => handleCreateBranch(),
          },
          {
            type: 'action',
            label: '撤销未推送 commit',
            disabled: view.kind !== 'repo' || busy || !canAmend,
            onClick: () => handleUndoTipCommit(),
          },
          {
            type: 'action',
            label: changes.length > 0 ? '贮藏更改' : '弹出贮藏',
            disabled:
              view.kind !== 'repo' ||
              busy ||
              (changes.length === 0 && stashCount === 0),
            onClick: () => {
              if (changes.length > 0) handleStashSave()
              else handleStashPop()
            },
          },
          {
            type: 'action',
            label: canPush ? '推送' : canPull ? '拉取' : '获取',
            disabled: view.kind !== 'repo' || busy,
            onClick: () => handleSyncPrimary(),
          },
          ...(canPush && canPull
            ? [
                {
                  type: 'action' as const,
                  label: '拉取',
                  disabled: view.kind !== 'repo' || busy,
                  onClick: () => handlePull(),
                },
              ]
            : []),
          ...(canPush || canPull
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
    view,
    openClone,
    goHome,
    openApp,
    openPreferences,
    openInExternalEditor,
    desktopPrefs.externalEditor,
    handleDeleteLocal,
    handleRebuildBaseline,
    busy,
    canPush,
    canPull,
    canAmend,
    changes.length,
    stashCount,
    handleFetch,
    handlePull,
    handleSyncPrimary,
    handleCreateBranch,
    handleUndoTipCommit,
    handleStashSave,
    handleStashPop,
  ])

  useAppMenuBar(APP_ID, menuBar)

  const syncNetworkBusy =
    busyKind === 'pull' ||
    busyKind === 'fetch' ||
    busyKind === 'push' ||
    busyKind === 'switch' ||
    busyKind === 'rebuild' ||
    busyKind === 'discard' ||
    busyKind === 'load' ||
    busyKind === 'stash' ||
    busyKind === 'branch' ||
    busyKind === 'undo'

  const syncButtonTitle = (() => {
    if (busyKind === 'pull') return '拉取 origin'
    if (busyKind === 'fetch') return '获取 origin'
    if (busyKind === 'push') return '推送 origin'
    if (busyKind === 'switch') return '切换分支'
    if (busyKind === 'rebuild') return '重建本地基线'
    if (busyKind === 'load') return '打开仓库'
    if (busyKind === 'discard') return '丢弃更改'
    if (busyKind === 'stash') return '贮藏'
    if (busyKind === 'branch') return '创建分支'
    if (busyKind === 'undo') return '撤销 commit'
    if (canPush) return '推送 origin'
    if (canPull) return '拉取 origin'
    return '获取 origin'
  })()

  const syncButtonSubtitle = (() => {
    if (syncNetworkBusy) return progressLabel ?? '请稍候…'
    if (view.kind !== 'repo') return '准备中…'
    return formatLastFetchedLabel(view.meta.lastFetchedAt, nowMs)
  })()

  const syncIconKind: 'sync' | 'pull' | 'push' =
    canPush && !syncNetworkBusy ? 'push' : canPull && !syncNetworkBusy ? 'pull' : 'sync'
  const branchList = view.kind === 'repo' ? buildRepoBranchList(view.meta) : []

  const closeToolbarMenus = useCallback(() => {
    setRepoFoldoutOpen(false)
    setBranchFoldoutOpen(false)
    setSyncMenuOpen(false)
    setRepoFoldoutFilter('')
    setBranchFoldoutFilter('')
  }, [])

  const toolbarMenuOpen = repoFoldoutOpen || branchFoldoutOpen || syncMenuOpen

  useEffect(() => {
    if (!toolbarMenuOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element) {
        if (target.closest('.github-desktop__toolbar-foldout')) return
        if (target.closest('.github-desktop__toolbar-btn')) return
      }
      closeToolbarMenus()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeToolbarMenus()
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [toolbarMenuOpen, closeToolbarMenus])

  const toggleRepoFoldout = useCallback(() => {
    setBranchFoldoutOpen(false)
    setSyncMenuOpen(false)
    setBranchFoldoutFilter('')
    setRepoFoldoutOpen((open) => {
      if (open) setRepoFoldoutFilter('')
      return !open
    })
  }, [])

  const toggleBranchFoldout = useCallback(() => {
    setRepoFoldoutOpen(false)
    setSyncMenuOpen(false)
    setRepoFoldoutFilter('')
    setBranchFoldoutOpen((open) => {
      if (open) setBranchFoldoutFilter('')
      return !open
    })
  }, [])

  const toggleSyncMenu = useCallback(() => {
    setRepoFoldoutOpen(false)
    setBranchFoldoutOpen(false)
    setSyncMenuOpen((open) => !open)
  }, [])

  const activeCloning =
    view.kind === 'cloning' ? getGithubCloningRepository(view.id) : undefined
  const activeCloningProgress =
    view.kind === 'cloning' ? getGithubCloningProgress(view.id) : undefined
  const activeCloningFraction =
    view.kind === 'cloning' ? getGithubCloningProgressFraction(view.id) : undefined
  const listedLocalRepos = useMemo(
    () =>
      localRepos.filter(
        (meta) => !isGithubRepoCloning(meta.owner, meta.repo, cloningRepos),
      ),
    [localRepos, cloningRepos],
  )
  const filteredCloningRepos = useMemo(() => {
    const q = repoFoldoutFilter.trim().toLowerCase()
    if (!q) return cloningRepos
    return cloningRepos.filter(
      (entry) =>
        entry.repo.toLowerCase().includes(q) ||
        entry.owner.toLowerCase().includes(q) ||
        `${entry.owner}/${entry.repo}`.toLowerCase().includes(q),
    )
  }, [cloningRepos, repoFoldoutFilter])
  const filteredListedLocalRepos = useMemo(() => {
    const q = repoFoldoutFilter.trim().toLowerCase()
    if (!q) return listedLocalRepos
    return listedLocalRepos.filter((repo) => {
      const fullName = `${repo.owner}/${repo.repo}`.toLowerCase()
      const visibility = repo.remote
        ? formatGithubRepoVisibilityLabel(repo.remote).toLowerCase()
        : ''
      return (
        fullName.includes(q) ||
        repo.repo.toLowerCase().includes(q) ||
        repo.owner.toLowerCase().includes(q) ||
        repo.currentBranch.toLowerCase().includes(q) ||
        visibility.includes(q)
      )
    })
  }, [listedLocalRepos, repoFoldoutFilter])
  const filteredBranchSections = useMemo(() => {
    const q = branchFoldoutFilter.trim().toLowerCase()
    const filtered = q
      ? branchList.filter((branch) => branch.name.toLowerCase().includes(q))
      : branchList
    if (view.kind !== 'repo') {
      return { defaultBranch: undefined, recent: [], other: [] }
    }
    return groupRepoBranchList(view.meta, filtered)
  }, [branchList, branchFoldoutFilter, view])
  const filteredBranchCount =
    (filteredBranchSections.defaultBranch ? 1 : 0) +
    filteredBranchSections.recent.length +
    filteredBranchSections.other.length
  const cloningTitleOwner = activeCloning?.owner ?? (view.kind === 'cloning' ? view.owner : undefined)
  const cloningTitleRepo = activeCloning?.repo ?? (view.kind === 'cloning' ? view.repo : undefined)
  const toolbarRepoTitle =
    view.kind === 'repo'
      ? view.meta.repo
      : view.kind === 'missing'
        ? view.meta.repo
        : cloningTitleRepo
  const toolbarRepoIconKind = useMemo(() => resolveToolbarRepoIconKind(view), [view])
  const toolbarRepoDescription =
    view.kind === 'cloning'
      ? '正在克隆…'
      : view.kind === 'missing'
        ? '找不到本地仓库'
        : view.kind === 'repo' && view.meta.remote
          ? formatGithubRepoVisibilityLabel(view.meta.remote)
          : '当前仓库'
  const toolbarRepoFullName =
    view.kind === 'repo'
      ? `${view.meta.owner}/${view.meta.repo}`
      : view.kind === 'missing'
        ? `${view.meta.owner}/${view.meta.repo}`
        : cloningTitleOwner && cloningTitleRepo
          ? `${cloningTitleOwner}/${cloningTitleRepo}`
          : undefined

  const renderBranchFoldoutItem = (branch: GithubDesktopBranchListItem) => {
    if (view.kind !== 'repo') return undefined
    const active = branch.name === view.meta.currentBranch
    const localOutdated =
      branch.hasLocalSnapshot &&
      Boolean(branch.localTipSha) &&
      Boolean(branch.commitSha) &&
      branch.localTipSha !== branch.commitSha
    return (
      <button
        key={branch.name}
        type="button"
        class={`github-desktop__foldout-item github-desktop__foldout-item--branch${active ? ' is-active' : ''}${branch.hasLocalSnapshot ? ' github-desktop__foldout-item--local' : ''}`}
        disabled={busy}
        onClick={() => {
          closeToolbarMenus()
          if (!active) handleSwitchBranch(branch.name)
        }}
      >
        <div class="github-desktop__foldout-item-branch-head">
          <strong>{branch.name}</strong>
          {branch.protected ? (
            <span class="github-desktop__branch-badge github-desktop__branch-badge--protected" title="受保护分支">
              保护
            </span>
          ) : undefined}
        </div>
        <div class="github-desktop__foldout-item-branch-meta">
          <span class="github-desktop__foldout-item-branch-sha">
            {shortSha(branch.commitSha || '???????')}
            {localOutdated
              ? ` · 本地 ${shortSha(branch.localTipSha || '???????')}`
              : undefined}
          </span>
          {branch.hasLocalSnapshot ? (
            <span
              class={`github-desktop__branch-badge${localOutdated ? ' github-desktop__branch-badge--stale' : ''}`}
              title={
                localOutdated
                  ? `本地快照 ${branch.localTipSha?.slice(0, 7)}，与远端 ${branch.commitSha.slice(0, 7)} 不同`
                  : '已有本地快照，可离线切换'
              }
            >
              本地
            </span>
          ) : undefined}
        </div>
      </button>
    )
  }

  return (
    <div class="github-desktop">
      {showNonRepoToolbar ? (
        <div class="github-desktop__toolbar-wrap">
          <div class="github-desktop__toolbar">
            <button
              type="button"
              class={`github-desktop__toolbar-btn github-desktop__toolbar-btn--repo${
                repoFoldoutOpen ? ' is-open' : ''
              }`}
              onClick={toggleRepoFoldout}
              title={toolbarRepoFullName}
            >
              <span class="github-desktop__toolbar-icon">
                <ToolbarRepoIcon kind={toolbarRepoIconKind} />
              </span>
              <span class="github-desktop__toolbar-btn-text">
                <span class="github-desktop__toolbar-btn-description">{toolbarRepoDescription}</span>
                <span class="github-desktop__toolbar-btn-title">
                  {toolbarRepoTitle ?? '选择仓库'}
                </span>
              </span>
              <span class="github-desktop__toolbar-caret">
                <CaretIcon />
              </span>
            </button>

          </div>

          {repoFoldoutOpen ? (
            <div class="github-desktop__toolbar-foldout">
              <div class="github-desktop__foldout-filter-wrap">
                <input
                  class="settings__input github-desktop__foldout-filter"
                  value={repoFoldoutFilter}
                  placeholder="过滤仓库…"
                  aria-label="过滤仓库"
                  autoFocus
                  onInput={(event) =>
                    setRepoFoldoutFilter((event.target as HTMLInputElement).value)
                  }
                />
              </div>
              {filteredCloningRepos.length === 0 &&
              filteredListedLocalRepos.length === 0 ? (
                <div class="github-desktop__foldout-empty">
                  {repoFoldoutFilter.trim() ? '没有匹配的仓库' : '没有本地仓库'}
                </div>
              ) : (
                <>
                  {filteredCloningRepos.map((entry) => {
                    const active = view.kind === 'cloning' && view.id === entry.id
                    return (
                      <button
                        key={`cloning-${entry.id}`}
                        type="button"
                        class={`github-desktop__foldout-item github-desktop__foldout-item--with-icon github-desktop__foldout-item--cloning${active ? ' is-active' : ''}`}
                        onClick={() => {
                          closeToolbarMenus()
                          handleSelectCloning(entry)
                        }}
                      >
                        <span class="github-desktop__foldout-item-icon">
                          <ToolbarRepoIcon kind="cloning" />
                        </span>
                        <span class="github-desktop__foldout-item-body">
                          <strong>{entry.repo}</strong>
                          <span>
                            {entry.owner}/{entry.repo} · 正在克隆…
                          </span>
                        </span>
                      </button>
                    )
                  })}
                  {filteredListedLocalRepos.map((repo) => {
                    const v = view as View
                    const active =
                      (v.kind === 'repo' || v.kind === 'missing') &&
                      v.meta.owner === repo.owner &&
                      v.meta.repo === repo.repo
                    return (
                      <button
                        key={`${repo.owner}/${repo.repo}`}
                        type="button"
                        class={`github-desktop__foldout-item github-desktop__foldout-item--with-icon${repo.missing ? ' github-desktop__foldout-item--missing' : ''}${active ? ' is-active' : ''}`}
                        onClick={() => {
                          closeToolbarMenus()
                          handleOpenLocal(repo)
                        }}
                      >
                        <span class="github-desktop__foldout-item-icon">
                          <ToolbarRepoIcon kind={resolveLocalRepoIconKind(repo)} />
                        </span>
                        <span class="github-desktop__foldout-item-body">
                          <strong>{repo.repo}</strong>
                          <span>
                            {repo.missing
                              ? `${repo.owner}/${repo.repo} · 找不到本地文件`
                              : `${repo.owner}/${repo.repo} · ${repo.currentBranch}${
                                  repo.remote
                                    ? ` · ${formatGithubRepoVisibilityLabel(repo.remote)}`
                                    : ''
                                }`}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </>
              )}
              <div class="github-desktop__foldout-footer">
                <button
                  type="button"
                  class="github-desktop__btn github-desktop__foldout-footer-btn"
                  onClick={() => {
                    closeToolbarMenus()
                    goHome()
                  }}
                >
                  返回仓库列表
                </button>
              </div>
            </div>
          ) : undefined}

        </div>
      ) : undefined}

      {showToolbar && toolbarMenuOpen ? (
        <button
          type="button"
          class="github-desktop__toolbar-backdrop"
          aria-label="关闭菜单"
          onClick={closeToolbarMenus}
        />
      ) : undefined}

      {showToolbar && banner ? (
        <div class="github-desktop__banner">
          <p>{banner.message}</p>
          <button type="button" class="github-desktop__btn" onClick={banner.onAction}>
            {banner.actionLabel}
          </button>
        </div>
      ) : undefined}

      {!showRepoWorkspace ? (
      <div class="github-desktop__body">
        {view.kind === 'home' ? (
          <div
            class={`github-desktop__blank${
              cloningRepos.length > 0 || listedLocalRepos.length > 0
                ? ' github-desktop__blank--has-repos'
                : ''
            }`}
          >
            <div class="github-desktop__blank-left">
              <div class="github-desktop__blank-intro">
                <GithubDesktopIcon size={56} />
                <h2>开始使用吧！</h2>
                <p>把仓库添加到 GitHub Desktop，即可开始协作。</p>
              </div>
              {user ? (
                <p>
                  已登录为 <strong>@{user.login}</strong>
                  {' · '}
                  <button type="button" class="github-desktop__btn--link" onClick={() => openPreferences()}>
                    设置
                  </button>
                </p>
              ) : hasToken ? (
                <p>
                  已配置 Token
                  {' · '}
                  <button type="button" class="github-desktop__btn--link" onClick={() => openPreferences()}>
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
                      从 GitHub 克隆仓库
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
                    从 GitHub 克隆仓库
                  </button>
                )}
              </div>
            </div>
            <div class="github-desktop__blank-right">
              <h3>本地仓库</h3>
              <div class="github-desktop__local-list" role="list" aria-label="本地仓库">
                {cloningRepos.length === 0 && listedLocalRepos.length === 0 ? (
                  <div class="settings__empty">
                    还没有本地副本。克隆后会保存在 /dev/github/…
                  </div>
                ) : (
                  <>
                    {cloningRepos.map((entry) => (
                      <button
                        key={`cloning-${entry.id}`}
                        type="button"
                        class="settings__option-row github-desktop__local-list-item--cloning"
                        onClick={() => handleSelectCloning(entry)}
                      >
                        <span class="settings__row-meta">
                          <span class="settings__option-label">
                            {entry.owner}/{entry.repo}
                          </span>
                          <span class="settings__row-hint">
                            {getGithubCloningProgress(entry.id) ?? '正在克隆…'}
                          </span>
                        </span>
                      </button>
                    ))}
                    {listedLocalRepos.map((repo) => (
                      <button
                        key={`${repo.owner}/${repo.repo}`}
                        type="button"
                        class={`settings__option-row${repo.missing ? ' github-desktop__local-list-item--missing' : ''}`}
                        onClick={() => handleOpenLocal(repo)}
                      >
                        <span class="settings__row-meta">
                          <span class="settings__option-label">
                            {repo.owner}/{repo.repo}
                            {repo.remote
                              ? formatGithubRepoVisibilitySuffix(repo.remote)
                              : ''}
                          </span>
                          <span class="settings__row-hint">{formatLocalRepoHint(repo)}</span>
                        </span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        ) : undefined}

        {view.kind === 'cloning' ? (
          <div class="github-desktop__cloning">
            <div class="github-desktop__spinner" />
            <h2>
              正在克隆 {cloningTitleOwner}/{cloningTitleRepo}
            </h2>
            <progress
              class="github-desktop__cloning-progress"
              max={1}
              value={activeCloningFraction ?? 0.04}
            />
            <p>{activeCloningProgress ?? '请稍候…'}</p>
          </div>
        ) : undefined}

        {view.kind === 'missing' ? (
          <div class="github-desktop__missing">
            <h2>找不到 “{view.meta.repo}”</h2>
            <p>
              本地路径 <code>{githubRepoRootPath(view.meta.owner, view.meta.repo)}</code>{' '}
              不可用。可能是上次克隆未完成、失败，或文件已被移除。
            </p>
            <div class="github-desktop__missing-actions">
              <button
                type="button"
                class="github-desktop__btn github-desktop__btn--primary"
                disabled={busy}
                onClick={() => handleCloneAgain(view.meta)}
              >
                重新克隆
              </button>
              <button
                type="button"
                class="github-desktop__btn"
                disabled={busy}
                onClick={() => {
                  void handleDeleteLocal(view.meta)
                }}
              >
                移除
              </button>
            </div>
          </div>
        ) : undefined}
      </div>
      ) : undefined}

      {showRepoWorkspace ? (
        <div
          class="github-desktop__repo-workspace"
          ref={repoWorkspaceRef}
          style={{ '--gd-sidebar-width': `${desktopPrefs.sidebarWidth}px` }}
        >
          <div class="github-desktop__repo-col-left">
            <div class="github-desktop__toolbar-segment github-desktop__toolbar-segment--left">
              <button
                type="button"
                class={`github-desktop__toolbar-btn github-desktop__toolbar-btn--repo${
                  repoFoldoutOpen ? ' is-open' : ''
                }`}
                onClick={toggleRepoFoldout}
                title={toolbarRepoFullName}
              >
                <span class="github-desktop__toolbar-icon">
                  <ToolbarRepoIcon kind={toolbarRepoIconKind} />
                </span>
                <span class="github-desktop__toolbar-btn-text">
                  <span class="github-desktop__toolbar-btn-description">{toolbarRepoDescription}</span>
                  <span class="github-desktop__toolbar-btn-title">
                    {toolbarRepoTitle ?? '选择仓库'}
                  </span>
                </span>
                <span class="github-desktop__toolbar-caret">
                  <CaretIcon />
                </span>
              </button>

              {repoFoldoutOpen ? (
                <div class="github-desktop__toolbar-foldout">
                  <div class="github-desktop__foldout-filter-wrap">
                    <input
                      class="settings__input github-desktop__foldout-filter"
                      value={repoFoldoutFilter}
                      placeholder="过滤仓库…"
                      aria-label="过滤仓库"
                      autoFocus
                      onInput={(event) =>
                        setRepoFoldoutFilter((event.target as HTMLInputElement).value)
                      }
                    />
                  </div>
                  {filteredCloningRepos.length === 0 &&
                  filteredListedLocalRepos.length === 0 ? (
                    <div class="github-desktop__foldout-empty">
                      {repoFoldoutFilter.trim() ? '没有匹配的仓库' : '没有本地仓库'}
                    </div>
                  ) : (
                    <>
                      {filteredCloningRepos.map((entry) => {
                        const v = view as View
                        const active = v.kind === 'cloning' && v.id === entry.id
                        return (
                          <button
                            key={`cloning-${entry.id}`}
                            type="button"
                            class={`github-desktop__foldout-item github-desktop__foldout-item--with-icon github-desktop__foldout-item--cloning${active ? ' is-active' : ''}`}
                            onClick={() => {
                              closeToolbarMenus()
                              handleSelectCloning(entry)
                            }}
                          >
                            <span class="github-desktop__foldout-item-icon">
                              <ToolbarRepoIcon kind="cloning" />
                            </span>
                            <span class="github-desktop__foldout-item-body">
                              <strong>{entry.repo}</strong>
                              <span>
                                {entry.owner}/{entry.repo} · 正在克隆…
                              </span>
                            </span>
                          </button>
                        )
                      })}
                      {filteredListedLocalRepos.map((repo) => {
                        const v = view as View
                        const active =
                          (v.kind === 'repo' || v.kind === 'missing') &&
                          v.meta.owner === repo.owner &&
                          v.meta.repo === repo.repo
                        return (
                          <button
                            key={`${repo.owner}/${repo.repo}`}
                            type="button"
                            class={`github-desktop__foldout-item github-desktop__foldout-item--with-icon${repo.missing ? ' github-desktop__foldout-item--missing' : ''}${active ? ' is-active' : ''}`}
                            onClick={() => {
                              closeToolbarMenus()
                              handleOpenLocal(repo)
                            }}
                          >
                            <span class="github-desktop__foldout-item-icon">
                              <ToolbarRepoIcon kind={resolveLocalRepoIconKind(repo)} />
                            </span>
                            <span class="github-desktop__foldout-item-body">
                              <strong>{repo.repo}</strong>
                              <span>
                                {repo.missing
                                  ? `${repo.owner}/${repo.repo} · 找不到本地文件`
                                  : `${repo.owner}/${repo.repo} · ${repo.currentBranch}${
                                      repo.remote
                                        ? ` · ${formatGithubRepoVisibilityLabel(repo.remote)}`
                                        : ''
                                    }`}
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </>
                  )}
                  <div class="github-desktop__foldout-footer">
                    <button
                      type="button"
                      class="github-desktop__btn github-desktop__foldout-footer-btn"
                      onClick={() => {
                        closeToolbarMenus()
                        goHome()
                      }}
                    >
                      返回仓库列表
                    </button>
                  </div>
                </div>
              ) : undefined}
            </div>

            <div class="github-desktop__sidebar">
              <div class="github-desktop__tabs">
                <button
                  type="button"
                  class={`github-desktop__tab${sidebarTab === 'changes' ? ' is-active' : ''}`}
                  onClick={() => setSidebarTab('changes')}
                >
                  更改
                  {changes.length > 0 ? (
                    <span class="github-desktop__tab-badge">{changes.length}</span>
                  ) : undefined}
                </button>
                <button
                  type="button"
                  class={`github-desktop__tab${sidebarTab === 'history' ? ' is-active' : ''}`}
                  onClick={() => setSidebarTab('history')}
                >
                  历史
                </button>
              </div>

              {sidebarTab === 'changes' ? (
                <>
                  <FixedRowVirtualList
                    items={changes}
                    itemKey={(change) => change.path}
                    className="github-desktop__changes-list"
                    renderItem={(change) => {
                      const staged = !unstagedPaths.has(change.path)
                      return (
                        <div
                          class={`github-desktop__change${
                            selectedPath === change.path ? ' is-selected' : ''
                          }`}
                        >
                          <span class="github-desktop__change-check">
                            <IosCheckToggle
                              checked={staged}
                              disabled={busy}
                              size="small"
                              label={`将 ${change.path} 包含在本次 commit 中`}
                              onChange={(checked) => toggleChangeStaged(change.path, checked)}
                            />
                          </span>
                          <button
                            type="button"
                            class="github-desktop__change-main"
                            onClick={() => setSelectedPath(change.path)}
                          >
                            <span class="github-desktop__change-path">{change.path}</span>
                            <ChangeKindMark kind={change.kind} />
                          </button>
                          <button
                            type="button"
                            class="github-desktop__change-discard"
                            disabled={busy}
                            title={`丢弃对 ${change.path} 的更改`}
                            onClick={() => handleDiscardChange(change)}
                          >
                            丢弃
                          </button>
                        </div>
                      )
                    }}
                  />
                  <div class="github-desktop__changes-header github-desktop__changes-header--footer">
                    {changes.length > 0 ? (
                      <IosCheckToggle
                        checked={allChangesStaged}
                        disabled={busy}
                        size="small"
                        label={allChangesStaged ? '取消全选变更文件' : '全选变更文件'}
                        onChange={toggleAllChangesStaged}
                      />
                    ) : undefined}
                    <span class="github-desktop__changes-header-text">
                      {changes.length === 0
                        ? '无本地更改'
                        : stagedChanges.length === 0
                          ? '未选择文件'
                          : formatStagedChangesSummary(stagedChanges, changes.length)}
                    </span>
                    {changes.length > 0 ? (
                      <button
                        type="button"
                        class="github-desktop__discard-all"
                        disabled={busy}
                        onClick={handleDiscardAll}
                      >
                        丢弃全部
                      </button>
                    ) : undefined}
                    {changes.length > 0 ? (
                      <button
                        type="button"
                        class="github-desktop__discard-all"
                        disabled={busy}
                        onClick={handleStashSave}
                        title="贮藏当前未 commit 变更"
                      >
                        贮藏
                      </button>
                    ) : undefined}
                    {stashCount > 0 ? (
                      <button
                        type="button"
                        class="github-desktop__discard-all"
                        disabled={busy}
                        onClick={handleStashPop}
                        title={`弹出最近一条贮藏（共 ${stashCount}）`}
                      >
                        弹出贮藏{stashCount > 1 ? ` (${stashCount})` : ''}
                      </button>
                    ) : undefined}
                  </div>
                  <div class="github-desktop__commit">
                    <div class="github-desktop__commit-panel">
                      {commitMode === 'manual' ? (
                        <>
                          <input
                            value={commitSummary}
                            disabled={busy || (changes.length === 0 && !canAmend)}
                            placeholder="摘要（必填）"
                            onInput={(event) =>
                              setCommitSummary((event.target as HTMLInputElement).value)
                            }
                          />
                          <textarea
                            value={commitDescription}
                            disabled={busy || (changes.length === 0 && !canAmend)}
                            placeholder="描述"
                            onInput={(event) =>
                              setCommitDescription((event.target as HTMLTextAreaElement).value)
                            }
                          />
                          {pendingCoAuthorLabel ? (
                            <button
                              type="button"
                              class="github-desktop__commit-coauthors"
                              disabled={busy}
                              title="commit 说明将附带 Co-authored-by；点击打开设置"
                              onClick={() => openPreferences('git')}
                            >
                              <CoAuthorsIcon />
                              <span>协作者 · {pendingCoAuthorLabel}</span>
                            </button>
                          ) : undefined}
                          <button
                            type="button"
                            class="github-desktop__commit-btn"
                            disabled={
                              busy ||
                              changes.length === 0 ||
                              stagedChanges.length === 0 ||
                              !commitSummary.trim()
                            }
                            title={commitButtonTitle}
                            onClick={handleCommit}
                          >
                            {partialCommit
                              ? `Commit ${stagedChanges.length} 项到 ${view.meta.currentBranch}`
                              : `Commit 到 ${view.meta.currentBranch}`}
                          </button>
                          {canAmend ? (
                            <button
                              type="button"
                              class="github-desktop__commit-btn"
                              disabled={busy || !commitSummary.trim()}
                              title="修改最近一次未推送 commit"
                              onClick={handleAmend}
                            >
                              Amend 未推送 commit
                            </button>
                          ) : undefined}
                        </>
                      ) : (
                        <>
                          {pendingCoAuthorLabel ? (
                            <button
                              type="button"
                              class="github-desktop__commit-coauthors"
                              disabled={busy}
                              title="commit 说明将附带 Co-authored-by；点击打开设置"
                              onClick={() => openPreferences('git')}
                            >
                              <CoAuthorsIcon />
                              <span>协作者 · {pendingCoAuthorLabel}</span>
                            </button>
                          ) : undefined}
                          <button
                            type="button"
                            class="github-desktop__commit-btn github-desktop__commit-btn--auto"
                            disabled={
                              busy ||
                              !aiReady ||
                              changes.length === 0 ||
                              stagedChanges.length === 0
                            }
                            title={
                              busyKind === 'commit'
                                ? undefined
                                : aiReady
                                  ? partialCommit
                                    ? `由 AI 为 ${stagedChanges.length} 项已选变更生成说明并 commit，其余留在本地`
                                    : `由 AI 生成 commit 说明并 commit 到 ${view.meta.currentBranch}`
                                  : '请先在设置中配置 AI API Key'
                            }
                            onClick={handleAutoCommit}
                          >
                            {busyKind === 'commit'
                              ? '正在处理…'
                              : partialCommit
                                ? `Commit ${stagedChanges.length} 项到 ${view.meta.currentBranch}`
                                : `Commit 到 ${view.meta.currentBranch}`}
                          </button>
                        </>
                      )}
                    </div>
                    <div class="github-desktop__commit-tabs" role="tablist" aria-label="Commit 方式">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={commitMode === 'auto'}
                        class={`github-desktop__commit-tab${commitMode === 'auto' ? ' is-active' : ''}`}
                        onClick={() => setCommitMode('auto')}
                      >
                        自动
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={commitMode === 'manual'}
                        class={`github-desktop__commit-tab${commitMode === 'manual' ? ' is-active' : ''}`}
                        onClick={() => setCommitMode('manual')}
                      >
                        手动
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div class="github-desktop__changes-list">
                    {historyError ? (
                      <div class="github-desktop__sidebar-empty">{historyError}</div>
                    ) : historyLoading && historyCommits.length === 0 ? (
                      <div class="github-desktop__sidebar-empty">正在加载…</div>
                    ) : historyCommits.length === 0 ? (
                      <div class="github-desktop__sidebar-empty">
                        本地还没有 commit 历史缓存。点击工具栏「获取」从 GitHub 刷新（不改动工作区）。
                      </div>
                    ) : (
                      <>
                        {historyCommits.map((commit) => {
                          const unpushed = isLocalCommitSha(commit.sha)
                          const coAuthorLabel = formatCoAuthorNames(
                            parseCoAuthorTrailers(commit.message),
                          )
                          return (
                          <button
                            key={commit.sha}
                            type="button"
                            class={`github-desktop__history-item${
                              selectedCommitSha === commit.sha ? ' is-selected' : ''
                            }${unpushed ? ' github-desktop__history-item--unpushed' : ''}`}
                            onClick={() => setSelectedCommitSha(commit.sha)}
                          >
                            <span class="github-desktop__history-item-head">
                              <span class="github-desktop__history-message">
                                {commitSummaryLine(commit.message)}
                              </span>
                              {unpushed ? (
                                <span
                                  class="github-desktop__history-unpushed"
                                  title="尚未推送到 origin"
                                  aria-label="尚未推送到 origin"
                                >
                                  <PushIcon size={10} />
                                </span>
                              ) : undefined}
                            </span>
                            <span class="github-desktop__history-meta">
                              {shortSha(commit.sha)} · {commit.authorName}
                              {coAuthorLabel ? ` · ${coAuthorLabel}` : ''}
                              {unpushed ? ' · 未推送' : ''}
                            </span>
                          </button>
                          )
                        })}
                        {historyRemoteTruncated ? (
                          <p class="github-desktop__history-list-hint">
                            仅显示最近 {GITHUB_REMOTE_COMMIT_LIST_LIMIT}{' '}
                            条远端 commit
                          </p>
                        ) : undefined}
                      </>
                    )}
                  </div>
                  <div class="github-desktop__changes-header github-desktop__changes-header--footer">
                    {historyLoading
                      ? '加载 commit 历史…'
                      : historyError
                        ? '无法加载历史'
                        : `${historyCommits.length} 条 commit`}
                  </div>
                </>
              )}
            </div>
          </div>

          <div
            class="github-desktop__sidebar-sash"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整侧栏宽度"
            onPointerDown={onSidebarSashPointerDown}
          />

          <div class="github-desktop__repo-col-right">
            <div class="github-desktop__toolbar-segment github-desktop__toolbar-segment--right">
              <div class="github-desktop__toolbar-branch-wrap">
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

                {branchFoldoutOpen ? (
                  <div class="github-desktop__toolbar-foldout github-desktop__toolbar-foldout--branch">
                    <div class="github-desktop__foldout-filter-wrap">
                      <input
                        class="settings__input github-desktop__foldout-filter"
                        value={branchFoldoutFilter}
                        placeholder="过滤分支…"
                        aria-label="过滤分支"
                        autoFocus
                        onInput={(event) =>
                          setBranchFoldoutFilter((event.target as HTMLInputElement).value)
                        }
                      />
                    </div>
                    {filteredBranchCount === 0 ? (
                      <div class="github-desktop__foldout-empty">
                        {branchFoldoutFilter.trim() ? '没有匹配的分支' : '没有分支'}
                      </div>
                    ) : (
                      <>
                        {filteredBranchSections.defaultBranch ? (
                          <div class="github-desktop__foldout-section">
                            <div class="github-desktop__foldout-section-title">主分支</div>
                            {renderBranchFoldoutItem(filteredBranchSections.defaultBranch)}
                          </div>
                        ) : undefined}
                        {filteredBranchSections.recent.length > 0 ? (
                          <div class="github-desktop__foldout-section">
                            <div class="github-desktop__foldout-section-title">最近分支</div>
                            {filteredBranchSections.recent.map((branch) =>
                              renderBranchFoldoutItem(branch),
                            )}
                          </div>
                        ) : undefined}
                        {filteredBranchSections.other.length > 0 ? (
                          <div class="github-desktop__foldout-section">
                            <div class="github-desktop__foldout-section-title">其余分支</div>
                            {filteredBranchSections.other.map((branch) =>
                              renderBranchFoldoutItem(branch),
                            )}
                          </div>
                        ) : undefined}
                      </>
                    )}
                    <button
                      type="button"
                      class="github-desktop__foldout-item github-desktop__foldout-item--action"
                      disabled={busy}
                      onClick={() => {
                        handleCreateBranch()
                      }}
                    >
                      <strong>新建分支…</strong>
                      <span>从当前 tip 创建本地分支，可选发布到 origin</span>
                    </button>
                  </div>
                ) : undefined}
              </div>

              <div class="github-desktop__toolbar-sync-wrap">
                <div
                  class={`github-desktop__toolbar-sync${(canPull || canPush) && !syncNetworkBusy ? ' has-menu' : ''}`}
                >
                  <button
                    type="button"
                    class={`github-desktop__toolbar-btn github-desktop__toolbar-btn--sync${
                      syncNetworkBusy ? ' has-progress' : ''
                    }${syncMenuOpen ? ' is-open' : ''}`}
                    disabled={busy}
                    onClick={handleSyncPrimary}
                    aria-busy={syncNetworkBusy ? 'true' : undefined}
                    title={
                      syncNetworkBusy
                        ? syncButtonSubtitle
                        : canPush
                          ? '将本地 commit 推送到 origin'
                          : canPull
                            ? '将远端变更合入本地工作区（需无未 commit 改动）'
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
                      {syncIconKind === 'push' ? (
                        <PushIcon />
                      ) : syncIconKind === 'pull' ? (
                        <PullIcon />
                      ) : (
                        <SyncIcon />
                      )}
                    </span>
                    <span class="github-desktop__toolbar-btn-text">
                      <span class="github-desktop__toolbar-btn-title">{syncButtonTitle}</span>
                      <span class="github-desktop__toolbar-btn-description">{syncButtonSubtitle}</span>
                    </span>
                    {canPush && !syncNetworkBusy ? (
                      <span
                        class="github-desktop__toolbar-ahead-behind"
                        title={`${unpushedCommitCount} 个 commit 待推送`}
                        aria-label={`${unpushedCommitCount} 个 commit 待推送`}
                      >
                        <PushIcon size={10} />
                        <span class="github-desktop__toolbar-ahead-behind-count">
                          {Math.max(unpushedCommitCount, 1)}
                        </span>
                      </span>
                    ) : canPull && !syncNetworkBusy ? (
                      <span class="github-desktop__toolbar-ahead-behind" aria-hidden="true">
                        <PullIcon size={12} />
                      </span>
                    ) : undefined}
                  </button>
                  {(canPull || canPush) && !syncNetworkBusy ? (
                    <button
                      type="button"
                      class={`github-desktop__toolbar-btn github-desktop__toolbar-btn--sync-menu${
                        syncMenuOpen ? ' is-open' : ''
                      }`}
                      disabled={busy}
                      aria-label="获取与拉取选项"
                      onClick={toggleSyncMenu}
                    >
                      <CaretIcon />
                    </button>
                  ) : undefined}
                </div>

                {syncMenuOpen ? (
                  <div class="github-desktop__toolbar-foldout github-desktop__toolbar-foldout--sync">
                    {canPush && canPull ? (
                      <button
                        type="button"
                        class="github-desktop__foldout-item github-desktop__foldout-item--action"
                        disabled={busy}
                        onClick={() => {
                          closeToolbarMenus()
                          handlePull()
                        }}
                      >
                        <strong>拉取 origin</strong>
                        <span>将远端新提交变基并入本地（保留未推送 commit）</span>
                      </button>
                    ) : undefined}
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
            </div>

            <div class="github-desktop__diff">
              {sidebarTab === 'history' ? (
                !selectedCommitSha ? (
                  <div class="github-desktop__diff-empty">
                    <h3>选择一个 commit</h3>
                    <p>在左侧列表中选择 commit 以查看变更。</p>
                  </div>
                ) : historyDetailLoading && !historyDetail ? (
                  <div class="github-desktop__diff-empty">
                    <h3>正在加载 commit 详情…</h3>
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
                      {(() => {
                        const coAuthorLabel = formatCoAuthorNames(
                          parseCoAuthorTrailers(historyDetail.message),
                        )
                        if (!coAuthorLabel && !canUndoTip) return undefined
                        return (
                          <div class="github-desktop__history-detail-meta-row">
                            {coAuthorLabel ? (
                              <p
                                class="github-desktop__history-coauthors"
                                title="来自 commit 说明中的 Co-authored-by"
                              >
                                <CoAuthorsIcon />
                                <span>协作者 · {coAuthorLabel}</span>
                              </p>
                            ) : (
                              <span />
                            )}
                            {canUndoTip ? (
                              <button
                                type="button"
                                class="github-desktop__btn"
                                disabled={busy}
                                onClick={handleUndoTipCommit}
                                title="撤销此未推送 commit，变更回到 Changes"
                              >
                                撤销
                              </button>
                            ) : undefined}
                          </div>
                        )
                      })()}
                    </div>
                    <div class="github-desktop__history-files">
                      {historyDetail.files.length === 0 ? (
                        <div class="github-desktop__sidebar-empty">此 commit 没有文件变更信息</div>
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
                            <span class="github-desktop__change-path">{file.filename}</span>
                            <ChangeKindMark kind={commitFileStatusKind(file.status)} />
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
                        if (isLocalCommitSha(historyDetail.sha)) {
                          if (historyFilePreviewLoading) {
                            return (
                              <div class="github-desktop__diff-empty">
                                <h3>正在加载 diff…</h3>
                              </div>
                            )
                          }
                          if (historyFilePreview?.notice) {
                            return (
                              <div class="github-desktop__diff-notice">{historyFilePreview.notice}</div>
                            )
                          }
                          if (historyFilePreview) {
                            return (
                              <GithubDesktopDiffView
                                original={historyFilePreview.original}
                                modified={historyFilePreview.modified}
                              />
                            )
                          }
                          return (
                            <div class="github-desktop__diff-notice">
                              无法加载本地 commit 的 diff。
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
                    <h3>无法显示 commit</h3>
                  </div>
                )
              ) : changes.length === 0 ? (
                <div class="github-desktop__no-changes">
                  <div class="github-desktop__no-changes-header">
                    <h3>无本地更改</h3>
                    <p>当前仓库没有未 commit 的更改</p>
                  </div>
                  <div class="github-desktop__no-changes-suggestions">
                    <div class="github-desktop__no-changes-row">
                      <div class="github-desktop__no-changes-row-text">
                        <strong>在外部编辑器中打开此仓库</strong>
                        <span>在仓库菜单中也可找到此选项</span>
                      </div>
                      <button
                        type="button"
                        class="github-desktop__btn github-desktop__btn--primary"
                        onClick={() => openRepoInVscode(view.meta.owner, view.meta.repo)}
                      >
                        {formatOpenInBuiltinAppLabel('vscode')}
                      </button>
                    </div>
                    <div class="github-desktop__no-changes-row">
                      <div class="github-desktop__no-changes-row-text">
                        <strong>在文件应用中查看仓库文件</strong>
                      </div>
                      <button
                        type="button"
                        class="github-desktop__btn"
                        onClick={() => openRepoInFiles(view.meta.owner, view.meta.repo)}
                      >
                        在文件中显示
                      </button>
                    </div>
                  </div>
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
        </div>
      ) : undefined}

      <WindowModal
        open={cloneDialogOpen}
        title="克隆仓库"
        wide
        scrollBody
        align="top"
        panelClass="github-desktop__clone-modal"
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
              !canClone ||
              Boolean(clonePathBlockReason) ||
              busy,
            onClick: () => {
              void handleClone()
            },
          },
        ]}
      >
        <div class="github-desktop__clone-dialog">
          <SegmentedControl
            value={cloneSourceTab}
            ariaLabel="克隆来源"
            className="github-desktop__clone-source-tabs"
            items={[
              { id: 'github', label: 'GitHub.com' },
              { id: 'url', label: 'URL' },
            ]}
            onChange={(tab) => {
              setCloneSourceTab(tab)
              setCloneDialogError(undefined)
            }}
          />
          {cloneDialogError ? (
            <div class="github-desktop__clone-error">{cloneDialogError}</div>
          ) : clonePathBlockReason ? (
            <div class="github-desktop__clone-error">{clonePathBlockReason}</div>
          ) : undefined}
          {!proxyConnected ? (
            <div class="github-desktop__clone-error">
              {GITHUB_ZIPBALL_PROXY_REQUIRED_MESSAGE}{' '}
              <button type="button" class="github-desktop__btn--link" onClick={openProxySettings}>
                打开代理设置
              </button>
            </div>
          ) : undefined}
          {cloneSourceTab === 'github' ? (
            <div class="github-desktop__clone-github-panel">
              <div class="github-desktop__clone-filter-row">
                <input
                  class="settings__input github-desktop__clone-filter"
                  value={cloneFilter}
                  placeholder="过滤仓库…"
                  disabled={cloneDialogLoading}
                  onInput={(event) => setCloneFilter((event.target as HTMLInputElement).value)}
                />
                <button
                  type="button"
                  class="github-desktop__clone-refresh"
                  disabled={cloneDialogLoading || busy}
                  aria-label="刷新仓库列表"
                  title="刷新仓库列表"
                  onClick={() => {
                    void loadCloneRepos(true)
                  }}
                >
                  <span
                    class={`github-desktop__clone-refresh-icon${cloneDialogLoading ? ' is-spinning' : ''}`}
                    aria-hidden="true"
                  >
                    <ReloadIcon size={14} />
                  </span>
                </button>
              </div>
              <div
                class="settings__list github-desktop__clone-list"
                role="radiogroup"
                aria-label="仓库列表"
              >
                {cloneDialogLoading && remoteRepos.length === 0 ? (
                  <div class="settings__empty">正在加载仓库列表…</div>
                ) : filteredRemotes.length === 0 ? (
                  <div class="settings__empty">
                    {cloneFilter.trim() ? '没有匹配的仓库' : '没有可克隆的仓库'}
                  </div>
                ) : (
                  filteredRemotes.map((repo) => {
                    const selected =
                      cloneOwner === githubRepoOwnerLogin(repo.owner) && cloneRepo === repo.name
                    return (
                      <button
                        key={repo.fullName}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        class="settings__option-row"
                        onClick={() => {
                          handleSelectRemote(repo.fullName)
                        }}
                      >
                        <span class="settings__row-meta">
                          <span class="settings__option-label">
                            {repo.fullName}
                            {formatGithubRepoVisibilitySuffix(repo)}
                          </span>
                          <span class="settings__row-hint">
                            {repo.description || `默认分支 ${repo.defaultBranch}`}
                          </span>
                        </span>
                        {selected ? (
                          <span class="settings__option-check" aria-hidden="true">
                            ✓
                          </span>
                        ) : undefined}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          ) : (
            <div class="github-desktop__clone-url-panel">
              <label class="github-desktop__clone-url-label">
                <span class="settings__field-label">仓库 URL</span>
                <input
                  class="settings__input github-desktop__clone-url-input"
                  value={cloneUrl}
                  placeholder="https://github.com/owner/repo"
                  disabled={busy}
                  onInput={(event) => {
                    setCloneUrl((event.target as HTMLInputElement).value)
                    setCloneDialogError(undefined)
                  }}
                />
              </label>
              {cloneUrl.trim() && !parsedCloneUrl ? (
                <p class="github-desktop__clone-url-hint github-desktop__clone-url-hint--error">
                  请输入有效的 GitHub 仓库 URL
                </p>
              ) : parsedCloneUrl ? (
                <p class="github-desktop__clone-url-hint">
                  将克隆 <strong>
                    {parsedCloneUrl.owner}/{parsedCloneUrl.repo}
                  </strong>
                  ，使用仓库默认分支
                </p>
              ) : (
                <p class="github-desktop__clone-url-hint">
                  支持 https://github.com/owner/repo 或 git@github.com:owner/repo.git
                </p>
              )}
            </div>
          )}
          <div class="github-desktop__clone-path-row">
            <span class="settings__field-label">本地路径</span>
            <div class="github-desktop__clone-path">{cloneLocalPath}</div>
          </div>
        </div>
      </WindowModal>

      <WindowModal
        open={prefsOpen}
        title="设置"
        wide
        scrollBody
        align="top"
        panelClass="github-desktop__prefs-modal"
        onClose={closePreferences}
        actions={[
          {
            label: '完成',
            tone: 'primary',
            onClick: closePreferences,
          },
        ]}
        footer={
          prefsTab === 'accounts' ? (
            <p class="window-modal__footer-note">
              Token 由系统钥匙串保管；本应用只读取是否已配置。要更改或移除凭证，请在钥匙串中操作。账户资料仅在本机缓存，打开应用时不会请求 GitHub。
            </p>
          ) : prefsTab === 'integrations' ? (
            <p class="window-modal__footer-note">
              「仓库 → 在编辑器中打开」会使用此处选择的应用打开当前仓库。默认是{' '}
              {getBuiltinAppName('vscode')}。
            </p>
          ) : (
            <>
              <p class="window-modal__footer-note">
                默认取自账户显示名与主邮箱；拉不到邮箱时用 noreply。Token 需有邮箱读权限。留空则 commit 时同样回退。
              </p>
              <p class="window-modal__footer-note">
                开启后 commit 说明会附带 Instant Agent 的 Co-authored-by。
              </p>
            </>
          )
        }
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
                        { id: 'vscode', label: getBuiltinAppName('vscode') },
                        { id: 'files', label: getBuiltinAppName('files') },
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
              </section>
            ) : undefined}

            {prefsTab === 'git' ? (
              <>
                <section class="settings__section">
                  <h2 class="settings__section-title">Commit 作者</h2>
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
                </section>
              </>
            ) : undefined}
          </div>
        </div>
      </WindowModal>
    </div>
  )
}
