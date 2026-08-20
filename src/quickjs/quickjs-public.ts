/**
 * QuickJS 系统服务对外门面。
 * 宿主会话（终端会话 / Virtual JS 窗口）应 create 一个实例，关闭时 destroy。
 */
export { createQuickJsInstance } from './quickjs-instance.ts'
export {
  QUICKJS_DEFAULT_MAX_FILE_BYTES,
  QUICKJS_DEFAULT_MEMORY_LIMIT_BYTES,
  QUICKJS_MAX_CONSOLE_LINE_CHARS,
  QUICKJS_MAX_CONSOLE_LINES,
} from './quickjs-quotas.ts'
export {
  formatFatalErrorMessage,
  isQuickJsRuntimeFatalError,
  isQuickJsWasmBoundaryFatalError,
  QuickJsRuntimeFatalError,
} from './quickjs-runtime-fatal.ts'
export type {
  QuickJsConsoleLevel,
  QuickJsConsoleLine,
  QuickJsEvalFailure,
  QuickJsEvalOptions,
  QuickJsEvalResult,
  QuickJsEvalSuccess,
  QuickJsHostConfig,
  QuickJsHostPermissions,
  QuickJsHostQuotas,
  QuickJsInstance,
  QuickJsInstanceListener,
  QuickJsInstanceOptions,
  QuickJsInstanceSnapshot,
} from './quickjs-instance-types.ts'
export type { TerminalChangeSet, TerminalChangeEntry, TerminalChangeKind } from '../terminal/terminal-changeset.ts'
export type { TerminalFsMode } from '../terminal/terminal-fs-mode.ts'

export { runQuickJsSandbox } from './quickjs-sandbox.ts'
export type {
  QuickJsSandboxRunFailure,
  QuickJsSandboxRunOptions,
  QuickJsSandboxRunResult,
  QuickJsSandboxRunSuccess,
} from './quickjs-sandbox-types.ts'
