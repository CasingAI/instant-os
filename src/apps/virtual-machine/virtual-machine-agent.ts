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
  'serialSend',
  'key',
  'keyEvent',
  'ping',
  'exec',
  'execResult',
  'clipboardWrite',
  'click',
  'dblclick',
  'shutdown',
  'reboot',
  'restartVm',
] as const

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
  serialSend(bytes: number[] | string): Promise<void>
  key(text: string): Promise<void>
  keyEvent(message: InstantVmKeyboardMessage): Promise<void>
  ping(): Promise<void>
  exec(cmdline: string): Promise<void>
  /** 等待退出码的 EXEC（客机 15s、宿主 30s 超时；同时只允许一单）。 */
  execResult(cmdline: string): Promise<VmExecResult>
  /** 宿主 → 客机剪贴板文本（ivm-shm 信箱；未握手时运行时排队，失败仅参数无效）。 */
  clipboardWrite(text: string): Promise<boolean>
  click(x: number, y: number): Promise<void>
  dblclick(x: number, y: number): Promise<void>
  shutdown(): Promise<void>
  reboot(): Promise<void>
  restartVm(): Promise<void>
  /** 白名单外的原始通道（method 直接透传，运行时白名单校验兜底）。 */
  raw(method: string, args?: readonly unknown[]): Promise<unknown>
}

export function createVmAgent(send: VmAgentSend): VmAgentController {
  const call = async (method: VmAgentMethodName, args?: readonly unknown[]) =>
    (await send(method, args)) as never
  return {
    state: () => call('state'),
    serialSend: (bytes) => call('serialSend', [bytes]),
    key: (text) => call('key', [text]),
    keyEvent: (message) => call('keyEvent', [message]),
    ping: () => call('ping'),
    exec: (cmdline) => call('exec', [cmdline]),
    execResult: (cmdline) => call('execResult', [cmdline]) as Promise<VmExecResult>,
    clipboardWrite: (text) => call('clipboardWrite', [text]) as Promise<boolean>,
    click: (x, y) => call('click', [x, y]),
    dblclick: (x, y) => call('dblclick', [x, y]),
    shutdown: () => call('shutdown'),
    reboot: () => call('reboot'),
    restartVm: () => call('restartVm'),
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
