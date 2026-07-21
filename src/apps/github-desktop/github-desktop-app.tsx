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
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { filesWatch } from '../files/files-api.ts'
import {
  GITHUB_ZIPBALL_PROXY_REQUIRED_MESSAGE,
  githubGetAuthenticatedUser,
  githubListBranches,
  githubListUserRepos,
  type GithubBranch,
  type GithubRepoSummary,
  type GithubUser,
} from './github-api.ts'
import {
  buildChangePreview,
  detectGithubChanges,
  type GithubChange,
} from './github-changes.ts'
import { commitAndPushGithubChanges, summarizeChanges } from './github-commit.ts'
import { pullGithubRepository, switchGithubBranch } from './github-pull.ts'
import { githubRepoRootPath } from './github-repo-paths.ts'
import {
  deleteGithubRepoMeta,
  getGithubRepoMeta,
  listGithubRepoMeta,
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
  | { kind: 'clone' }
  | { kind: 'repo'; meta: GithubRepoSyncMeta }

function changeKindMark(kind: GithubChange['kind']): string {
  if (kind === 'added') return 'A'
  if (kind === 'deleted') return 'D'
  return 'M'
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
  const [status, setStatus] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const [remoteRepos, setRemoteRepos] = useState<GithubRepoSummary[]>([])
  const [cloneOwner, setCloneOwner] = useState('')
  const [cloneRepo, setCloneRepo] = useState('')
  const [cloneBranch, setCloneBranch] = useState('')
  const [cloneBranches, setCloneBranches] = useState<GithubBranch[]>([])

  const [changes, setChanges] = useState<GithubChange[]>([])
  const [selectedPath, setSelectedPath] = useState<string | undefined>()
  const [diffText, setDiffText] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [branches, setBranches] = useState<GithubBranch[]>([])

  useEffect(() => {
    setAppWindowTitle(APP_ID, 'GitHub Desktop')
  }, [setAppWindowTitle])

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
      setUser(undefined)
      return
    }
    let cancelled = false
    void githubGetAuthenticatedUser()
      .then((next) => {
        if (!cancelled) setUser(next)
      })
      .catch(() => {
        if (!cancelled) setUser(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [hasToken])

  const refreshRepoState = useCallback(async (meta: GithubRepoSyncMeta) => {
    const latest = (await getGithubRepoMeta(meta.owner, meta.repo)) ?? meta
    setView({ kind: 'repo', meta: latest })
    const nextChanges = await detectGithubChanges(latest)
    setChanges(nextChanges)
    setSelectedPath((prev) => {
      if (prev && nextChanges.some((item) => item.path === prev)) return prev
      return nextChanges[0]?.path
    })
    try {
      const nextBranches = await githubListBranches(latest.owner, latest.repo)
      setBranches(nextBranches)
    } catch {
      setBranches([])
    }
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
      setDiffText('')
      return
    }
    const change = changes.find((item) => item.path === selectedPath)
    if (!change) {
      setDiffText('')
      return
    }
    let cancelled = false
    void buildChangePreview(view.meta, change).then((text) => {
      if (!cancelled) setDiffText(text)
    })
    return () => {
      cancelled = true
    }
  }, [view, selectedPath, changes])

  const runBusy = useCallback(async (label: string, task: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    setStatus(label)
    try {
      await task()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  const openClone = useCallback(async () => {
    if (!hasToken) {
      setError('请先在钥匙串中配置 GitHub Personal Access Token')
      return
    }
    setView({ kind: 'clone' })
    setError(undefined)
    setStatus('加载远端仓库列表…')
    setBusy(true)
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
      }
      setStatus(undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [hasToken])

  const handleSelectRemote = useCallback(async (fullName: string) => {
    const hit = remoteRepos.find((item) => item.fullName === fullName)
    if (!hit) return
    setCloneOwner(hit.owner)
    setCloneRepo(hit.name)
    setCloneBranch(hit.defaultBranch)
    setBusy(true)
    try {
      const branchList = await githubListBranches(hit.owner, hit.name)
      setCloneBranches(branchList)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [remoteRepos])

  const handleClone = useCallback(() => {
    if (!proxyConnected) {
      setError(GITHUB_ZIPBALL_PROXY_REQUIRED_MESSAGE)
      return
    }
    void runBusy('正在克隆…', async () => {
      const meta = await cloneGithubRepository({
        owner: cloneOwner.trim(),
        repo: cloneRepo.trim(),
        branch: cloneBranch.trim() || undefined,
        onProgress: setStatus,
      })
      await refreshLocalRepos()
      await refreshRepoState(meta)
      setStatus(`已克隆 ${meta.owner}/${meta.repo}`)
    })
  }, [
    proxyConnected,
    cloneOwner,
    cloneRepo,
    cloneBranch,
    runBusy,
    refreshLocalRepos,
    refreshRepoState,
  ])

  const handleOpenLocal = useCallback(
    (meta: GithubRepoSyncMeta) => {
      void runBusy('加载仓库…', async () => {
        await refreshRepoState(meta)
        setStatus(undefined)
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
      void runBusy('删除本地仓库…', async () => {
        await deleteLocalGithubRepository(meta.owner, meta.repo)
        await deleteGithubRepoMeta(meta.owner, meta.repo)
        await refreshLocalRepos()
        setView({ kind: 'home' })
        setStatus('已删除本地仓库')
      })
    },
    [modal, runBusy, refreshLocalRepos],
  )

  const handleCommit = useCallback(() => {
    if (view.kind !== 'repo') return
    void runBusy('提交并推送…', async () => {
      const next = await commitAndPushGithubChanges({
        meta: view.meta,
        message: commitMessage,
      })
      setCommitMessage('')
      await refreshRepoState(next)
      setStatus(`已提交并推送 ${next.headSha.slice(0, 7)}`)
    })
  }, [view, commitMessage, runBusy, refreshRepoState])

  const handlePull = useCallback(() => {
    if (view.kind !== 'repo') return
    void runBusy('拉取中…', async () => {
      const next = await pullGithubRepository({
        meta: view.meta,
        onProgress: setStatus,
      })
      await refreshRepoState(next)
      setStatus('拉取完成')
    })
  }, [view, runBusy, refreshRepoState])

  const handleSwitchBranch = useCallback(
    (branch: string) => {
      if (view.kind !== 'repo') return
      void runBusy(`切换分支 ${branch}…`, async () => {
        const next = await switchGithubBranch({
          meta: view.meta,
          branch,
          onProgress: setStatus,
        })
        await refreshRepoState(next)
        setStatus(`已切换到 ${next.currentBranch}`)
      })
    },
    [view, runBusy, refreshRepoState],
  )

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
            label: '退出 GitHub Desktop',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
      {
        label: '仓库',
        items: [
          {
            type: 'action',
            label: '克隆仓库…',
            onClick: () => {
              void openClone()
            },
          },
          {
            type: 'action',
            label: '返回仓库列表',
            onClick: () => {
              setView({ kind: 'home' })
              void refreshLocalRepos()
            },
          },
          { type: 'separator' },
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
          {
            type: 'action',
            label: '在 Virtual Studio Code 中打开',
            disabled: !repoMeta,
            onClick: () => {
              if (!repoMeta) return
              openApp('vscode', {
                documentId: githubRepoRootPath(repoMeta.owner, repoMeta.repo),
              })
            },
          },
          { type: 'separator' },
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
            label: '拉取',
            disabled: view.kind !== 'repo' || busy,
            onClick: () => handlePull(),
          },
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
    refreshLocalRepos,
    openApp,
    handleDeleteLocal,
    busy,
    handlePull,
  ])

  useAppMenuBar(APP_ID, menuBar)

  return (
    <div class="github-desktop">
      <div class="github-desktop__toolbar">
        {view.kind === 'repo' ? (
          <>
            <button
              type="button"
              class="github-desktop__btn"
              disabled={busy}
              onClick={() => {
                setView({ kind: 'home' })
                void refreshLocalRepos()
              }}
            >
              仓库列表
            </button>
            <div class="github-desktop__toolbar-title">
              {view.meta.owner}/{view.meta.repo}
            </div>
            <div class="github-desktop__row" style={{ maxWidth: 220 }}>
              <select
                value={view.meta.currentBranch}
                disabled={busy}
                onChange={(event) => {
                  const next = (event.target as HTMLSelectElement).value
                  if (next !== view.meta.currentBranch) handleSwitchBranch(next)
                }}
              >
                {(branches.length > 0
                  ? branches
                  : [{ name: view.meta.currentBranch, commitSha: view.meta.headSha, protected: false }]
                ).map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" class="github-desktop__btn" disabled={busy} onClick={handlePull}>
              拉取
            </button>
            <span class="github-desktop__toolbar-meta">{view.meta.headSha.slice(0, 7)}</span>
          </>
        ) : (
          <>
            <div class="github-desktop__toolbar-title">GitHub Desktop</div>
            {user ? <span class="github-desktop__toolbar-meta">@{user.login}</span> : undefined}
            <button
              type="button"
              class="github-desktop__btn"
              disabled={busy}
              onClick={() => openApp('keychain')}
            >
              钥匙串
            </button>
            <button
              type="button"
              class="github-desktop__btn github-desktop__btn--primary"
              disabled={busy || !hasToken}
              onClick={() => {
                void openClone()
              }}
            >
              克隆仓库
            </button>
          </>
        )}
      </div>

      <div class="github-desktop__body">
        {view.kind === 'home' ? (
          <div class="github-desktop__empty">
            <GithubDesktopIcon size={72} />
            <h2>本地仓库</h2>
            {!hasToken ? (
              <p>
                尚未配置 GitHub Token。请打开钥匙串，添加 Personal Access Token 后再克隆仓库。
              </p>
            ) : undefined}
            {hasToken && !proxyConnected ? (
              <p>
                克隆、切换分支与大范围拉取需要经代理服务器下载压缩包。请先在系统设置中连接代理服务器。
              </p>
            ) : undefined}
            {hasToken && proxyConnected && localRepos.length === 0 ? (
              <p>还没有本地副本。克隆一个仓库后，工作树会保存在 /repo/github/…</p>
            ) : undefined}
            {localRepos.length > 0 ? (
              <div class="github-desktop__list">
                {localRepos.map((repo) => (
                  <button
                    key={`${repo.owner}/${repo.repo}`}
                    type="button"
                    class="github-desktop__list-item"
                    onClick={() => handleOpenLocal(repo)}
                  >
                    <div class="github-desktop__list-item-main">
                      <strong>
                        {repo.owner}/{repo.repo}
                      </strong>
                      <span>
                        {repo.currentBranch} · {repo.headSha.slice(0, 7)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : undefined}
            {!hasToken ? (
              <button
                type="button"
                class="github-desktop__btn github-desktop__btn--primary"
                onClick={() => openApp('keychain')}
              >
                打开钥匙串
              </button>
            ) : !proxyConnected ? (
              <div class="github-desktop__row">
                <button
                  type="button"
                  class="github-desktop__btn github-desktop__btn--primary"
                  onClick={openProxySettings}
                >
                  打开代理设置
                </button>
                <button
                  type="button"
                  class="github-desktop__btn"
                  disabled={busy}
                  onClick={() => {
                    void openClone()
                  }}
                >
                  浏览远端仓库
                </button>
              </div>
            ) : (
              <button
                type="button"
                class="github-desktop__btn github-desktop__btn--primary"
                disabled={busy}
                onClick={() => {
                  void openClone()
                }}
              >
                克隆仓库
              </button>
            )}
          </div>
        ) : undefined}

        {view.kind === 'clone' ? (
          <div class="github-desktop__empty">
            <div class="github-desktop__clone">
              <h2>克隆仓库</h2>
              {!proxyConnected ? (
                <p class="github-desktop__hint">
                  {GITHUB_ZIPBALL_PROXY_REQUIRED_MESSAGE}
                  {' '}
                  <button
                    type="button"
                    class="github-desktop__btn"
                    onClick={openProxySettings}
                  >
                    打开代理设置
                  </button>
                </p>
              ) : undefined}
              <div class="github-desktop__field">
                <label>你的仓库</label>
                <select
                  value={cloneOwner && cloneRepo ? `${cloneOwner}/${cloneRepo}` : ''}
                  disabled={busy}
                  onChange={(event) => {
                    void handleSelectRemote((event.target as HTMLSelectElement).value)
                  }}
                >
                  {remoteRepos.map((repo) => (
                    <option key={repo.fullName} value={repo.fullName}>
                      {repo.fullName}
                      {repo.private ? '（私有）' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div class="github-desktop__field">
                <label>Owner</label>
                <input
                  value={cloneOwner}
                  disabled={busy}
                  onInput={(event) => setCloneOwner((event.target as HTMLInputElement).value)}
                />
              </div>
              <div class="github-desktop__field">
                <label>仓库名</label>
                <input
                  value={cloneRepo}
                  disabled={busy}
                  onInput={(event) => setCloneRepo((event.target as HTMLInputElement).value)}
                />
              </div>
              <div class="github-desktop__field">
                <label>分支</label>
                <select
                  value={cloneBranch}
                  disabled={busy}
                  onChange={(event) => setCloneBranch((event.target as HTMLSelectElement).value)}
                >
                  {(cloneBranches.length > 0
                    ? cloneBranches
                    : cloneBranch
                      ? [{ name: cloneBranch, commitSha: '', protected: false }]
                      : []
                  ).map((branch) => (
                    <option key={branch.name} value={branch.name}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
              <div class="github-desktop__row">
                <button
                  type="button"
                  class="github-desktop__btn"
                  disabled={busy}
                  onClick={() => setView({ kind: 'home' })}
                >
                  取消
                </button>
                <button
                  type="button"
                  class="github-desktop__btn github-desktop__btn--primary"
                  disabled={
                    busy || !proxyConnected || !cloneOwner.trim() || !cloneRepo.trim()
                  }
                  onClick={handleClone}
                >
                  克隆
                </button>
              </div>
            </div>
          </div>
        ) : undefined}

        {view.kind === 'repo' ? (
          <div class="github-desktop__repo">
            <div class="github-desktop__changes">
              <div class="github-desktop__changes-header">
                {changes.length === 0 ? '无本地变更' : summarizeChanges(changes)}
              </div>
              <div class="github-desktop__changes-list">
                {changes.map((change) => (
                  <button
                    key={change.path}
                    type="button"
                    class={`github-desktop__change${selectedPath === change.path ? ' is-selected' : ''}`}
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
            </div>
            <div class="github-desktop__diff">
              <pre class="github-desktop__diff-body">{diffText || '选择左侧文件查看变更预览'}</pre>
              <div class="github-desktop__commit-bar">
                <div class="github-desktop__field">
                  <label>提交说明</label>
                  <textarea
                    value={commitMessage}
                    disabled={busy || changes.length === 0}
                    placeholder="描述这次改动…"
                    onInput={(event) => setCommitMessage((event.target as HTMLTextAreaElement).value)}
                  />
                </div>
                <div class="github-desktop__commit-actions">
                  <button
                    type="button"
                    class="github-desktop__btn github-desktop__btn--primary"
                    disabled={busy || changes.length === 0 || !commitMessage.trim()}
                    onClick={handleCommit}
                  >
                    提交并推送
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : undefined}
      </div>

      {status || error ? (
        <div class={`github-desktop__status${error ? ' is-error' : ''}`}>
          {error ?? status}
        </div>
      ) : undefined}
    </div>
  )
}
