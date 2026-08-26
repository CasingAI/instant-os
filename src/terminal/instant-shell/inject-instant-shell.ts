import type { QuickJSAsyncContext, QuickJSHandle } from 'quickjs-emscripten'
import type { QuickJsAsyncBridge } from '../../quickjs/quickjs-async-bridge.ts'
import { formatQuickJsBridgeErrorMessage } from '../../quickjs/quickjs-bridge-error.ts'
import { dispatchSyscallIfExists, type QuickJsSyscallChain } from '../../quickjs/quickjs-syscall.ts'
import { createInstantShellApi } from './instant-shell-host.ts'
import type {
  InstantShellGitCloneOptions,
  InstantShellGitCommitOptions,
  InstantShellGitCreateBranchOptions,
  InstantShellGrepOptions,
  InstantShellHost,
  InstantShellOpenAppOptions,
  InstantShellWishCategory,
  InstantShellWishOptions,
} from './instant-shell-types.ts'
import { isWishCategory } from './wishlist-store.ts'

export type InjectInstantShellOptions = {
  context: QuickJSAsyncContext
  asyncBridge: QuickJsAsyncBridge
  host: InstantShellHost
  isDestroyed: () => boolean
  /** 壳层域跨沙箱调用拦截链；未传则命令直接走实现 */
  syscallChain?: QuickJsSyscallChain
}

function guestError(context: QuickJSAsyncContext, error: unknown): QuickJSHandle {
  const message = formatQuickJsBridgeErrorMessage('instant-shell', error)
  return context.unwrapResult(
    context.evalCode(
      `(function () { return new Error(${JSON.stringify(message)}); })()`,
      'instant-shell-error.js',
    ),
  )
}

function encodeJsonValue(context: QuickJSAsyncContext, value: unknown): QuickJSHandle {
  return context.unwrapResult(context.evalCode(`(${JSON.stringify(value)})`, 'instant-shell-json.js'))
}

function readStringArg(
  context: QuickJSAsyncContext,
  handle: QuickJSHandle | undefined,
  label: string,
): string {
  if (handle === undefined) {
    throw new Error(`${label} 不能为空`)
  }
  const dumped = context.dump(handle)
  if (typeof dumped !== 'string') {
    throw new Error(`${label} 必须是字符串`)
  }
  return dumped
}

function readOptionalStringArg(
  context: QuickJSAsyncContext,
  handle: QuickJSHandle | undefined,
): string | undefined {
  if (handle === undefined || context.typeof(handle) === 'undefined') {
    return undefined
  }
  const dumped = context.dump(handle)
  if (typeof dumped !== 'string') {
    throw new Error('参数必须是字符串')
  }
  return dumped
}

function readOptionalNumberArg(
  context: QuickJSAsyncContext,
  handle: QuickJSHandle | undefined,
): number | undefined {
  if (handle === undefined || context.typeof(handle) === 'undefined') {
    return undefined
  }
  const dumped = context.dump(handle)
  if (typeof dumped !== 'number' || !Number.isFinite(dumped)) {
    throw new Error('参数必须是数字')
  }
  return dumped
}

function readOpenAppOptions(
  context: QuickJSAsyncContext,
  handle: QuickJSHandle | undefined,
): InstantShellOpenAppOptions | undefined {
  if (handle === undefined || context.typeof(handle) === 'undefined') {
    return undefined
  }
  const dumped = context.dump(handle)
  if (dumped === null || typeof dumped !== 'object' || Array.isArray(dumped)) {
    throw new Error('openApp 选项必须是对象')
  }
  const record = dumped as Record<string, unknown>
  const options: InstantShellOpenAppOptions = {}
  if (record.documentId !== undefined) {
    if (typeof record.documentId !== 'string') {
      throw new Error('documentId 必须是字符串')
    }
    options.documentId = record.documentId
  }
  if (record.url !== undefined) {
    if (typeof record.url !== 'string') {
      throw new Error('url 必须是字符串')
    }
    options.url = record.url
  }
  return options
}

