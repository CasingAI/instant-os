import {
  githubGitClone,
  githubGitCommit,
  githubGitDiff,
  githubGitDiscard,
  githubGitFetch,
  githubGitLog,
  githubGitPull,
  githubGitPush,
  githubGitStatus,
  githubGitSwitchBranch,
  type GithubGitContext,
  type GithubGitResult,
} from '../../apps/github-desktop/github-git.ts'
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
  InstantShellGrepOptions,
  InstantShellGrepResult,
  InstantShellHost,
  InstantShellOpenAppOptions,
} from './instant-shell-types.ts'
import { normalizeInstantShellUrl } from './instant-shell-url.ts'

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

async function runGithubGit(
  host: InstantShellHost,
  exec: (ctx: GithubGitContext) => Promise<GithubGitResult>,
): Promise<string> {
  const result = await exec(buildGithubGitContext(host))
  if (result.changeSet && result.changeSet.changes.length > 0) {
    host.noteExternalChangeSet(result.changeSet)
  }
  return result.summary
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
  return out
}

function assertGitDiscardPaths(paths: string[]): string[] {
  if (!Array.isArray(paths) || !paths.every((item) => typeof item === 'string')) {
    throw new Error('paths 必须是字符串数组')
  }
  return paths
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
          message: opts.message,
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
      isCaseSensitive: options?.caseSensitive === true,
      isRegex: options?.regex === true,
      maxMatches: options?.maxMatches,
    })
    return {
      matches: result.matches.map((match) => ({
        path: match.path,
        line: match.line,
        column: match.column,
        preview: match.preview,
        matchedText: match.matchedText,
      })),
      truncated: result.truncated,
      scannedFiles: result.scannedFiles,
      patternError: result.patternError,
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
    git: createInstantShellGitApi(host),
  }
}
