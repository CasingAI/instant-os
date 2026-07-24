import {
  shouldInterruptAfterDeadline,
  type QuickJSAsyncContext,
  type QuickJSAsyncRuntime,
  type QuickJSHandle,
} from 'quickjs-emscripten'
import { getResolvedSystemEnv } from '../os/system-env-settings-storage.ts'
import { appendSystemDebugLog, shortenDebugPath } from '../os/system-debug-log.ts'
import { normalizeTerminalAbsolutePath } from '../terminal/terminal-path.ts'
import { createQuickJsAsyncContext } from './quickjs-runtime.ts'
import type {
  QuickJsConsoleLevel,
  QuickJsConsoleLine,
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
import { createQuickJsAsyncBridge } from './quickjs-async-bridge.ts'
import { resolveEvalModuleFilename } from './quickjs-module-loader.ts'
import { injectNodeBuiltins } from './quickjs-node-builtins.ts'
import { injectTextEncoding } from './quickjs-text-encoding.ts'
import {
  createProcessState,
  injectProcess,
  syncExitCodeFromGuest,
} from './quickjs-process.ts'

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_MEMORY_LIMIT_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_STACK_SIZE_BYTES = 512 * 1024
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024
const DEFAULT_ARGV = ['instant-node'] as const

const CONSOLE_LEVELS: QuickJsConsoleLevel[] = ['log', 'info', 'warn', 'error']

let consoleLineSeq = 0
let instanceSeq = 0

function nextConsoleLineId(): string {
  consoleLineSeq += 1
  return `qjs-console-${consoleLineSeq}`
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

function resolveHostPermissions(
  workspaceRoot: string | undefined,
  permissions: QuickJsInstanceOptions['permissions'],
  readOnly: boolean,
): QuickJsHostPermissions {
  const defaultRoots = workspaceRoot !== undefined ? [workspaceRoot] : []
  return {
    fsReadRoots: permissions?.fsReadRoots !== undefined ? [...permissions.fsReadRoots] : [...defaultRoots],
    // readOnly 强制清空写根，忽略外部传入的 fsWriteRoots
    fsWriteRoots: readOnly
      ? []
      : permissions?.fsWriteRoots !== undefined
        ? [...permissions.fsWriteRoots]
        : [...defaultRoots],
    fsWriteDenyRoots:
      permissions?.fsWriteDenyRoots !== undefined ? [...permissions.fsWriteDenyRoots] : [],
    network: false,
  }
}

function resolveHostQuotas(options: QuickJsInstanceOptions): QuickJsHostQuotas {
  return {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    memoryLimitBytes: options.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT_BYTES,
    maxStackSizeBytes: options.maxStackSizeBytes ?? DEFAULT_MAX_STACK_SIZE_BYTES,
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
  }
}

function resolveHostConfig(options: QuickJsInstanceOptions): QuickJsHostConfig {
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot)
  const env = options.env !== undefined ? { ...options.env } : getResolvedSystemEnv()
  const argv = options.argv !== undefined ? [...options.argv] : [...DEFAULT_ARGV]
  return {
    workspaceRoot,
    env,
    argv,
    permissions: resolveHostPermissions(workspaceRoot, options.permissions, options.readOnly === true),
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
      network: false as const,
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
  const hostConfig = freezeHostConfig(resolveHostConfig(options))
  const defaultTimeoutMs = hostConfig.quotas.timeoutMs
  instanceSeq += 1
  const instanceId = `qjs-instance-${instanceSeq}`

  let evalDeadline = Date.now() + defaultTimeoutMs
  let abortRequested = false
  let evalSeq = 0
  let activeSliceTimeoutMs = defaultTimeoutMs
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
    },
    getEvalParentFilename: () => activeEvalFilename,
  })

  asyncBridge.injectGlobals()

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
      network: false,
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
    asyncBridge.clearAll()
    nodeBuiltins.dispose?.()
    state.destroyed = true
    state.busy = false
    listeners.clear()
    // Asyncify：只 dispose context（runtime 随 context 释放；再 dispose runtime 会踩 HostRef）
    context.dispose()
  }

  const evalCode = async (
    code: string,
    evalOptions: QuickJsEvalOptions = {},
  ): Promise<QuickJsEvalResult> => {
    assertAlive()
    const timeoutMs = evalOptions.timeoutMs ?? defaultTimeoutMs
    if (!tryBeginSlice(timeoutMs)) {
      throw new Error(`QuickJS instance ${instanceId} is already evaluating`)
    }

    const consoleStartIndex = state.consoleLines.length
    const consoleSlice = () => state.consoleLines.slice(consoleStartIndex)

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
        return {
          ok: false,
          error: 'QuickJS instance destroyed during evaluation',
          exited: false,
          exitCode: processState.exitCode,
          consoleLines: consoleSlice(),
        }
      }

      if (evalResult.error) {
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
          return {
            ok: true,
            value: undefined,
            exited: true,
            exitCode: processState.exitCode,
            consoleLines: consoleSlice(),
          }
        }
        syncExitCodeFromGuest(context, processState)
        return {
          ok: false,
          error: abortRequested ? `interrupted: ${error}` : error,
          exited: false,
          exitCode: processState.exitCode,
          consoleLines: consoleSlice(),
        }
      }

      try {
        // 同步结束后排空微任务 / nextTick / Promise jobs；不等待未到期定时器
        asyncBridge.drainAfterSync()
        syncExitCodeFromGuest(context, processState)
        if (processState.exitRequested) {
          appendSystemDebugLog({
            layer: 'qjs',
            op: 'eval-exit',
            detail: instanceId,
            durationMs: Math.round(performance.now() - evalStartedAt),
            force: true,
          })
          return {
            ok: true,
            value: undefined,
            exited: true,
            exitCode: processState.exitCode,
            consoleLines: consoleSlice(),
          }
        }
        appendSystemDebugLog({
          layer: 'qjs',
          op: 'eval-done',
          detail: instanceId,
          durationMs: Math.round(performance.now() - evalStartedAt),
          force: true,
        })
        return {
          ok: true,
          value: dumpEvalValue(context, evalResult.value),
          exited: false,
          exitCode: processState.exitCode,
          consoleLines: consoleSlice(),
        }
      } finally {
        if (evalResult.value.alive) {
          evalResult.value.dispose()
        }
      }
    } catch (error) {
      if (state.destroyed) {
        return {
          ok: false,
          error: 'QuickJS instance destroyed during evaluation',
          exited: false,
          exitCode: processState.exitCode,
          consoleLines: consoleSlice(),
        }
      }
      throw error
    } finally {
      activeEvalFilename = undefined
      endSlice()
      if (!state.destroyed) {
        asyncBridge.flushHostTasks()
      }
    }
  }

  return {
    subscribe,
    getSnapshot,
    getHostConfig,
    eval: evalCode,
    abort,
    destroy,
    clearConsole,
  }
}