function readGrepOptions(
  context: QuickJSAsyncContext,
  handle: QuickJSHandle | undefined,
): InstantShellGrepOptions | undefined {
  if (handle === undefined || context.typeof(handle) === 'undefined') {
    return undefined
  }
  const dumped = context.dump(handle)
  if (dumped === null || typeof dumped !== 'object' || Array.isArray(dumped)) {
    throw new Error('grep 选项必须是对象')
  }
  const record = dumped as Record<string, unknown>
  const options: InstantShellGrepOptions = {}
  if (record.path !== undefined) {
    if (typeof record.path !== 'string') {
      throw new Error('path 必须是字符串')
    }
    options.path = record.path
  }
  if (record.filesToInclude !== undefined) {
    if (typeof record.filesToInclude !== 'string') {
      throw new Error('filesToInclude 必须是字符串')
    }
    options.filesToInclude = record.filesToInclude
  }
  if (record.filesToExclude !== undefined) {
    if (typeof record.filesToExclude !== 'string') {
      throw new Error('filesToExclude 必须是字符串')
    }
    options.filesToExclude = record.filesToExclude
  }
  if (record.useExcludeSettingsAndIgnoreFiles !== undefined) {
    if (typeof record.useExcludeSettingsAndIgnoreFiles !== 'boolean') {
      throw new Error('useExcludeSettingsAndIgnoreFiles 必须是布尔值')
    }
    options.useExcludeSettingsAndIgnoreFiles = record.useExcludeSettingsAndIgnoreFiles
  }
  if (record.caseSensitive !== undefined) {
    if (typeof record.caseSensitive !== 'boolean') {
      throw new Error('caseSensitive 必须是布尔值')
    }
    options.caseSensitive = record.caseSensitive
  }
  if (record.regex !== undefined) {
    if (typeof record.regex !== 'boolean') {
      throw new Error('regex 必须是布尔值')
    }
    options.regex = record.regex
  }
  if (record.maxMatches !== undefined) {
    if (typeof record.maxMatches !== 'number' || !Number.isFinite(record.maxMatches)) {
      throw new Error('maxMatches 必须是数字')
    }
    options.maxMatches = Math.floor(record.maxMatches)
  }
  if (record.contextLines !== undefined) {
    if (typeof record.contextLines !== 'number' || !Number.isFinite(record.contextLines)) {
      throw new Error('contextLines 必须是数字')
    }
    options.contextLines = Math.max(0, Math.floor(record.contextLines))
  }
  if (record.maxFiles !== undefined) {
    if (typeof record.maxFiles !== 'number' || !Number.isFinite(record.maxFiles)) {
      throw new Error('maxFiles 必须是数字')
    }
    // 0 表示不限制文件数
    options.maxFiles = Math.max(0, Math.floor(record.maxFiles))
  }
  if (record.maxDepth !== undefined) {
    if (typeof record.maxDepth !== 'number' || !Number.isFinite(record.maxDepth)) {
      throw new Error('maxDepth 必须是数字')
    }
    options.maxDepth = Math.max(0, Math.floor(record.maxDepth))
  }
  if (record.maxFileBytes !== undefined) {
    if (typeof record.maxFileBytes !== 'number' || !Number.isFinite(record.maxFileBytes)) {
      throw new Error('maxFileBytes 必须是数字')
    }
    options.maxFileBytes = Math.max(1, Math.floor(record.maxFileBytes))
  }
  if (record.timeoutMs !== undefined) {
    if (typeof record.timeoutMs !== 'number' || !Number.isFinite(record.timeoutMs)) {
      throw new Error('timeoutMs 必须是数字')
    }
    options.timeoutMs = Math.max(1, Math.floor(record.timeoutMs))
  }
  if (record.includeTotalCount !== undefined) {
    if (typeof record.includeTotalCount !== 'boolean') {
      throw new Error('includeTotalCount 必须是布尔值')
    }
    options.includeTotalCount = record.includeTotalCount
  }
  return options
}

