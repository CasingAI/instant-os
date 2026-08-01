import type { TerminalChangeSet } from '../terminal/terminal-changeset.ts'
import type { TerminalFsMode } from '../terminal/terminal-fs-mode.ts'
import type { InstantShellHost } from '../terminal/instant-shell/instant-shell-types.ts'
import type { WebViewHostBindings } from '../apps/webview/inject-webview.ts'

/** QuickJS 实例控制台级别。 */
export type QuickJsConsoleLevel = 'log' | 'info' | 'warn' | 'error'

/** 推送给宿主的一条控制台输出。 */
export type QuickJsConsoleLine = {
  id: string
  level: QuickJsConsoleLevel
  text: string
  at: number
}

/** 实例级文件系统 / 网络权限（创建时绑定，脚本不可自行放大）。 */
export type QuickJsHostPermissions = {
  fsReadRoots: string[]
  fsWriteRoots: string[]
  /** 写操作拒绝前缀（须在 write root 内才生效）；用于 npm 场景禁改 node_modules。 */
  fsWriteDenyRoots: string[]
  /** L1 默认拒绝；终端会话（有 terminalSessionId）默认 true；可用 permissions.network 覆盖。 */
  network: boolean
}

/** 实例资源配额（含已有 runtime 限额）。 */
export type QuickJsHostQuotas = {
  /**
   * 单次 eval 墙钟上限（毫秒）。
   * 可为 `Infinity`（默认）：不限时，仅靠 abort / destroy 中断。
   */
  timeoutMs: number
  memoryLimitBytes: number
  maxStackSizeBytes: number
  /** 单文件读写上限（字节）；L1.6 起执行硬拒绝。 */
  maxFileBytes: number
}

/**
 * 创建时冻结的宿主上下文（env / argv / 工作区 / 权限配额）。
 * 活状态 `cwd` / `exitCode` 见 snapshot 与 eval 结果；脚本侧 `process` 由 L1.4 注入。
 */
export type QuickJsHostConfig = {
  workspaceRoot: string | undefined
  env: Record<string, string>
  argv: string[]
  permissions: QuickJsHostPermissions
  quotas: QuickJsHostQuotas
}

/** 创建实例时的宿主选项、默认限额与可选初始全局变量。 */
export type QuickJsInstanceOptions = {
  /**
   * VFS 工作区根（绝对路径）。
   * 未传表示无工作区（仅粘贴 eval）；后续 fs / 模块应对相对路径拒绝。
   */
  workspaceRoot?: string
  /**
   * 初始 `process.cwd`（绝对 VFS 路径）。
   * 未传时与既有规则一致（优先 workspaceRoot，否则 env / 默认 cwd）。
   * 可与 workspaceRoot 分离：例如 npm lifecycle 的 cwd 为包目录，读写根仍为项目根。
   */
  cwd?: string
  /**
   * 环境变量整表。
   * 若传入则整表使用传入拷贝；未传则使用系统默认 env。
   */
  env?: Record<string, string>
  /** 伪 process.argv；默认 `['instant-node']`。 */
  argv?: string[]
  /**
   * 文件系统工作模式（创建时冻结；切换需重建实例）。
   * - `normal`：可写，不记变更
   * - `readonly`：工作区只读；若有 session tmpdir 则仅该目录可写
   * - `controlled`：可写，每轮 eval 记录 ChangeSet（before + 清单；不含 `/tmp`）
   */
  fsMode?: TerminalFsMode
  /**
   * @deprecated 使用 `fsMode: 'readonly'`。为 true 时等同只读。
   */
  readOnly?: boolean
  /**
   * 终端 REPL / Agent 会话 UUID。优先用于解析 `os.tmpdir()` = `/tmp/Terminal/{id}`。
   */
  terminalSessionId?: string
  /**
   * 无绑定终端时 npm/npx 独立 run UUID。解析为 `/tmp/Npm/{id}`。
   * 与 `terminalSessionId` 并存时后者优先。
   */
  npmRunId?: string
  /**
   * 权限覆盖。未传时：无 workspaceRoot → 读写根为空（有 session tmp 时写根含 tmpdir）；
   * 有 workspaceRoot → 读根为 `/`，写根为工作区 + session tmpdir；
   * 有 terminalSessionId → network 默认 true（宿主 fetch 桥）；npm run 等默认 false。
   * `readonly`：写根仅为 session tmpdir（若有）。
   */
  permissions?: {
    fsReadRoots?: string[]
    fsWriteRoots?: string[]
    fsWriteDenyRoots?: string[]
    network?: boolean
  }
  /**
   * 单次 eval 默认墙钟上限（毫秒）。属配额。
   * 默认无超时；传入有限正数可限制。同步死循环 / pending Promise / waitUntilIdle 共用该预算。
   */
  timeoutMs?: number
  /** QuickJS 堆内存上限（字节），默认 128 MiB。属配额。 */
  memoryLimitBytes?: number
  /** 栈大小上限（字节），默认 512 KiB。属配额。 */
  maxStackSizeBytes?: number
  /** 单文件读写上限（字节），默认与数据空间上限对齐（1 GiB）。属配额。 */
  maxFileBytes?: number
  /** 注入到隔离上下文 globalThis 的可序列化全局变量（仅创建时一次）。 */
  globals?: Record<string, unknown>
  /**
   * 终端专用 `globalThis.instant` 壳层宿主绑定。
   * 未传则不注入（sandbox / Virtual JS 等默认无此能力）。
   */
  instantShellHost?: InstantShellHost
  /**
   * 终端专用 `globalThis.webview` 宿主绑定。
   * 未传则不注入；销毁 / `.reset` 时应由注入侧级联销毁所属浏览单元。
   */
  webviewHost?: WebViewHostBindings
}

