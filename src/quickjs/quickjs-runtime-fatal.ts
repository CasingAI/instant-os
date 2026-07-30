/**
 * QuickJS / Emscripten WASM 边界致命错误识别。
 * 仅用于 eval 外层 catch 的原始异常；guest JS 错误串勿走此判定。
 * 命中后实例不可再 eval，宿主应 destroy 并重建。
 */

/** 极窄：仅 WASM trap / Emscripten abort / QuickJS C 层断言特征。 */
const WASM_BOUNDARY_FATAL_PATTERNS: readonly RegExp[] = [
  /memory access out of bounds/i,
  /Aborted\s*\(/i,
  /vendor\/quickjs\/quickjs\.c/i,
  /table index is out of bounds/i,
  /null function or function signature mismatch/i,
]

export class QuickJsRuntimeFatalError extends Error {
  override readonly name = 'QuickJsRuntimeFatalError'
  override readonly cause: unknown

  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined)
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

/**
 * 判断是否为 WASM/QuickJS 宿主边界硬崩（实例此后不可信）。
 * 仅应对外层 catch 的原始异常调用，勿对 guest 错误字符串调用。
 */
export function isQuickJsWasmBoundaryFatalError(error: unknown): boolean {
  if (error instanceof QuickJsRuntimeFatalError) {
    return true
  }
  if (typeof WebAssembly !== 'undefined' && error instanceof WebAssembly.RuntimeError) {
    return true
  }
  const text = errorText(error)
  if (!text) {
    return false
  }
  return WASM_BOUNDARY_FATAL_PATTERNS.some((pattern) => pattern.test(text))
}

/** @deprecated 请用 isQuickJsWasmBoundaryFatalError；保留为薄别名以免调用方漂移。 */
export function isQuickJsRuntimeFatalError(error: unknown): boolean {
  return isQuickJsWasmBoundaryFatalError(error)
}