function readGitCloneOptions(
  context: QuickJSAsyncContext,
  handle: QuickJSHandle | undefined,
): InstantShellGitCloneOptions {
  if (handle === undefined || context.typeof(handle) === 'undefined') {
    throw new Error('clone 选项必须是对象')
  }
  const dumped = context.dump(handle)
  if (dumped === null || typeof dumped !== 'object' || Array.isArray(dumped)) {
    throw new Error('clone 选项必须是对象')
  }
  const record = dumped as Record<string, unknown>
  const options: InstantShellGitCloneOptions = {}
  if (record.url !== undefined) {
    if (typeof record.url !== 'string') throw new Error('url 必须是字符串')
    options.url = record.url
  }
  if (record.owner !== undefined) {
    if (typeof record.owner !== 'string') throw new Error('owner 必须是字符串')
    options.owner = record.owner
  }
  if (record.repo !== undefined) {
    if (typeof record.repo !== 'string') throw new Error('repo 必须是字符串')
    options.repo = record.repo
  }
  if (record.branch !== undefined) {
    if (typeof record.branch !== 'string') throw new Error('branch 必须是字符串')
    options.branch = record.branch
  }
  return options
}

function readGitCommitOptions(
  context: QuickJSAsyncContext,
  handle: QuickJSHandle | undefined,
): InstantShellGitCommitOptions {
  if (handle === undefined || context.typeof(handle) === 'undefined') {
    throw new Error('commit 选项必须是对象')
  }
  const dumped = context.dump(handle)
  if (dumped === null || typeof dumped !== 'object' || Array.isArray(dumped)) {
    throw new Error('commit 选项必须是对象')
  }
  const record = dumped as Record<string, unknown>
  if (typeof record.message !== 'string') {
    throw new Error('message 必须是字符串')
  }
  const options: InstantShellGitCommitOptions = { message: record.message }
  if (record.all !== undefined) {
    if (typeof record.all !== 'boolean') throw new Error('all 必须是布尔值')
    options.all = record.all
  }
  if (record.paths !== undefined) {
    if (
      !Array.isArray(record.paths) ||
      !record.paths.every((item) => typeof item === 'string')
    ) {
      throw new Error('paths 必须是字符串数组')
    }
    options.paths = record.paths as string[]
  }
  if (record.includeCoAuthor !== undefined) {
    if (typeof record.includeCoAuthor !== 'boolean') {
      throw new Error('includeCoAuthor 必须是布尔值')
    }
    options.includeCoAuthor = record.includeCoAuthor
  }
  return options
}

function readStringArrayArg(
  context: QuickJSAsyncContext,
  handle: QuickJSHandle | undefined,
  label: string,
): string[] {
  if (handle === undefined) {
    throw new Error(`${label} 不能为空`)
  }
  const dumped = context.dump(handle)
  if (!Array.isArray(dumped) || !dumped.every((item) => typeof item === 'string')) {
    throw new Error(`${label} 必须是字符串数组`)
  }
  return dumped as string[]
}

function readGitCreateBranchOptions(
  context: QuickJSAsyncContext,
  handle: QuickJSHandle | undefined,
): InstantShellGitCreateBranchOptions {
  if (handle === undefined || context.typeof(handle) === 'undefined') {
    throw new Error('createBranch 选项必须是对象')
  }
  const dumped = context.dump(handle)
  if (dumped === null || typeof dumped !== 'object' || Array.isArray(dumped)) {
    throw new Error('createBranch 选项必须是对象')
  }
  const record = dumped as Record<string, unknown>
  if (typeof record.name !== 'string') {
    throw new Error('name 必须是字符串')
  }
  const options: InstantShellGitCreateBranchOptions = { name: record.name }
  if (record.checkout !== undefined) {
    if (typeof record.checkout !== 'boolean') throw new Error('checkout 必须是布尔值')
    options.checkout = record.checkout
  }
  if (record.publish !== undefined) {
    if (typeof record.publish !== 'boolean') throw new Error('publish 必须是布尔值')
    options.publish = record.publish
  }
  return options
}

