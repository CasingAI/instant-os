import { filesStat } from '../../apps/files/files-api.ts'
import { searchVfsText } from '../../apps/files/vfs-text-search.ts'
import { getDefaultFileOpenApp } from '../../os/file-open-registry.ts'
import { isExtAppId, isGeneratedAppId } from '../../os/types.ts'
import { basenameInstantShellPath, resolveInstantShellPath } from './instant-shell-path.ts'
import type {
  InstantShellApi,
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

/** 由宿主绑定组装客侧 API 实现（纯 TS，不含 React / QuickJS）。 */
export function createInstantShellApi(host: InstantShellHost): InstantShellApi {
  const openApp = async (appId: string, options?: InstantShellOpenAppOptions): Promise<void> => {
    const id = appId.trim()
    if (!id) {
      throw new Error('appId 不能为空')
    }
    const opts = assertOpenAppOptions(options)

    if (isGeneratedAppId(id)) {
      const apps = host.listApps()
      const found = apps.find((app) => app.id === id)
      if (!found) {
        throw new Error(`未安装的生成应用: ${id}`)
      }
      host.openGeneratedApp(id, found.name)
      return
    }

    if (isExtAppId(id)) {
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
    host.openApp('browser', { url: normalized })
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
  }
}
