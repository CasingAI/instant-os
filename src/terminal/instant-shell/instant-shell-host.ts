import {
  flattenGithubGitResultForGuest,
  githubGitAmend,
  githubGitClone,
  githubGitCommit,
  githubGitCreateBranch,
  githubGitDiff,
  githubGitDiscard,
  githubGitFetch,
  githubGitLog,
  githubGitPull,
  githubGitPush,
  githubGitStashList,
  githubGitStashPop,
  githubGitStashSave,
  githubGitStatus,
  githubGitSwitchBranch,
  githubGitUndo,
  type GithubGitContext,
  type GithubGitResult,
} from '../../apps/github-desktop/github-git.ts'
import { withInstantAgentCoAuthor } from '../../apps/github-desktop/github-desktop-prefs.ts'
import { filesStat } from '../../apps/files/files-api.ts'
import { searchVfsText } from '../../apps/files/vfs-text-search.ts'
import { getDefaultFileOpenApp } from '../../os/file-open-registry.ts'
import { getDefaultUrlOpenApp } from '../../os/url-open-registry.ts'
import { isExtAppId, isGeneratedAppId, type AppId } from '../../os/types.ts'
import { basenameInstantShellPath, resolveInstantShellPath } from './instant-shell-path.ts'
import type {
  InstantShellApi,
  InstantShellGitApi,
  InstantShellGitCloneOptions,
  InstantShellGitCommitOptions,
  InstantShellGitCreateBranchOptions,
  InstantShellGrepOptions,
  InstantShellGrepResult,
  InstantShellHost,
  InstantShellOpenAppOptions,
  InstantShellWishOptions,
  InstantShellWishResult,
} from './instant-shell-types.ts'
import { normalizeInstantShellUrl } from './instant-shell-url.ts'
import { osNowMs } from '../../os/os-clock.ts'
import {
  WISHLIST_PATH,
  appendWish,
  findDuplicateWish,
  normalizeWishOptions,
} from './wishlist-store.ts'

function assertOpenAppOptions(options?: InstantShellOpenAppOptions): InstantShellOpenAppOptions | undefined {
  if (options === undefined) {
    return undefined
  }
  if (options.documentId !== undefined && options.url !== undefined) {
    throw new Error('documentId 与 url 不能同时指定')
  }
  return options
}

function requireWindowId(
  resolved: ReturnType<InstantShellHost['resolveTarget']>,
  action: string,
): string {
  if (resolved.type === 'window') {
    return resolved.windowId
  }
  if (resolved.windowId) {
    return resolved.windowId
  }
  throw new Error(`没有可${action}的窗口: ${resolved.appId}`)
}

function buildGithubGitContext(host: InstantShellHost): GithubGitContext {
  return {
    cwd: host.getCwd(),
    fsMode: host.getFsMode(),
    terminalSessionId: host.getTerminalSessionId(),
  }
}

async function runGithubGit<T extends Record<string, unknown>>(
  host: InstantShellHost,
  exec: (ctx: GithubGitContext) => Promise<GithubGitResult<T>>,
): Promise<{ summary: string } & T> {
  const result = await exec(buildGithubGitContext(host))
  if (result.changeSet && result.changeSet.changes.length > 0) {
    host.noteExternalChangeSet(result.changeSet)
  }
  return flattenGithubGitResultForGuest(result)
}

function assertGitCloneOptions(options: InstantShellGitCloneOptions): InstantShellGitCloneOptions {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('clone 选项必须是对象')
  }
  const out: InstantShellGitCloneOptions = {}
  if (options.url !== undefined) {
    if (typeof options.url !== 'string') throw new Error('url 必须是字符串')
    out.url = options.url
  }
  if (options.owner !== undefined) {
    if (typeof options.owner !== 'string') throw new Error('owner 必须是字符串')
    out.owner = options.owner
  }
  if (options.repo !== undefined) {
    if (typeof options.repo !== 'string') throw new Error('repo 必须是字符串')
    out.repo = options.repo
  }
  if (options.branch !== undefined) {
    if (typeof options.branch !== 'string') throw new Error('branch 必须是字符串')
    out.branch = options.branch
  }
  return out
}