export type QuickJsEvalOptions = {
  /**
   * 覆盖实例默认墙钟上限（毫秒）。
   * 传入有限正数可限制；省略则用实例默认（通常为无超时）。
   */
  timeoutMs?: number
  /**
   * 本轮入口模块文件名（绝对 VFS 路径，或相对 cwd）。
   * 未传时为 `{cwd}/[eval-{n}].js`，使相对 `import` 相对 cwd（类 Node eval）。
   */
  filename?: string
  /**
   * 为 true 时：在返回前等到挂起定时器 / 未结算 host Promise / 微任务排空
   *（若设置了有限 timeoutMs 则受其约束；setInterval 可能拖到超时）。
   * Agent / program 脚本默认开启；交互 REPL 默认关闭。
   */
  waitUntilIdle?: boolean
}

export type QuickJsEvalSuccess = {
  ok: true
  value: unknown
  /** 本轮结束时的 process.exitCode。 */
  exitCode: number
  /** 是否由 process.exit 结束本轮任务。 */
  exited: boolean
  consoleLines: QuickJsConsoleLine[]
  /** 受控模式下本轮文件系统变更；无改动时为 undefined 或空 changes。 */
  changes?: TerminalChangeSet
}

export type QuickJsEvalFailure = {
  ok: false
  error: string
  exitCode: number
  exited: boolean
  consoleLines: QuickJsConsoleLine[]
  changes?: TerminalChangeSet
  /**
   * WASM/QuickJS 硬崩：实例已 destroy，宿主须重建，勿再 eval。
   */
  fatal?: true
}

export type QuickJsEvalResult = QuickJsEvalSuccess | QuickJsEvalFailure

export type QuickJsInstanceSnapshot = {
  destroyed: boolean
  /** 此刻是否正在执行一段同步 JS 切片（含定时器回调）；挂起 timer 时仍可为 false。 */
  busy: boolean
  /** 实例当前工作目录（process.cwd）。 */
  cwd: string
  /** 当前 process.exitCode（不由最后表达式推断）。 */
  exitCode: number
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
  /** 只读宿主配置（env / argv / 工作区 / 权限配额）；不含 UI 订阅噪音。 */
  getHostConfig: () => QuickJsHostConfig
  /**
   * 往常驻实例塞一段代码并跑完。
   * 若表达式结果为 Promise，会等到 settle；`waitUntilIdle` 时再等到定时器等异步排空。
   * 返回值中的 value 仅作 REPL 展示；exitCode 只反映 process.exit / exitCode。
   */
  eval: (code: string, options?: QuickJsEvalOptions) => Promise<QuickJsEvalResult>
  /** 最近一轮受控 eval 的 ChangeSet（若有）。 */
  getLastChanges: () => TerminalChangeSet | undefined
  /**
   * 记录本轮 eval 期间宿主侧（如 instant.git）产生的工作树变更。
   * 在 seal 时与 FS journal 合并进 lastChanges。
   */
  noteExternalChangeSet: (changeSet: TerminalChangeSet) => void
  /** 仅清除上一轮 ChangeSet 指针（不回滚文件）。 */
  clearLastChanges: () => void
  /** 整轮回滚最近一轮受控变更；无则 no-op。 */
  revertLastChanges: () => Promise<void>
  /**
   * 中断当前同步切片（若有），并取消全部挂起定时器 / 待办宿主任务。
   * 实例仍存活，可继续 eval。
   */
  abort: () => void
  /** 清调度器并释放 runtime/context；之后不可再 eval。 */
  destroy: () => void
  /** 仅清空宿主侧控制台缓冲，不影响 JS 全局状态。 */
  clearConsole: () => void
}
