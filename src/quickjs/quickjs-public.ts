/**
 * QuickJS 系统服务对外门面。
 * 宿主会话（终端会话 / Virtual JS 窗口）应 create 一个实例，关闭时 destroy。
 */
export { createQuickJsInstance } from './quickjs-instance.ts'
export type {
  QuickJsConsoleLevel,
  QuickJsConsoleLine,
  QuickJsEvalFailure,
  QuickJsEvalOptions,
  QuickJsEvalResult,
  QuickJsEvalSuccess,
  QuickJsInstance,
  QuickJsInstanceListener,
  QuickJsInstanceOptions,
  QuickJsInstanceSnapshot,
} from './quickjs-instance-types.ts'

export { runQuickJsSandbox } from './quickjs-sandbox.ts'
export type {
  QuickJsSandboxRunFailure,
  QuickJsSandboxRunOptions,
  QuickJsSandboxRunResult,
  QuickJsSandboxRunSuccess,
} from './quickjs-sandbox-types.ts'
