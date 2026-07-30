/**
 * QuickJS / Emscripten WASM 致命错误识别。
 * 命中后实例不可再 eval，宿主应 destroy 并重建。
 */

const FATAL_PATTERNS: readonly RegExp[] = [
  /memory access out of bounds/i,
  /Aborted\s*\(/i,
  /Assertion failed/i,
  /out of memory/i,
  /\bOOM\b/,
  /RuntimeError/i,
  /table index is out of bounds/i,
  /null function or function signature mismatch/i,
  /unreachable/i,
]

export class QuickJsRuntimeFatalError extends Error {
  override readonly name = 'QuickJsRuntimeFatalError'
  readonly cause: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.cause = cause
  }
}

function errorText(error: unknown): string {
  if (typeof error === 'string') {
    return error
  }
  if (error instanceof Error) {
    const parts = [error.message, error.name]
    if (error.stack) {
      parts.push(error.stack)
    }
    return parts.join('\n')
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') {
      return message
    }
  }
  try {
    return String(error)
  } catch {
    return ''
  }
}

/** 判断是否为 WASM/QuickJS 硬崩类错误（实例此后不可信）。 */
export function isQuickJsRuntimeFatalError(error: unknown): boolean {
  if (error instanceof QuickJsRuntimeFatalError) {
    return true
  }
  const text = errorText(error)
  if (!text) {
    return false
  }
  return FATAL_PATTERNS.some((pattern) => pattern.test(text))
}
