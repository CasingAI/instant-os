import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'
import {
  getDefaultTerminalCwd,
  normalizeTerminalAbsolutePath,
  resolveTerminalPath,
} from '../terminal/terminal-path.ts'

/** 实例侧可变 process 状态（cwd / exitCode；env·argv 仅在 guest 内可变）。 */
export type QuickJsProcessState = {
  cwd: string
  exitCode: number
  exitRequested: boolean
}

export type InjectProcessHooks = {
  /** 脚本调用 process.exit 时请求结束本轮 eval。 */
  requestExit: () => void
  writeStdout: (text: string) => void
  writeStderr: (text: string) => void
}

export function resolveInitialProcessCwd(
  workspaceRoot: string | undefined,
  env: Record<string, string>,
  explicitCwd?: string,
): string {
  if (explicitCwd !== undefined) {
    const trimmed = explicitCwd.trim()
    if (trimmed) {
      return normalizeTerminalAbsolutePath(trimmed)
    }
  }

  if (workspaceRoot !== undefined) {
    return workspaceRoot
  }

  const fromPwd = tryNormalizeAbsolute(env.PWD)
  if (fromPwd !== undefined) {
    return fromPwd
  }

  const fromHome = tryNormalizeAbsolute(env.HOME)
  if (fromHome !== undefined) {
    return fromHome
  }

  return getDefaultTerminalCwd()
}

export function createProcessState(
  workspaceRoot: string | undefined,
  env: Record<string, string>,
  explicitCwd?: string,
): QuickJsProcessState {
  return {
    cwd: resolveInitialProcessCwd(workspaceRoot, env, explicitCwd),
    exitCode: 0,
    exitRequested: false,
  }
}

function tryNormalizeAbsolute(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined
  }
  const trimmed = raw.trim()
  if (!trimmed) {
    return undefined
  }
  try {
    return normalizeTerminalAbsolutePath(trimmed)
  } catch {
    return undefined
  }
}

function tryDecodeBinaryWriteChunk(
  context: QuickJSContext,
  handle: QuickJSHandle,
): string | undefined {
  try {
    const lifetime = context.getArrayBuffer(handle)
    try {
      return new TextDecoder('utf-8').decode(lifetime.value)
    } finally {
      lifetime.dispose()
    }
  } catch {
    // TypedArray / Buffer 视图
  }

  let bufferHandle: QuickJSHandle | undefined
  let offsetHandle: QuickJSHandle | undefined
  let lengthHandle: QuickJSHandle | undefined
  try {
    bufferHandle = context.getProp(handle, 'buffer')
    if (context.typeof(bufferHandle) === 'undefined') {
      return undefined
    }
    offsetHandle = context.getProp(handle, 'byteOffset')
    lengthHandle = context.getProp(handle, 'byteLength')
    const offset = context.typeof(offsetHandle) === 'number' ? context.getNumber(offsetHandle) : 0
    const length =
      context.typeof(lengthHandle) === 'number' ? context.getNumber(lengthHandle) : undefined
    const lifetime = context.getArrayBuffer(bufferHandle)
    try {
      const view = lifetime.value
      const slice =
        length === undefined ? view.subarray(offset) : view.subarray(offset, offset + length)
      return new TextDecoder('utf-8').decode(slice)
    } finally {
      lifetime.dispose()
    }
  } catch {
    return undefined
  } finally {
    lengthHandle?.dispose()
    offsetHandle?.dispose()
    bufferHandle?.dispose()
  }
}

function formatWriteChunk(context: QuickJSContext, handle: QuickJSHandle): string {
  const fromBinary = tryDecodeBinaryWriteChunk(context, handle)
  if (fromBinary !== undefined) {
    return fromBinary
  }

  try {
    const dumped = context.dump(handle)
    if (typeof dumped === 'string') {
      return dumped
    }
    if (
      dumped === undefined ||
      dumped === null ||
      typeof dumped === 'number' ||
      typeof dumped === 'boolean' ||
      typeof dumped === 'bigint'
    ) {
      return String(dumped)
    }
    // Buffer.toJSON() → { type: 'Buffer', data: number[] }
    if (
      typeof dumped === 'object' &&
      dumped !== null &&
      (dumped as { type?: unknown }).type === 'Buffer' &&
      Array.isArray((dumped as { data?: unknown }).data)
    ) {
      const data = (dumped as { data: number[] }).data
      return new TextDecoder('utf-8').decode(Uint8Array.from(data))
    }
    if (Array.isArray(dumped) && dumped.every((item) => typeof item === 'number')) {
      return new TextDecoder('utf-8').decode(Uint8Array.from(dumped as number[]))
    }
    try {
      return JSON.stringify(dumped)
    } catch {
      return Object.prototype.toString.call(dumped)
    }
  } catch {
    try {
      return context.getString(handle)
    } catch {
      return `[${context.typeof(handle)}]`
    }
  }
}

function normalizeExitCode(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value | 0
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed | 0
    }
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }
  return 0
}

function injectJsonValue(context: QuickJSContext, target: QuickJSHandle, key: string, value: unknown): void {
  const handle = context.unwrapResult(context.evalCode(`(${JSON.stringify(value)})`))
  context.setProp(target, key, handle)
  handle.dispose()
}

function createWriteStream(
  context: QuickJSContext,
  write: (text: string) => void,
  options?: { isTTY?: boolean },
): QuickJSHandle {
  const stream = context.newObject()
  const writeFn = context.newFunction('write', (chunkHandle) => {
    write(formatWriteChunk(context, chunkHandle))
    return context.undefined
  })
  context.setProp(stream, 'write', writeFn)
  writeFn.dispose()
  // 保守假值：非 TTY，避免 CLI 走彩色/交互分支；缺省仍可读（undefined→falsy）
  injectJsonValue(context, stream, 'isTTY', options?.isTTY === true)
  return stream
}

