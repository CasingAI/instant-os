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

/**
 * 致命错误模式 → 用户可读消息映射。
 * 注意：这些是现象描述，**不归因具体原因**——WASM 越界 / C 层断言并不等于内存耗尽
 * （实测可能是宿主句柄双重释放、asyncify 挂起态操作等引擎内部 bug；见
 * docs/quickjs-stream-double-free-bug.md）。归因内存会误导用户去清空间。
 */
const FATAL_PATTERN_MESSAGES: readonly [RegExp, string][] = [
  [/memory access out of bounds/i, 'QuickJS 引擎内部崩溃（WASM 内存访问越界）'],
  [/Aborted\s*\(/i, 'QuickJS 引擎内部断言失败'],
  [/vendor\/quickjs\/quickjs\.c/i, 'QuickJS 引擎 C 层内部错误'],
  [/table index is out of bounds/i, 'QuickJS WASM 表索引越界'],
  [/null function or function signature mismatch/i, 'QuickJS WASM 函数签名不匹配'],
]

/**
 * 将 WASM/QuickJS 底层致命错误映射为用户可读的中文消息。
 * 未命中已知模式时返回原始错误文本。
 */
export function formatFatalErrorMessage(error: unknown): string {
  const text = errorText(error)
  if (!text) return '未知 QuickJS 致命错误'
  for (const [pattern, message] of FATAL_PATTERN_MESSAGES) {
    if (pattern.test(text)) return message
  }
  return `QuickJS 致命错误: ${text}`
}
