import {
  shouldInterruptAfterDeadline,
  type QuickJSAsyncContext,
  type QuickJSAsyncRuntime,
  type QuickJSHandle,
} from 'quickjs-emscripten'
import { getResolvedSystemEnv } from '../os/system-env-settings-storage.ts'
import { appendSystemDebugLog, shortenDebugPath } from '../os/system-debug-log.ts'
import { FILES_VFS_READ_ROOT } from '../apps/files/files-path.ts'
import {
  ensureTmpSessionDir,
  resolveSessionTmpDir,
  workspaceTmpRoot,
} from '../apps/files/files-tmp.ts'
import { normalizeTerminalAbsolutePath } from '../terminal/terminal-path.ts'
import type { TerminalChangeSet } from '../terminal/terminal-changeset.ts'
import {
  createTerminalFsJournal,
  revertTerminalChangeSet,
  type TerminalFsJournal,
} from '../terminal/terminal-changeset-journal.ts'
import type { TerminalFsMode } from '../terminal/terminal-fs-mode.ts'
import { createQuickJsAsyncContext } from './quickjs-runtime.ts'
import type {
  QuickJsConsoleLevel,
  QuickJsConsoleLine,
  QuickJsEvalFailure,
  QuickJsEvalOptions,
  QuickJsEvalResult,
  QuickJsHostConfig,
  QuickJsHostPermissions,
  QuickJsHostQuotas,
  QuickJsInstance,
  QuickJsInstanceListener,
  QuickJsInstanceOptions,
  QuickJsInstanceSnapshot,
} from './quickjs-instance-types.ts'
import { injectInstantShell } from '../terminal/instant-shell/inject-instant-shell.ts'
import { injectWebView } from '../apps/webview/inject-webview.ts'
import { createQuickJsAsyncBridge } from './quickjs-async-bridge.ts'
import { resolveEvalModuleFilename } from './quickjs-module-loader.ts'
import { injectNodeBuiltins } from './quickjs-node-builtins.ts'
import { injectFetch } from './quickjs-fetch.ts'
import { injectTextEncoding } from './quickjs-text-encoding.ts'
import {
  createProcessState,
  injectProcess,
  syncExitCodeFromGuest,
} from './quickjs-process.ts'
import { formatFatalErrorMessage, isQuickJsWasmBoundaryFatalError } from './quickjs-runtime-fatal.ts'
import {
  QUICKJS_DEFAULT_MAX_FILE_BYTES,
  QUICKJS_DEFAULT_MEMORY_LIMIT_BYTES,
} from './quickjs-quotas.ts'

/** 默认无超时；传入有限正数毫秒可限制单次 eval。 */
const DEFAULT_TIMEOUT_MS = Number.POSITIVE_INFINITY
const DEFAULT_MAX_STACK_SIZE_BYTES = 512 * 1024
const DEFAULT_ARGV = ['instant-node'] as const

export { QUICKJS_DEFAULT_MAX_FILE_BYTES, QUICKJS_DEFAULT_MEMORY_LIMIT_BYTES }

const CONSOLE_LEVELS: QuickJsConsoleLevel[] = ['log', 'info', 'warn', 'error']

let consoleLineSeq = 0
let instanceSeq = 0

function nextConsoleLineId(): string {
  consoleLineSeq += 1
  return `qjs-console-${consoleLineSeq}`
}

/** 是否启用墙钟时间上限（Infinity / 非正数 = 不限时，仅靠 abort / destroy）。 */
function hasEvalTimeLimit(timeoutMs: number): boolean {
  return Number.isFinite(timeoutMs) && timeoutMs > 0
}

