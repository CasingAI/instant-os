/**
 * 虚拟机命令通道的宿主侧包装：把「发 agentCommand 消息等回执」包成普通异步方法。
 *
 * 运行时页（跨域 iframe）里的 `window.__vm` 是唯一事实源；本文件只是 postMessage
 * 转发的类型化门面，方法名与运行时的 VM_AGENT_METHODS 白名单一一对应。
 * 控制面未启用（非 debug 构建且无 ?agent= 参数）时，所有方法都会 reject。
 *
 * 感知层方法（readText/screenshot/snapshot/dumpRing/freeze 等）已于 2026-08-29
 * 随运行时侧一并移除（AI 自主操作残留清理）；保留的只有产品功能与剪贴板
 * 依赖的命令面。
 */

import type { InstantVmKeyboardMessage } from './virtual-machine-protocol.ts'

/** 与 Instant-virtual-machine `vm-agent-control.ts` 的 VM_AGENT_METHODS 保持一致。 */
export const VM_AGENT_METHODS = [
  'state',
  'key',
  'keyEvent',
  'ping',
  'exec',
  'execResult',
  'clipboardWrite',
  'filePending',
  'fileClear',
  'fileReq',
  'fileChunk',
  'fileDone',
  'fileWindow',
  'fileWindowsClear',
  'click',
  'dblclick',
  'snap',
  'shutdown',
  'reboot',
] as const

/** 文件通道元数据条目（与 ivm-shm.ts IvmFileEntry 同构）。 */
export type VmFileEntry = { path: string; size: number }

export type VmAgentMethodName = (typeof VM_AGENT_METHODS)[number]

export type VmAgentSend = (method: string, args?: readonly unknown[]) => Promise<unknown>

/** execResult 的收敛结果：成功带退出码（timedOut=客机 15s 超时击杀）。 */
export type VmExecResult =
  | { ok: true; exitCode: number; timedOut: boolean }
  | {
      ok: false
      error: 'busy' | 'timeout' | 'launch' | 'args' | 'ascii' | 'unbound'
      detail?: string
    }

export type VmAgentController = {
  /** 控制面状态快照（连通探测读 lastPongAgeMs；关机按钮前置检查依赖）。 */
  state(): Promise<Record<string, unknown>>
  key(text: string): Promise<void>
  keyEvent(message: InstantVmKeyboardMessage): Promise<void>
  ping(): Promise<void>
  exec(cmdline: string): Promise<void>
  /** 等待退出码的 EXEC（客机 15s、宿主 30s 超时；同时只允许一单）。 */
  execResult(cmdline: string): Promise<VmExecResult>
  /** 宿主 → 客机剪贴板文本（ivm-shm 信箱；未握手时运行时排队，失败仅参数无效）。 */
  clipboardWrite(text: string): Promise<boolean>
  /**
   * 文件通道（ivm-shm op=1 帧；false = 参数无效或信箱忙，调用方重试）。
   * filePending：推待粘贴清单（宿主→XP 会话入口）；fileReq：宿主来拉一块
   * （XP→宿主会话）；fileChunk：按桥的 REQ 供一块；fileDone：结束会话。
   */
  filePending(session: number, mode: 'copy' | 'cut', files: readonly VmFileEntry[]): Promise<boolean>
  fileClear(): Promise<boolean>
  fileReq(session: number, start: boolean, path: string | null, offset: number, length: number): Promise<boolean>
  fileChunk(session: number, offset: number, bytes: ArrayBuffer, end: boolean): Promise<boolean>
  fileDone(session: number, result: 'ok' | 'cancel' | 'error'): Promise<boolean>
  /**
   * 宿主预读窗注入（纯 iframe 内存，不走信箱）：宿主→XP 粘贴时按大块预读
   * 推给运行时页，REQ 命中窗由运行时页就地供块，免去每块一次往返。
   */
  fileWindow(session: number, name: string, offset: number, bytes: ArrayBuffer): Promise<boolean>
  /** 清运行时页预读窗（新会话开推前/会话收尾调用，防跨会话脏数据）。 */
  fileWindowsClear(): Promise<boolean>
  click(x: number, y: number): Promise<void>
  dblclick(x: number, y: number): Promise<void>
  /**
   * 窗口吸附开关 + 触发距离（OP_SNAP/OP_SNAP_EDGE 帧直发，客机无回执；
   * 运行中实时生效）。edgeBasePx 由运行时校验 2..64，客机侧再 clamp 兜底。
   */
  snap(enabled: boolean, edgeBasePx: number): Promise<void>
  shutdown(): Promise<void>
  reboot(): Promise<void>
  /** 白名单外的原始通道（method 直接透传，运行时白名单校验兜底）。 */
  raw(method: string, args?: readonly unknown[]): Promise<unknown>
}

export function createVmAgent(send: VmAgentSend): VmAgentController {
  const call = async (method: VmAgentMethodName, args?: readonly unknown[]) =>
    (await send(method, args)) as never
  return {
    state: () => call('state'),
    key: (text) => call('key', [text]),
    keyEvent: (message) => call('keyEvent', [message]),
    ping: () => call('ping'),
    exec: (cmdline) => call('exec', [cmdline]),
    execResult: (cmdline) => call('execResult', [cmdline]) as Promise<VmExecResult>,
    clipboardWrite: (text) => call('clipboardWrite', [text]) as Promise<boolean>,
    filePending: (session, mode, files) =>
      call('filePending', [session, mode, files.map((f) => ({ path: f.path, size: f.size }))]) as Promise<boolean>,
    fileClear: () => call('fileClear') as Promise<boolean>,
    fileReq: (session, start, path, offset, length) =>
      call('fileReq', [session, start, path, offset, length]) as Promise<boolean>,
    fileChunk: (session, offset, bytes, end) =>
      call('fileChunk', [session, offset, bytes, end]) as Promise<boolean>,
    fileDone: (session, result) => call('fileDone', [session, result]) as Promise<boolean>,
    fileWindow: (session, name, offset, bytes) =>
      call('fileWindow', [session, name, offset, bytes]) as Promise<boolean>,
    fileWindowsClear: () => call('fileWindowsClear') as Promise<boolean>,
    click: (x, y) => call('click', [x, y]),
    dblclick: (x, y) => call('dblclick', [x, y]),
    snap: (enabled, edgeBasePx) => call('snap', [enabled, edgeBasePx]),
    shutdown: () => call('shutdown'),
    reboot: () => call('reboot'),
    raw: (method, args) => send(method, args),
  }
}

/**
 * 从运行时池拿指定实例的门面。机器未在运行时，首次调用即 reject
 * （与池里 saveInstanceState 的行为一致）。
 */
export function vmAgentFor(
  pool: { agentCommand(id: string, method: string, args?: readonly unknown[]): Promise<unknown> },
  machineId: string,
): VmAgentController {
  return createVmAgent((method, args) => pool.agentCommand(machineId, method, args))
}
