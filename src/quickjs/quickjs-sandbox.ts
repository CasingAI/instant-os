import {
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
} from 'quickjs-emscripten'
import { loadQuickJsRuntime } from './quickjs-runtime.ts'
import type { QuickJsSandboxRunOptions, QuickJsSandboxRunResult } from './quickjs-sandbox-types.ts'

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_MEMORY_LIMIT_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_STACK_SIZE_BYTES = 512 * 1024

function formatQuickJsError(context: QuickJSContext, errorHandle: QuickJSHandle): string {
  try {
    const dumped = context.dump(errorHandle)
    if (typeof dumped === 'string') {
      return dumped
    }

    if (dumped instanceof Error) {
      return dumped.message
    }

    return JSON.stringify(dumped)
  } finally {
    errorHandle.dispose()
  }
}

function injectGlobals(context: QuickJSContext, globals: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(globals)) {
    const handle = context.unwrapResult(context.evalCode(`(${JSON.stringify(value)})`))
    context.setProp(context.global, name, handle)
    handle.dispose()
  }
}

function runInContext(
  context: QuickJSContext,
  code: string,
): QuickJsSandboxRunResult {
  const evalResult = context.evalCode(code, 'sandbox.js')

  if (evalResult.error) {
    return {
      ok: false,
      error: formatQuickJsError(context, evalResult.error),
    }
  }

  try {
    return {
      ok: true,
      value: context.dump(evalResult.value),
    }
  } finally {
    evalResult.value.dispose()
  }
}

/**
 * 在独立 QuickJS 上下文中执行一段 JS，与宿主 JS 堆完全隔离。
 * 每次调用使用新的 runtime + context，执行结束后立即释放。
 */
export async function runQuickJsSandbox(
  code: string,
  options: QuickJsSandboxRunOptions = {},
): Promise<QuickJsSandboxRunResult> {
  const module = await loadQuickJsRuntime()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs

  const runtime: QuickJSRuntime = module.newRuntime({
    memoryLimitBytes: options.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT_BYTES,
    maxStackSizeBytes: options.maxStackSizeBytes ?? DEFAULT_MAX_STACK_SIZE_BYTES,
    interruptHandler: shouldInterruptAfterDeadline(deadline),
  })
  const context = runtime.newContext()

  try {
    if (options.globals !== undefined) {
      injectGlobals(context, options.globals)
    }

    return runInContext(context, code)
  } finally {
    context.dispose()
    runtime.dispose()
  }
}