function assertGitCommitOptions(options: InstantShellGitCommitOptions): InstantShellGitCommitOptions {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('commit 选项必须是对象')
  }
  if (typeof options.message !== 'string') {
    throw new Error('message 必须是字符串')
  }
  const out: InstantShellGitCommitOptions = { message: options.message }
  if (options.all !== undefined) {
    if (typeof options.all !== 'boolean') throw new Error('all 必须是布尔值')
    out.all = options.all
  }
  if (options.paths !== undefined) {
    if (!Array.isArray(options.paths) || !options.paths.every((item) => typeof item === 'string')) {
      throw new Error('paths 必须是字符串数组')
    }
    out.paths = options.paths
  }
  if (options.includeCoAuthor !== undefined) {
    if (typeof options.includeCoAuthor !== 'boolean') {
      throw new Error('includeCoAuthor 必须是布尔值')
    }
    out.includeCoAuthor = options.includeCoAuthor
  }
  return out
}

function assertGitDiscardPaths(paths: string[]): string[] {
  if (!Array.isArray(paths) || !paths.every((item) => typeof item === 'string')) {
    throw new Error('paths 必须是字符串数组')
  }
  return paths
}

function assertGitCreateBranchOptions(
  options: InstantShellGitCreateBranchOptions,
): InstantShellGitCreateBranchOptions {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('createBranch 选项必须是对象')
  }
  if (typeof options.name !== 'string' || !options.name.trim()) {
    throw new Error('name 必须是非空字符串')
  }
  const out: InstantShellGitCreateBranchOptions = { name: options.name.trim() }
  if (options.checkout !== undefined) {
    if (typeof options.checkout !== 'boolean') throw new Error('checkout 必须是布尔值')
    out.checkout = options.checkout
  }
  if (options.publish !== undefined) {
    if (typeof options.publish !== 'boolean') throw new Error('publish 必须是布尔值')
    out.publish = options.publish
  }
  return out
}

function createInstantShellGitApi(host: InstantShellHost): InstantShellGitApi {
  return {
    status: () => runGithubGit(host, (ctx) => githubGitStatus(ctx)),
    diff: (path) =>
      runGithubGit(host, (ctx) =>
        githubGitDiff(ctx, typeof path === 'string' && path.trim() ? path.trim() : undefined),
      ),
    log: (limit) =>
      runGithubGit(host, (ctx) =>
        githubGitLog(
          ctx,
          typeof limit === 'number' && Number.isFinite(limit) ? limit : undefined,
        ),
      ),
    clone: (options) => {
      const opts = assertGitCloneOptions(options)
      return runGithubGit(host, (ctx) => githubGitClone(ctx, opts))
    },
    commit: (options) => {
      const opts = assertGitCommitOptions(options)
      return runGithubGit(host, (ctx) =>
        githubGitCommit(ctx, {
          message: withInstantAgentCoAuthor(opts.message, opts.includeCoAuthor !== false),
          paths: opts.paths,
          all: opts.all === true,
        }),
      )
    },
    push: () => runGithubGit(host, (ctx) => githubGitPush(ctx)),
    pull: () => runGithubGit(host, (ctx) => githubGitPull(ctx)),
    fetch: () => runGithubGit(host, (ctx) => githubGitFetch(ctx)),
    switchBranch: (branch) => {
      if (typeof branch !== 'string' || !branch.trim()) {
        throw new Error('branch 必须是非空字符串')
      }
      return runGithubGit(host, (ctx) => githubGitSwitchBranch(ctx, branch))
    },
    discard: (paths) => {
      const list = assertGitDiscardPaths(paths)
      return runGithubGit(host, (ctx) => githubGitDiscard(ctx, list))
    },
    undo: () => runGithubGit(host, (ctx) => githubGitUndo(ctx)),
    amend: (message) => {
      if (typeof message !== 'string' || !message.trim()) {
        throw new Error('message 必须是非空字符串')
      }
      return runGithubGit(host, (ctx) => githubGitAmend(ctx, message.trim()))
    },
    createBranch: (options) => {
      const opts = assertGitCreateBranchOptions(options)
      return runGithubGit(host, (ctx) =>
        githubGitCreateBranch(ctx, opts.name, {
          checkout: opts.checkout,
          publish: opts.publish,
        }),
      )
    },
    stashSave: (message) => {
      if (message !== undefined && typeof message !== 'string') {
        throw new Error('message 必须是字符串')
      }
      const trimmed = typeof message === 'string' ? message.trim() : undefined
      return runGithubGit(host, (ctx) =>
        githubGitStashSave(ctx, trimmed ? trimmed : undefined),
      )
    },
    stashPop: () => runGithubGit(host, (ctx) => githubGitStashPop(ctx)),
    stashList: () => runGithubGit(host, (ctx) => githubGitStashList(ctx)),
  }
}