/**
 * Instant guest 宣称的 Node 兼容标签（非完整 Node 实现承诺）。
 * 用于 engines / `process.versions.node` 嗅探；API 设计以该主线的文档子集为锚，
 * 实际能力以已实现内建表为准。
 */
export const INSTANT_NODE_COMPAT_VERSION = '20.18.0'

/** `process.versions` 最小假对象：保证 `.electron` 等探测不崩；不伪造 electron。 */
export const INSTANT_PROCESS_VERSIONS = {
  node: INSTANT_NODE_COMPAT_VERSION,
} as const

/**
 * 注入 globalThis.process 子集（cwd/env/argv/exit/stdio + CLI 探测假值）。
 * `nextTick` 由异步桥在 injectGlobals 时挂上（须本函数先执行）。
 * env / argv 为 guest 内可变拷贝；cwd / exitCode 经桥与宿主 state 同步。
 */
export function injectProcess(
  context: QuickJSContext,
  state: QuickJsProcessState,
  seed: { env: Record<string, string>; argv: string[] },
  hooks: InjectProcessHooks,
): void {
  const processObject = context.newObject()

  injectJsonValue(context, processObject, 'env', seed.env)
  injectJsonValue(context, processObject, 'argv', seed.argv)
  injectJsonValue(context, processObject, 'exitCode', state.exitCode)
  // L2.5.8：CLI 常用探测面（yargs 读 process.versions.electron）
  injectJsonValue(context, processObject, 'version', `v${INSTANT_NODE_COMPAT_VERSION}`)
  injectJsonValue(context, processObject, 'versions', { ...INSTANT_PROCESS_VERSIONS })
  injectJsonValue(context, processObject, 'platform', 'linux')
  injectJsonValue(context, processObject, 'arch', 'x64')
  // yargs / CLI 常用：execPath 仅作路径前缀探测，非真实二进制
  injectJsonValue(context, processObject, 'execPath', '/instant/bin/node')

  const cwdFn = context.newFunction('cwd', () => context.newString(state.cwd))
  context.setProp(processObject, 'cwd', cwdFn)
  cwdFn.dispose()

  const chdirFn = context.newFunction('chdir', (pathHandle) => {
    const raw = formatWriteChunk(context, pathHandle)
    try {
      state.cwd = resolveTerminalPath(state.cwd, raw)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(message)
    }
    return context.undefined
  })
  context.setProp(processObject, 'chdir', chdirFn)
  chdirFn.dispose()

  const exitFn = context.newFunction('exit', (...argHandles) => {
    if (argHandles.length > 0) {
      try {
        state.exitCode = normalizeExitCode(context.dump(argHandles[0]!))
      } catch {
        state.exitCode = 0
      }
    } else {
      syncExitCodeFromGuest(context, state)
    }

    // 写回 guest，避免随后 syncExitCodeFromGuest 用旧值覆盖宿主
    writeGuestExitCode(context, state.exitCode)

    state.exitRequested = true
    hooks.requestExit()
    // 立即打断后续同步代码（仅靠 interrupt 标志不一定在同轮检查）
    throw new Error('process.exit')
  })
  context.setProp(processObject, 'exit', exitFn)
  exitFn.dispose()

  const stdout = createWriteStream(context, hooks.writeStdout, { isTTY: false })
  context.setProp(processObject, 'stdout', stdout)
  stdout.dispose()

  const stderr = createWriteStream(context, hooks.writeStderr, { isTTY: false })
  context.setProp(processObject, 'stderr', stderr)
  stderr.dispose()

  // 无真实 stdin：标为 TTY，使 get-stdin 等在无管道时立刻返回空串，避免 for-await 挂起
  const stdin = context.newObject()
  injectJsonValue(context, stdin, 'isTTY', true)
  context.setProp(processObject, 'stdin', stdin)
  stdin.dispose()

  context.setProp(context.global, 'process', processObject)
  processObject.dispose()
}

function writeGuestExitCode(context: QuickJSContext, exitCode: number): void {
  let processHandle: QuickJSHandle | undefined
  let codeHandle: QuickJSHandle | undefined
  try {
    processHandle = context.getProp(context.global, 'process')
    if (!processHandle || context.typeof(processHandle) !== 'object') {
      return
    }
    codeHandle = context.newNumber(exitCode)
    context.setProp(processHandle, 'exitCode', codeHandle)
  } catch {
    // 忽略写回失败
  } finally {
    codeHandle?.dispose()
    processHandle?.dispose()
  }
}

/** 从 guest `process.exitCode` 同步到宿主 state（exit() 已写过则可再读一次）。 */
export function syncExitCodeFromGuest(context: QuickJSContext, state: QuickJsProcessState): void {
  let processHandle: QuickJSHandle | undefined
  let exitCodeHandle: QuickJSHandle | undefined
  try {
    processHandle = context.getProp(context.global, 'process')
    if (!processHandle || context.typeof(processHandle) !== 'object') {
      return
    }
    exitCodeHandle = context.getProp(processHandle, 'exitCode')
    state.exitCode = normalizeExitCode(context.dump(exitCodeHandle))
  } catch {
    // 忽略同步失败，保留宿主当前值
  } finally {
    exitCodeHandle?.dispose()
    processHandle?.dispose()
  }
}