function readWishOptions(
  context: QuickJSAsyncContext,
  handle: QuickJSHandle | undefined,
): InstantShellWishOptions {
  if (handle === undefined || context.typeof(handle) === 'undefined') {
    throw new Error('wish 选项必须是对象')
  }
  const dumped = context.dump(handle)
  if (dumped === null || typeof dumped !== 'object' || Array.isArray(dumped)) {
    throw new Error('wish 选项必须是对象')
  }
  const record = dumped as Record<string, unknown>
  if (typeof record.summary !== 'string') {
    throw new Error('summary 必须是字符串')
  }
  if (!isWishCategory(record.category)) {
    throw new Error(
      'category 必须是 capability | policy | network | data | tooling | other',
    )
  }
  if (typeof record.blockedStep !== 'string') {
    throw new Error('blockedStep 必须是字符串')
  }
  const options: InstantShellWishOptions = {
    summary: record.summary,
    category: record.category as InstantShellWishCategory,
    blockedStep: record.blockedStep,
  }
  if (record.attempted !== undefined) {
    if (
      !Array.isArray(record.attempted) ||
      !record.attempted.every((item) => typeof item === 'string')
    ) {
      throw new Error('attempted 必须是字符串数组')
    }
    options.attempted = record.attempted as string[]
  }
  if (record.detail !== undefined) {
    if (typeof record.detail !== 'string') {
      throw new Error('detail 必须是字符串')
    }
    options.detail = record.detail
  }
  return options
}

/**
 * 将 `globalThis.instant` 注入 QuickJS（终端专用壳层 API）。
 * 须在 asyncBridge.injectGlobals() 之后调用。
 */