/** 由宿主绑定组装客侧 API 实现（纯 TS，不含 React / QuickJS）。 */
export function createInstantShellApi(host: InstantShellHost): InstantShellApi {
  const openApp = async (appId: string, options?: InstantShellOpenAppOptions): Promise<void> => {
    const id = appId.trim()
    if (!id) {
      throw new Error('appId 不能为空')
    }
    const opts = assertOpenAppOptions(options)

    if (isGeneratedAppId(id as AppId)) {
      const apps = host.listApps()
      const found = apps.find((app) => app.id === id)
      if (!found) {
        throw new Error(`未安装的生成应用: ${id}`)
      }
      host.openGeneratedApp(id, found.name)
      return
    }

    if (isExtAppId(id as AppId)) {
      const apps = host.listApps()
      const found = apps.find((app) => app.id === id)
      if (!found) {
        throw new Error(`未添加的外链应用: ${id}`)
      }
      host.openExtApp(id, found.name)
      return
    }

    host.openApp(id, opts)
  }

  const openPath = async (path: string): Promise<void> => {
    const absolutePath = resolveInstantShellPath(host.getCwd(), path)
    const entry = await filesStat(absolutePath)
    if (entry === undefined) {
      throw new Error(`路径不存在: ${absolutePath}`)
    }

    if (entry.kind === 'folder') {
      host.openApp('files', { documentId: absolutePath })
      return
    }

    if (entry.kind === 'symlink') {
      throw new Error(`无法打开符号链接: ${absolutePath}`)
    }

    const fileName = entry.name || basenameInstantShellPath(absolutePath)
    const appId = getDefaultFileOpenApp(fileName)
    if (!appId) {
      throw new Error(`没有可以用于打开这个文件的程序: ${fileName}`)
    }
    host.openApp(appId, { documentId: absolutePath })
  }

  const openUrl = async (url: string): Promise<void> => {
    const normalized = normalizeInstantShellUrl(url)
    host.openApp(getDefaultUrlOpenApp(), { url: normalized })
  }

  const focus = async (target: string): Promise<void> => {
    const resolved = host.resolveTarget(target)
    const windowId = requireWindowId(resolved, '聚焦')
    host.focusWindow(windowId)
  }

  const close = async (target: string): Promise<void> => {
    if (host.isBusy()) {
      const resolved = host.resolveTarget(target)
      const label =
        resolved.type === 'window'
          ? `窗口 ${resolved.windowId}`
          : `应用 ${resolved.appId}`
      const ok = await host.confirmClose(`终端正在执行任务。确定关闭${label}吗？`)
      if (!ok) {
        throw new Error('用户取消')
      }
    }

    const resolved = host.resolveTarget(target)
    if (resolved.type === 'window') {
      host.closeWindow(resolved.windowId)
      return
    }
    host.closeWindowsForApp(resolved.appId)
  }

  const minimize = async (target: string): Promise<void> => {
    const resolved = host.resolveTarget(target)
    const windowId = requireWindowId(resolved, '最小化')
    host.minimizeWindow(windowId)
  }

  const restore = async (target: string): Promise<void> => {
    const resolved = host.resolveTarget(target)
    const windowId = requireWindowId(resolved, '还原')
    host.restoreWindow(windowId)
  }

  const toggleFullscreen = async (target: string): Promise<void> => {
    const resolved = host.resolveTarget(target)
    const windowId = requireWindowId(resolved, '全屏切换')
    host.toggleFullscreen(windowId)
  }

  const toggleMaximize = async (target: string): Promise<void> => {
    const resolved = host.resolveTarget(target)
    const windowId = requireWindowId(resolved, '最大化切换')
    host.toggleMaximize(windowId)
  }

  const grep = async (
    query: string,
    options?: InstantShellGrepOptions,
  ): Promise<InstantShellGrepResult> => {
    const q = typeof query === 'string' ? query : ''
    if (!q.trim()) {
      throw new Error('query 不能为空')
    }
    const rootPath = resolveInstantShellPath(host.getCwd(), options?.path ?? '.')
    const result = await searchVfsText({
      query: q,
      rootPath,
      filesToInclude: options?.filesToInclude,
      filesToExclude: options?.filesToExclude,
      useExcludeSettingsAndIgnoreFiles: options?.useExcludeSettingsAndIgnoreFiles,
      isCaseSensitive: options?.caseSensitive === true,
      isRegex: options?.regex === true,
      maxMatches: options?.maxMatches,
      contextLines: options?.contextLines,
      maxFiles: options?.maxFiles,
      maxDepth: options?.maxDepth,
      maxFileBytes: options?.maxFileBytes,
      timeoutMs: options?.timeoutMs,
      includeTotalCount: options?.includeTotalCount,
    })
    return {
      matches: result.matches.map((match) => ({
        path: match.path,
        line: match.line,
        column: match.column,
        preview: match.preview,
        matchedText: match.matchedText,
        ...(match.context ? { context: match.context } : {}),
      })),
      truncated: result.truncated,
      truncatedReason: result.truncatedReason,
      scannedFiles: result.scannedFiles,
      filesToScan: result.filesToScan,
      totalFiles: result.totalFiles,
      patternError: result.patternError,
    }
  }

  const wish = async (options: InstantShellWishOptions): Promise<InstantShellWishResult> => {
    const normalized = normalizeWishOptions(options)
    const terminalSessionId = host.getTerminalSessionId()
    const duplicate = await findDuplicateWish({
      terminalSessionId,
      category: normalized.category,
      summary: normalized.summary,
    })
    if (duplicate) {
      return {
        wishId: duplicate.id,
        summary: duplicate.summary,
        duplicated: true,
        path: WISHLIST_PATH,
      }
    }

    const wishId = crypto.randomUUID()
    await appendWish({
      id: wishId,
      createdAt: osNowMs(),
      summary: normalized.summary,
      category: normalized.category,
      blockedStep: normalized.blockedStep,
      attempted: normalized.attempted,
      detail: normalized.detail,
      cwd: host.getCwd(),
      fsMode: host.getFsMode(),
      terminalSessionId,
    })
    return {
      wishId,
      summary: normalized.summary,
      duplicated: false,
      path: WISHLIST_PATH,
    }
  }

  return {
    openApp,
    openPath,
    openUrl,
    listApps: async () => host.listApps(),
    listWindows: async () => host.listWindows(),
    focus,
    close,
    minimize,
    restore,
    toggleFullscreen,
    toggleMaximize,
    grep,
    wish,
    git: createInstantShellGitApi(host),
  }
}
