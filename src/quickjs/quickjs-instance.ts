import {
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
} from 'quickjs-emscripten'
import { loadQuickJsRuntime } from './quickjs-runtime.ts'
import type {
  QuickJsConsoleLevel,
  QuickJsConsoleLine,
  QuickJsEvalOptions,
  QuickJsEvalResult,
  QuickJsInstance,
  QuickJsInstanceListener,
  QuickJsInstanceOptions,
  QuickJsInstanceSnapshot,
} from './quickjs-instance-types.ts'

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_MEMORY_LIMIT_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_STACK_SIZE_BYTES = 512 * 1024

const CONSOLE_LEVELS: QuickJsConsoleLevel[] = ['log', 'info', 'warn', 'error']

let consoleLineSeq = 0
let instanceSeq = 0

function nextConsoleLineId(): string {
  consoleLineSeq += 1
  return `qjs-console-${consoleLineSeq}`
}

function formatQuickJsError(context: QuickJSContext, errorHandle: QuickJSHandle): string {
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

function dumpEvalValue(context: QuickJSContext, handle: QuickJSHandle): unknown {
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
  context: QuickJSContext,
  globals: Record<string, unknown>,
): void {
  for (const [name, value] of Object.entries(globals)) {
    const handle = context.unwrapResult(context.evalCode(`(${JSON.stringify(value)})`))
    context.setProp(context.global, name, handle)
    handle.dispose()
  }
}

function injectConsole(
  context: QuickJSContext,
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
 * 创建与宿主会话同寿的 QuickJS 实例。
 * 同一实例内多次 eval 共享上下文与全局变量；关闭宿主时应 destroy。
 */
export async function createQuickJsInstance(
  options: QuickJsInstanceOptions = {},
): Promise<QuickJsInstance> {
  const module = await loadQuickJsRuntime()
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  instanceSeq += 1
  const instanceId = `qjs-instance-${instanceSeq}`

  let evalDeadline = Date.now() + defaultTimeoutMs
  let abortRequested = false

  const runtime: QuickJSRuntime = module.newRuntime({
    memoryLimitBytes: options.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT_BYTES,
    maxStackSizeBytes: options.maxStackSizeBytes ?? DEFAULT_MAX_STACK_SIZE_BYTES,
    interruptHandler: (rt) => {
      if (abortRequested) {
        return true
      }
      return shouldInterruptAfterDeadline(evalDeadline)(rt)
    },
  })

  const context = runtime.newContext()
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

  injectConsole(context, (level, text) => {
    pushConsole(level, text)
  })

  if (options.globals !== undefined) {
    injectSerializableGlobals(context, options.globals)
  }

  const assertAlive = () => {
    if (state.destroyed) {
      throw new Error(`QuickJS instance ${instanceId} has been destroyed`)
    }
  }

  const getSnapshot = (): QuickJsInstanceSnapshot => ({
    destroyed: state.destroyed,
    busy: state.busy,
    consoleLines: state.consoleLines,
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
  }

  const destroy = () => {
    if (state.destroyed) return
    abortRequested = true
    state.destroyed = true
    state.busy = false
    listeners.clear()
    context.dispose()
    runtime.dispose()
  }

  const evalCode = async (
    code: string,
    evalOptions: QuickJsEvalOptions = {},
  ): Promise<QuickJsEvalResult> => {
    assertAlive()
    if (state.busy) {
      throw new Error(`QuickJS instance ${instanceId} is already evaluating`)
    }

    const timeoutMs = evalOptions.timeoutMs ?? defaultTimeoutMs
    const consoleStartIndex = state.consoleLines.length
    abortRequested = false
    evalDeadline = Date.now() + timeoutMs
    state.busy = true
    notify()

    try {
      const evalResult = context.evalCode(code, `${instanceId}.js`)

      if (evalResult.error) {
        const error = formatQuickJsError(context, evalResult.error)
        return {
          ok: false,
          error: abortRequested ? `interrupted: ${error}` : error,
          consoleLines: state.consoleLines.slice(consoleStartIndex),
        }
      }

      try {
        return {
          ok: true,
          value: dumpEvalValue(context, evalResult.value),
          consoleLines: state.consoleLines.slice(consoleStartIndex),
        }
      } finally {
        evalResult.value.dispose()
      }
    } finally {
      abortRequested = false
      if (!state.destroyed) {
        state.busy = false
        notify()
      }
    }
  }

  return {
    subscribe,
    getSnapshot,
    eval: evalCode,
    abort,
    destroy,
    clearConsole,
  }
}
