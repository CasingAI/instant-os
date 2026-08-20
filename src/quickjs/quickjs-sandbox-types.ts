export type QuickJsSandboxRunOptions = {
  /** 执行超时（毫秒），默认 5000。 */
  timeoutMs?: number
  /** QuickJS 堆内存上限（字节），默认 16 MiB。 */
  memoryLimitBytes?: number
  /** 栈大小上限（字节），默认 512 KiB。 */
  maxStackSizeBytes?: number
  /** 注入到隔离上下文 globalThis 的可序列化全局变量。 */
  globals?: Record<string, unknown>
}

export type QuickJsSandboxRunSuccess = {
  ok: true
  value: unknown
}

export type QuickJsSandboxRunFailure = {
  ok: false
  error: string
}

export type QuickJsSandboxRunResult = QuickJsSandboxRunSuccess | QuickJsSandboxRunFailure