function resolveWorkspaceRoot(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined
  }
  const trimmed = raw.trim()
  if (!trimmed) {
    return undefined
  }
  try {
    return normalizeTerminalAbsolutePath(trimmed)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid QuickJS workspaceRoot: ${message}`)
  }
}

function resolveFsMode(options: QuickJsInstanceOptions): TerminalFsMode {
  if (options.fsMode !== undefined) {
    return options.fsMode
  }
  if (options.readOnly === true) {
    return 'readonly'
  }
  return 'normal'
}

function resolveHostPermissions(
  workspaceRoot: string | undefined,
  permissions: QuickJsInstanceOptions['permissions'],
  fsMode: TerminalFsMode,
  sessionTmpDir: string | undefined,
  terminalSessionId: string | undefined,
): QuickJsHostPermissions {
  const workspaceTmp = workspaceRoot ? workspaceTmpRoot(workspaceRoot) : undefined
  const defaultWriteRoots = [
    ...(workspaceRoot !== undefined ? [workspaceRoot] : []),
    ...(workspaceTmp !== undefined ? [workspaceTmp] : []),
    ...(sessionTmpDir !== undefined ? [sessionTmpDir] : []),
  ]
  const defaultReadRoots =
    workspaceRoot !== undefined || sessionTmpDir !== undefined
      ? [FILES_VFS_READ_ROOT]
      : []
  const readOnly = fsMode === 'readonly'

  let fsWriteRoots: string[]
  if (readOnly) {
    fsWriteRoots = [
      ...(sessionTmpDir !== undefined ? [sessionTmpDir] : []),
      ...(workspaceTmp !== undefined ? [workspaceTmp] : []),
    ]
  } else if (permissions?.fsWriteRoots !== undefined) {
    fsWriteRoots = [...permissions.fsWriteRoots]
    const extras = [workspaceTmp, sessionTmpDir].filter(
      (root): root is string => root !== undefined,
    )
    for (const root of extras) {
      if (!fsWriteRoots.some((item) => item === root)) {
        fsWriteRoots.push(root)
      }
    }
  } else {
    fsWriteRoots = [...defaultWriteRoots]
  }

  return {
    fsReadRoots:
      permissions?.fsReadRoots !== undefined ? [...permissions.fsReadRoots] : [...defaultReadRoots],
    fsWriteRoots,
    fsWriteDenyRoots:
      permissions?.fsWriteDenyRoots !== undefined ? [...permissions.fsWriteDenyRoots] : [],
    network:
      permissions?.network !== undefined
        ? permissions.network
        : Boolean(terminalSessionId?.trim()),
  }
}

function resolveHostQuotas(options: QuickJsInstanceOptions): QuickJsHostQuotas {
  return {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    memoryLimitBytes: options.memoryLimitBytes ?? QUICKJS_DEFAULT_MEMORY_LIMIT_BYTES,
    maxStackSizeBytes: options.maxStackSizeBytes ?? DEFAULT_MAX_STACK_SIZE_BYTES,
    maxFileBytes: options.maxFileBytes ?? QUICKJS_DEFAULT_MAX_FILE_BYTES,
  }
}

function resolveHostConfig(options: QuickJsInstanceOptions): QuickJsHostConfig {
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot)
  const env = options.env !== undefined ? { ...options.env } : getResolvedSystemEnv()
  const argv = options.argv !== undefined ? [...options.argv] : [...DEFAULT_ARGV]
  const fsMode = resolveFsMode(options)
  const hasSessionTmp =
    Boolean(options.terminalSessionId?.trim()) || Boolean(options.npmRunId?.trim())
  const sessionTmpDir = hasSessionTmp
    ? resolveSessionTmpDir({
        terminalSessionId: options.terminalSessionId,
        npmRunId: options.npmRunId,
      })
    : undefined
  if (sessionTmpDir) {
    env.TMPDIR = sessionTmpDir
  }
  return {
    workspaceRoot,
    env,
    argv,
    permissions: resolveHostPermissions(
      workspaceRoot,
      options.permissions,
      fsMode,
      sessionTmpDir,
      options.terminalSessionId,
    ),
    quotas: resolveHostQuotas(options),
  }
}

function freezeHostConfig(config: QuickJsHostConfig): QuickJsHostConfig {
  return {
    workspaceRoot: config.workspaceRoot,
    env: Object.freeze({ ...config.env }),
    argv: Object.freeze([...config.argv]) as string[],
    permissions: Object.freeze({
      fsReadRoots: Object.freeze([...config.permissions.fsReadRoots]) as string[],
      fsWriteRoots: Object.freeze([...config.permissions.fsWriteRoots]) as string[],
      fsWriteDenyRoots: Object.freeze([...config.permissions.fsWriteDenyRoots]) as string[],
      network: config.permissions.network,
    }),
    quotas: Object.freeze({ ...config.quotas }),
  }
}

function formatQuickJsError(context: QuickJSAsyncContext, errorHandle: QuickJSHandle): string {
  try {
    const dumped = context.dump(errorHandle)
    if (typeof dumped === 'string') {
      return dumped
    }

    if (dumped instanceof Error) {
      return dumped.message
    }

    if (dumped && typeof dumped === 'object' && 'message' in dumped) {
      const message = (dumped as { message?: unknown }).message
      if (typeof message === 'string') {
        return message
      }
    }

    return JSON.stringify(dumped)
  } finally {
    errorHandle.dispose()
  }
}

function formatConsoleArg(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (
    value === undefined ||
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

function dumpEvalValue(context: QuickJSAsyncContext, handle: QuickJSHandle): unknown {
  try {
    return context.dump(handle)
  } catch {
    try {
      return context.getString(handle)
    } catch {
      return `[unserializable ${context.typeof(handle)}]`
    }
  }
}

function yieldToHostEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function injectSerializableGlobals(
  context: QuickJSAsyncContext,
  globals: Record<string, unknown>,
): void {
  for (const [name, value] of Object.entries(globals)) {
    const handle = context.unwrapResult(context.evalCode(`(${JSON.stringify(value)})`))
    context.setProp(context.global, name, handle)
    handle.dispose()
  }
}

function injectConsole(
  context: QuickJSAsyncContext,
  onConsole: (level: QuickJsConsoleLevel, text: string) => void,
): void {
  const consoleObject = context.newObject()

  for (const level of CONSOLE_LEVELS) {
    const fn = context.newFunction(level, (...argHandles) => {
      const parts = argHandles.map((handle) => {
        try {
          return formatConsoleArg(context.dump(handle))
        } catch {
          try {
            return context.getString(handle)
          } catch {
            return `[${context.typeof(handle)}]`
          }
        }
      })
      onConsole(level, parts.join(' '))
    })
    context.setProp(consoleObject, level, fn)
    fn.dispose()
  }

  context.setProp(context.global, 'console', consoleObject)
  consoleObject.dispose()
}

type InstanceState = {
  destroyed: boolean
  busy: boolean
  consoleLines: QuickJsConsoleLine[]
}

/**
 * 创建与宿主会话同寿的 QuickJS 实例（常驻到 destroy）。
 * 同一实例内多次 eval 共享上下文；busy 仅表示此刻正在跑一段同步 JS 切片。
 * 挂起的定时器不阻止再次 eval；退出码只认 process.exit / exitCode。
 *
 * Asyncify 策略（L1.7）：长驻实例统一 Asyncify（不做 sync/Asyncify 通用双轨）；
 * 每实例独立 WASM；同栈禁止嵌套挂起；destroy 只 dispose context。
 * `*Sync` fs 经 Asyncify 挂起打 VFS；新代码优先 `fs.promises`。预加载/内存盘不归本层。
 */
export async function createQuickJsInstance(
  options: QuickJsInstanceOptions = {},
): Promise<QuickJsInstance> {
  const fsMode = resolveFsMode(options)
  const hostConfig = freezeHostConfig(resolveHostConfig(options))
  const sessionTmpDir = hostConfig.env.TMPDIR
  if (sessionTmpDir && sessionTmpDir.startsWith('/tmp/')) {
    await ensureTmpSessionDir(sessionTmpDir)
  }
  const defaultTimeoutMs = hostConfig.quotas.timeoutMs
  instanceSeq += 1
  const instanceId = `qjs-instance-${instanceSeq}`

  let evalDeadline = Date.now() + defaultTimeoutMs
  let abortRequested = false
  let evalSeq = 0
  let activeSliceTimeoutMs = defaultTimeoutMs
  let activeJournal: TerminalFsJournal | undefined
  let lastChanges: TerminalChangeSet | undefined
  /** 本轮 eval 期间宿主侧（如 instant.git）产生、待 seal 时合并进 lastChanges 的变更。 */
  let pendingExternalChangeSets: TerminalChangeSet[] | undefined
  const processState = createProcessState(
    hostConfig.workspaceRoot,
    hostConfig.env,
    options.cwd,
  )

  // 每实例独立 Asyncify WASM：*Sync 可挂起；多实例互不抢槽；勿嵌套挂起
  const context: QuickJSAsyncContext = await createQuickJsAsyncContext()
  const runtime: QuickJSAsyncRuntime = context.runtime
  runtime.setMemoryLimit(hostConfig.quotas.memoryLimitBytes)
  runtime.setMaxStackSize(hostConfig.quotas.maxStackSizeBytes)
  runtime.setInterruptHandler((rt) => {
    if (abortRequested || processState.exitRequested) {
      return true
    }
    if (!hasEvalTimeLimit(activeSliceTimeoutMs ?? defaultTimeoutMs)) {
      return false
    }
    return shouldInterruptAfterDeadline(evalDeadline)(rt)
  })

  const listeners = new Set<QuickJsInstanceListener>()
  const state: InstanceState = {
    destroyed: false,
    busy: false,
    consoleLines: [],
  }

  const notify = () => {
    for (const listener of listeners) {
      listener()
    }
  }

  const pushConsole = (level: QuickJsConsoleLevel, text: string): QuickJsConsoleLine => {
    const line: QuickJsConsoleLine = {
      id: nextConsoleLineId(),
      level,
      text,
      at: Date.now(),
    }
    state.consoleLines = [...state.consoleLines, line]
    notify()
    return line
  }

  const tryBeginSlice = (timeoutMs: number): boolean => {
    if (state.destroyed || state.busy) {
      return false
    }
    abortRequested = false
    processState.exitRequested = false
    activeSliceTimeoutMs = timeoutMs
    evalDeadline = Date.now() + timeoutMs
    state.busy = true
    notify()
    return true
  }

  const endSlice = () => {
    if (state.destroyed) {
      return
    }
    abortRequested = false
    processState.exitRequested = false
    state.busy = false
    notify()
  }

  const asyncBridge = createQuickJsAsyncBridge({
    runtime,
    context,
    isDestroyed: () => state.destroyed,
    isBusy: () => state.busy,
    tryBeginSlice,
    endSlice,
    getSliceTimeoutMs: () => activeSliceTimeoutMs ?? defaultTimeoutMs,
    reportError: (message) => {
      pushConsole('error', message)
    },
  })

  injectConsole(context, (level, text) => {
    pushConsole(level, text)
  })

  injectProcess(
    context,
    processState,
    { env: { ...hostConfig.env }, argv: [...hostConfig.argv] },
    {
      requestExit: () => {
        processState.exitRequested = true
      },
      writeStdout: (text) => {
        pushConsole('log', text)
      },
      writeStderr: (text) => {
        pushConsole('error', text)
      },
    },
  )

  injectTextEncoding(context)

  /** 当前 eval 切片的入口路径（`eval({ filename })`）；供顶层 CJS require 相对解析。 */
  let activeEvalFilename: string | undefined

  const nodeBuiltins = injectNodeBuiltins(runtime, context, {
    getCwd: () => processState.cwd,
    asyncBridge,
    fsOps: {
      getCwd: () => processState.cwd,
      permissions: hostConfig.permissions,
      maxFileBytes: hostConfig.quotas.maxFileBytes,
      isDestroyed: () => state.destroyed,
      getJournal: () => activeJournal,
    },
    getEvalParentFilename: () => activeEvalFilename,
    tmpDir: sessionTmpDir,
  })

  asyncBridge.injectGlobals()

  let disposeFetch: (() => void) | undefined
  if (hostConfig.permissions.network) {
    disposeFetch = injectFetch({
      context,
      asyncBridge,
      maxResponseBytes: hostConfig.quotas.maxFileBytes,
      isDestroyed: () => state.destroyed,
    })
  }

  if (options.instantShellHost !== undefined) {
    injectInstantShell({
      context,
      asyncBridge,
      host: options.instantShellHost,
      isDestroyed: () => state.destroyed,
    })
  }

  let disposeWebView: (() => void) | undefined
  if (options.webviewHost !== undefined) {
    disposeWebView = injectWebView({
      context,
      asyncBridge,
      host: options.webviewHost,
      isDestroyed: () => state.destroyed,
    })
  }

  if (options.globals !== undefined) {
    injectSerializableGlobals(context, options.globals)
  }

  const assertAlive = () => {
    if (state.destroyed) {
      throw new Error(`QuickJS instance ${instanceId} has been destroyed`)
    }
  }

  const getSnapshot = (): QuickJsInstanceSnapshot => {
    if (!state.destroyed && !state.busy) {
      syncExitCodeFromGuest(context, processState)
    }
    return {
      destroyed: state.destroyed,
      busy: state.busy,
      cwd: processState.cwd,
      exitCode: processState.exitCode,
      consoleLines: state.consoleLines,
    }
  }

  const getHostConfig = (): QuickJsHostConfig => ({
    workspaceRoot: hostConfig.workspaceRoot,
    env: { ...hostConfig.env },
    argv: [...hostConfig.argv],
    permissions: {
      fsReadRoots: [...hostConfig.permissions.fsReadRoots],
      fsWriteRoots: [...hostConfig.permissions.fsWriteRoots],
      fsWriteDenyRoots: [...hostConfig.permissions.fsWriteDenyRoots],
      network: hostConfig.permissions.network,
    },
    quotas: { ...hostConfig.quotas },
  })

  const subscribe = (listener: QuickJsInstanceListener): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const clearConsole = () => {
    assertAlive()
    state.consoleLines = []
    notify()
  }

  const abort = () => {
    if (state.destroyed) return
    abortRequested = true
    asyncBridge.clearAll()
  }

  const destroy = () => {
    if (state.destroyed) return
    appendSystemDebugLog({
      layer: 'qjs',
      op: 'destroy',
      detail: instanceId,
      force: true,
    })
    abortRequested = true
    // 先标记销毁，让 in-flight async 走 abandon 路径且不再碰 guest handle
    state.destroyed = true
    state.busy = false
    asyncBridge.clearAll()
    disposeWebView?.()
    disposeWebView = undefined
    disposeFetch?.()
    disposeFetch = undefined
    nodeBuiltins.dispose?.()
    listeners.clear()
    // Asyncify：只 dispose context（runtime 随 context 释放；再 dispose runtime 会踩 HostRef）
    context.dispose()
  }

  const sealActiveJournal = async (): Promise<TerminalChangeSet | undefined> => {
    const journal = activeJournal
    activeJournal = undefined
    if (!journal) return undefined
    try {
      const changeSet = await journal.seal()
      if (changeSet.changes.length === 0) return undefined
      lastChanges = changeSet
      return changeSet
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushConsole('warn', `changeset seal failed: ${message}`)
      return undefined
    }
  }

  const evalCode = async (
    code: string,
    evalOptions: QuickJsEvalOptions = {},
  ): Promise<QuickJsEvalResult> => {
    assertAlive()
    const timeoutMs = evalOptions.timeoutMs ?? defaultTimeoutMs
    const waitUntilIdle = evalOptions.waitUntilIdle === true
    if (!tryBeginSlice(timeoutMs)) {
      throw new Error(`QuickJS instance ${instanceId} is already evaluating`)
    }

    const consoleStartIndex = state.consoleLines.length
    const consoleSlice = () => state.consoleLines.slice(consoleStartIndex)
    const silent = evalOptions.silent === true
    if (fsMode === 'controlled' && !silent) {
      activeJournal = createTerminalFsJournal()
    }

    /** guest / timeout / bridge reject：普通 failure，不因错误串误标 fatal。 */
    const makeFailure = (error: string): QuickJsEvalFailure => ({
      ok: false,
      error,
      exited: false,
      exitCode: processState.exitCode,
      consoleLines: consoleSlice(),
    })

    let result: QuickJsEvalResult | undefined
    let sliceOpen = true
    const evalDeadlineMs = Date.now() + timeoutMs

    const releaseSlice = () => {
      if (!sliceOpen) return
      sliceOpen = false
      endSlice()
    }

    /** busy 切片内：排空微任务并等到 Promise settle（host deferred 靠 yield + drain）。 */
    const awaitGuestPromiseValue = async (
      valueHandle: QuickJSHandle,
    ): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> => {
      await asyncBridge.drainAfterSync()
      let promiseState = context.getPromiseState(valueHandle)
      if (promiseState.type === 'fulfilled' && promiseState.notAPromise) {
        return { ok: true, value: dumpEvalValue(context, valueHandle) }
      }

while (promiseState.type === 'pending') {
	        if (state.destroyed) {
	          return { ok: false, error: 'QuickJS instance destroyed during evaluation' }
	        }
	        if (abortRequested) {
	          return { ok: false, error: 'interrupted: aborted while waiting for Promise' }
	        }
	        if (hasEvalTimeLimit(timeoutMs) && Date.now() > evalDeadlineMs) {
	          return { ok: false, error: `timeout after ${timeoutMs}ms waiting for Promise` }
	        }
	        // 释放 busy 让定时器回调能通过 tryBeginSlice 执行（否则 Promise 永不 settle）
	        const savedAbort = abortRequested
	        const savedExit = processState.exitRequested
	        state.busy = false
	        notify()
        try {
          await asyncBridge.flushHostTasks()
          await asyncBridge.drainAfterSync()
          await yieldToHostEventLoop()
        } finally {
	          state.busy = true
	          if (savedAbort) abortRequested = true
	          if (savedExit) processState.exitRequested = true
	          notify()
	        }
	        promiseState = context.getPromiseState(valueHandle)
	      }

      if (promiseState.type === 'rejected') {
        const error = formatQuickJsError(context, promiseState.error)
        return {
          ok: false,
          error: abortRequested ? `interrupted: ${error}` : error,
        }
      }

      // fulfilled
      const resolvedHandle = promiseState.value
      const notAPromise = promiseState.notAPromise === true
      try {
        return { ok: true, value: dumpEvalValue(context, resolvedHandle) }
      } finally {
        if (resolvedHandle.alive && resolvedHandle !== valueHandle && !notAPromise) {
          resolvedHandle.dispose()
        }
      }
    }

    /** 释放 busy 后等到定时器 / deferred / jobs 排空（受 deadline 约束）。 */
    const waitForIdle = async (): Promise<string | undefined> => {
      while (asyncBridge.hasPendingAsyncWork()) {
        if (state.destroyed) {
          return 'QuickJS instance destroyed during evaluation'
        }
        if (abortRequested) {
          return 'interrupted: aborted while waiting for async work'
        }
        if (hasEvalTimeLimit(timeoutMs) && Date.now() > evalDeadlineMs) {
          const timers = asyncBridge.getPendingTimerCount()
          return `timeout after ${timeoutMs}ms with pending async work (timers=${timers})`
        }
        await asyncBridge.flushHostTasks()
        await asyncBridge.drainAfterSync()
        await yieldToHostEventLoop()
      }
      return undefined
    }

    try {
      evalSeq += 1
      // 默认 `{cwd}/[eval-n].js`：相对 import 相对 cwd；传入 filename 可作「跑文件」入口
      // Asyncify：切片内可能 *Sync / 可挂起 import，须用 evalCodeAsync（勿在 Sync 路径再嵌套挂起）
      const evalFilename = resolveEvalModuleFilename(
        evalOptions.filename,
        processState.cwd,
        evalSeq,
      )
      activeEvalFilename = evalFilename
      appendSystemDebugLog({
        layer: 'qjs',
        op: 'eval-start',
        detail: `${instanceId} ${shortenDebugPath(evalFilename)}`,
        force: true,
      })
      const evalStartedAt = performance.now()
      const evalResult = await context.evalCodeAsync(code, evalFilename)

      if (state.destroyed) {
        result = makeFailure('QuickJS instance destroyed during evaluation')
      } else if (evalResult.error) {
        const error = formatQuickJsError(context, evalResult.error)
        appendSystemDebugLog({
          layer: 'qjs',
          op: 'eval-error',
          detail: `${instanceId} ${error.slice(0, 200)}`,
          durationMs: Math.round(performance.now() - evalStartedAt),
          force: true,
        })
        if (processState.exitRequested) {
          syncExitCodeFromGuest(context, processState)
          result = {
            ok: true,
            value: undefined,
            exited: true,
            exitCode: processState.exitCode,
            consoleLines: consoleSlice(),
          }
        } else {
          syncExitCodeFromGuest(context, processState)
          result = makeFailure(abortRequested ? `interrupted: ${error}` : error)
        }
      } else {
        try {
          await asyncBridge.drainAfterSync()
          syncExitCodeFromGuest(context, processState)
          if (processState.exitRequested) {
            appendSystemDebugLog({
              layer: 'qjs',
              op: 'eval-exit',
              detail: instanceId,
              durationMs: Math.round(performance.now() - evalStartedAt),
              force: true,
            })
            result = {
              ok: true,
              value: undefined,
              exited: true,
              exitCode: processState.exitCode,
              consoleLines: consoleSlice(),
            }
          } else {
            const settled = await awaitGuestPromiseValue(evalResult.value)
            syncExitCodeFromGuest(context, processState)
            if (processState.exitRequested) {
              result = {
                ok: true,
                value: undefined,
                exited: true,
                exitCode: processState.exitCode,
                consoleLines: consoleSlice(),
              }
            } else if (!settled.ok) {
              result = makeFailure(settled.error)
            } else {
              // 先释放 busy，定时器回调才能 tryBeginSlice
              releaseSlice()
              let idleError: string | undefined
              if (waitUntilIdle && !state.destroyed && !abortRequested) {
                idleError = await waitForIdle()
              }
              syncExitCodeFromGuest(context, processState)
              if (processState.exitRequested) {
                result = {
                  ok: true,
                  value: undefined,
                  exited: true,
                  exitCode: processState.exitCode,
                  consoleLines: consoleSlice(),
                }
              } else if (idleError) {
                // 已有 console/返回值时仍带回；超时记为失败以便 Agent 感知
                result = makeFailure(idleError)
              } else {
                appendSystemDebugLog({
                  layer: 'qjs',
                  op: 'eval-done',
                  detail: instanceId,
                  durationMs: Math.round(performance.now() - evalStartedAt),
                  force: true,
                })
                result = {
                  ok: true,
                  value: settled.value,
                  exited: false,
                  exitCode: processState.exitCode,
                  consoleLines: consoleSlice(),
                }
              }
            }
          }
        } finally {
          if (!state.destroyed && evalResult.value.alive) {
            evalResult.value.dispose()
          }
        }
      }

    } catch (error) {
      if (state.destroyed) {
        result = makeFailure('QuickJS instance destroyed during evaluation')
      } else if (isQuickJsWasmBoundaryFatalError(error)) {
        destroy()
        result = {
          ok: false,
          error: formatFatalErrorMessage(error),
          fatal: true,
          exited: false,
          exitCode: processState.exitCode,
          consoleLines: consoleSlice(),
        }
      } else {
        throw error
      }
    } finally {
      activeEvalFilename = undefined
      releaseSlice()
      const changes = await sealActiveJournal()
      if (result && changes) {
        result = { ...result, changes }
      }
      mergePendingExternalChangeSets()
      if (!state.destroyed) {
        await asyncBridge.flushHostTasks()
      }
    }

    return result!
  }

  const getLastChanges = (): TerminalChangeSet | undefined => lastChanges

  /**
   * 记录本轮 eval 期间宿主侧（如 instant.git）产生的工作树变更；
   * 在 seal 时与 FS journal 合并进 lastChanges。
   */
  const noteExternalChangeSet = (changeSet: TerminalChangeSet): void => {
    if (changeSet.changes.length === 0) return
    pendingExternalChangeSets ??= []
    pendingExternalChangeSets.push(changeSet)
  }

  /** seal 后把宿主侧外部变更并入 lastChanges（无 journal 时以外部变更兜底成集）。 */
  const mergePendingExternalChangeSets = (): void => {
    if (!pendingExternalChangeSets || pendingExternalChangeSets.length === 0) return
    const pending = pendingExternalChangeSets
    pendingExternalChangeSets = undefined
    const externalChanges = pending.flatMap((changeSet) => changeSet.changes)
    if (externalChanges.length === 0) return
    const first = pending[0]
    lastChanges = lastChanges
      ? { ...lastChanges, changes: [...lastChanges.changes, ...externalChanges] }
      : {
          sessionId: first.sessionId,
          createdAt: first.createdAt,
          changes: externalChanges,
        }
  }

  const clearLastChanges = (): void => {
    lastChanges = undefined
  }

  const revertLastChanges = async (): Promise<void> => {
    assertAlive()
    const changeSet = lastChanges
    if (!changeSet) return
    await revertTerminalChangeSet(changeSet)
    lastChanges = undefined
  }

  return {
    subscribe,
    getSnapshot,
    getHostConfig,
    eval: evalCode,
    getLastChanges,
    noteExternalChangeSet,
    clearLastChanges,
    revertLastChanges,
    abort,
    destroy,
    clearConsole,
  }
}
