/** QuickJS 实例控制台级别。 */
export type QuickJsConsoleLevel = 'log' | 'info' | 'warn' | 'error'

/** 推送给宿主的一条控制台输出。 */
export type QuickJsConsoleLine = {
  id: string
  level: QuickJsConsoleLevel
  text: string
  at: number
}

/** 创建实例时的默认限额与可选初始全局变量。 */
export type QuickJsInstanceOptions = {
  /** 单次 eval 默认超时（毫秒），默认 5000。 */
  timeoutMs?: number
  /** QuickJS 堆内存上限（字节），默认 16 MiB。 */
  memoryLimitBytes?: number
  /** 栈大小上限（字节），默认 512 KiB。 */
  maxStackSizeBytes?: number
  /** 注入到隔离上下文 globalThis 的可序列化全局变量（仅创建时一次）。 */
  globals?: Record<string, unknown>
}

export type QuickJsEvalOptions = {
  /** 覆盖实例默认超时。 */
  timeoutMs?: number
}

export type QuickJsEvalSuccess = {
  ok: true
  value: unknown
  consoleLines: QuickJsConsoleLine[]
}

export type QuickJsEvalFailure = {
  ok: false
  error: string
  consoleLines: QuickJsConsoleLine[]
}

export type QuickJsEvalResult = QuickJsEvalSuccess | QuickJsEvalFailure

export type QuickJsInstanceSnapshot = {
  destroyed: boolean
  busy: boolean
  consoleLines: QuickJsConsoleLine[]
}

export type QuickJsInstanceListener = () => void

/**
 * 与宿主会话同寿的 QuickJS 实例。
 * 同一实例内多次 eval 共享上下文；宿主关闭时应调用 destroy。
 */
export type QuickJsInstance = {
  subscribe: (listener: QuickJsInstanceListener) => () => void
  getSnapshot: () => QuickJsInstanceSnapshot
  eval: (code: string, options?: QuickJsEvalOptions) => Promise<QuickJsEvalResult>
  /** 中断当前正在执行的 eval（若有）。 */
  abort: () => void
  /** 释放 runtime/context；之后不可再 eval。 */
  destroy: () => void
  /** 仅清空宿主侧控制台缓冲，不影响 JS 全局状态。 */
  clearConsole: () => void
}