export function injectInstantShell(options: InjectInstantShellOptions): void {
  const { context, asyncBridge, host, isDestroyed, syscallChain } = options
  const api = createInstantShellApi(host)

  const runAsync = (
    work: () => Promise<unknown>,
    /** 出沙箱的命令名（shell.openApp / shell.git.status …）；传了就走拦截链 */
    syscallName?: string,
  ): QuickJSHandle => {
    const deferred = asyncBridge.createDeferredPromise()
    void (async () => {
      try {
        if (isDestroyed()) {
          throw new Error('QuickJS 实例已销毁')
        }
        const value =
          syscallName !== undefined
            ? await dispatchSyscallIfExists(syscallChain, syscallName, {}, work)
            : await work()
        if (isDestroyed()) {
          asyncBridge.abandonDeferred(deferred)
          return
        }
        if (value === undefined) {
          asyncBridge.settleGuestPromise(deferred, { ok: true, value: context.undefined })
          return
        }
        const encoded = encodeJsonValue(context, value)
        asyncBridge.settleGuestPromise(deferred, { ok: true, value: encoded })
      } catch (error) {
        if (isDestroyed()) {
          asyncBridge.abandonDeferred(deferred)
          return
        }
        asyncBridge.settleGuestPromise(deferred, {
          ok: false,
          error: guestError(context, error),
        })
      }
    })()
    return deferred.handle
  }

  const instant = context.newObject()

  const bind = (
    target: QuickJSHandle,
    name: string,
    impl: (...args: QuickJSHandle[]) => QuickJSHandle,
  ) => {
    const fn = context.newFunction(name, (...argHandles) => impl(...argHandles))
    context.setProp(target, name, fn)
    fn.dispose()
  }

  bind(instant, 'openApp', (appIdHandle, optionsHandle) =>
    runAsync(async () => {
      const appId = readStringArg(context, appIdHandle, 'appId')
      const openOptions = readOpenAppOptions(context, optionsHandle)
      await api.openApp(appId, openOptions)
    }, 'shell.openApp'),
  )

  bind(instant, 'openPath', (pathHandle) =>
    runAsync(async () => {
      await api.openPath(readStringArg(context, pathHandle, 'path'))
    }, 'shell.openPath'),
  )

  bind(instant, 'openUrl', (urlHandle) =>
    runAsync(async () => {
      await api.openUrl(readStringArg(context, urlHandle, 'url'))
    }, 'shell.openUrl'),
  )

  bind(instant, 'listApps', () => runAsync(async () => api.listApps(), 'shell.listApps'))

  bind(instant, 'listWindows', () => runAsync(async () => api.listWindows(), 'shell.listWindows'))

  bind(instant, 'focus', (targetHandle) =>
    runAsync(async () => {
      await api.focus(readStringArg(context, targetHandle, 'target'))
    }, 'shell.focus'),
  )

  bind(instant, 'close', (targetHandle) =>
    runAsync(async () => {
      await api.close(readStringArg(context, targetHandle, 'target'))
    }, 'shell.close'),
  )

  bind(instant, 'minimize', (targetHandle) =>
    runAsync(async () => {
      await api.minimize(readStringArg(context, targetHandle, 'target'))
    }, 'shell.minimize'),
  )

  bind(instant, 'restore', (targetHandle) =>
    runAsync(async () => {
      await api.restore(readStringArg(context, targetHandle, 'target'))
    }, 'shell.restore'),
  )

  bind(instant, 'toggleFullscreen', (targetHandle) =>
    runAsync(async () => {
      await api.toggleFullscreen(readStringArg(context, targetHandle, 'target'))
    }, 'shell.toggleFullscreen'),
  )

  bind(instant, 'toggleMaximize', (targetHandle) =>
    runAsync(async () => {
      await api.toggleMaximize(readStringArg(context, targetHandle, 'target'))
    }, 'shell.toggleMaximize'),
  )

  bind(instant, 'grep', (queryHandle, optionsHandle) =>
    runAsync(async () => {
      const query = readStringArg(context, queryHandle, 'query')
      const grepOptions = readGrepOptions(context, optionsHandle)
      return await api.grep(query, grepOptions)
    }, 'shell.grep'),
  )

  bind(instant, 'wish', (optionsHandle) =>
    runAsync(
    async () => api.wish(readWishOptions(context, optionsHandle)),
    'shell.wish',
  ),
  )

  const git = context.newObject()
  bind(git, 'status', () => runAsync(async () => api.git.status(), 'shell.git.status'))
  bind(git, 'diff', (pathHandle) =>
    runAsync(
    async () => api.git.diff(readOptionalStringArg(context, pathHandle)),
    'shell.git.diff',
  ),
  )
  bind(git, 'log', (limitHandle) =>
    runAsync(
    async () => api.git.log(readOptionalNumberArg(context, limitHandle)),
    'shell.git.log',
  ),
  )
  bind(git, 'clone', (optionsHandle) =>
    runAsync(
    async () => api.git.clone(readGitCloneOptions(context, optionsHandle)),
    'shell.git.clone',
  ),
  )
  bind(git, 'commit', (optionsHandle) =>
    runAsync(
    async () => api.git.commit(readGitCommitOptions(context, optionsHandle)),
    'shell.git.commit',
  ),
  )
  bind(git, 'push', () => runAsync(async () => api.git.push(), 'shell.git.push'))
  bind(git, 'pull', () => runAsync(async () => api.git.pull(), 'shell.git.pull'))
  bind(git, 'fetch', () => runAsync(async () => api.git.fetch(), 'shell.git.fetch'))
  bind(git, 'switchBranch', (branchHandle) =>
    runAsync(
      async () => api.git.switchBranch(readStringArg(context, branchHandle, 'branch')),
      'shell.git.switchBranch',
    ),
  )
  bind(git, 'discard', (pathsHandle) =>
    runAsync(
      async () => api.git.discard(readStringArrayArg(context, pathsHandle, 'paths')),
      'shell.git.discard',
    ),
  )
  bind(git, 'undo', () => runAsync(async () => api.git.undo(), 'shell.git.undo'))
  bind(git, 'amend', (messageHandle) =>
    runAsync(
    async () => api.git.amend(readStringArg(context, messageHandle, 'message')),
    'shell.git.amend',
  ),
  )
  bind(git, 'createBranch', (optionsHandle) =>
    runAsync(
      async () => api.git.createBranch(readGitCreateBranchOptions(context, optionsHandle)),
      'shell.git.createBranch',
    ),
  )
  bind(git, 'stashSave', (messageHandle) =>
    runAsync(
    async () => api.git.stashSave(readOptionalStringArg(context, messageHandle)),
    'shell.git.stashSave',
  ),
  )
  bind(git, 'stashPop', () => runAsync(async () => api.git.stashPop(), 'shell.git.stashPop'))
  bind(git, 'stashList', () => runAsync(async () => api.git.stashList(), 'shell.git.stashList'))
  context.setProp(instant, 'git', git)
  git.dispose()

  context.setProp(context.global, 'instant', instant)
  instant.dispose()
}
