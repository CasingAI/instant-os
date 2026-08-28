/**
 * 虚拟机控制面的宿主侧包装：把「发 agentCommand 消息等回执」包成普通异步方法。
 *
 * 运行时页（跨域 iframe）里的 `window.__vm` 是唯一事实源；本文件只是 postMessage
 * 转发的类型化门面，方法名与运行时的 VM_AGENT_METHODS 白名单一一对应。
 * 控制面未启用（非 debug 构建且无 ?agent= 参数）时，所有方法都会 reject。
 */

import type { InstantVmKeyboardMessage } from './virtual-machine-protocol.ts'

/** 与 Instant-virtual-machine `vm-agent-control.ts` 的 VM_AGENT_METHODS 保持一致。 */
export const VM_AGENT_METHODS = [
  'readText',
  'screenshot',
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
  'snapshot',
  'captureStart',
  'captureStop',
  'dumpRing',
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

/** 巡检帧：文本模式带 text，图形模式带缩略 dataUrl（与运行时 ring buffer 一致）。 */
export type VmAgentRingFrame = {
  t: number
  kind: 'text' | 'jpeg'
  text?: string
  dataUrl?: string
}

export type VmAgentController = {
  /** 文本层内容（BIOS/自检/蓝屏等文字画面可直接读，等于免费 OCR）。 */
  readText(): Promise<string>
  /** 画布截图 PNG data URL；纯文本模式下返回 undefined（画面证据走 readText）。 */
  screenshot(): Promise<string | undefined>
  /** 控制面状态快照（启动阶段、蓝屏、ring 帧数、最近 PONG 年龄等）。 */
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
  /** 序列化整个虚拟机内存（耗时与 saveState 相当，超时按 10 分钟计）。 */
  snapshot(): Promise<ArrayBuffer>
  captureStart(): Promise<void>
  captureStop(): Promise<void>
  /** 取出瞬态环形缓冲（崩溃前后画面），并照常往桥日志落一份。 */
  dumpRing(reason?: string): Promise<VmAgentRingFrame[]>
  /** 崩溃自动冻结开关：无参读当前值，传布尔切换。 */
  freeze(): Promise<boolean>
  freeze(next: boolean): Promise<boolean>
  /** 白名单外的原始通道（method 直接透传，运行时白名单校验兜底）。 */
  raw(method: string, args?: readonly unknown[]): Promise<unknown>
}

export function createVmAgent(send: VmAgentSend): VmAgentController {
  const call = async (method: VmAgentMethodName, args?: readonly unknown[]) =>
    (await send(method, args)) as never
  return {
    readText: () => call('readText'),
    screenshot: () => call('screenshot'),
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
    snapshot: () => call('snapshot'),
    captureStart: () => call('captureStart'),
    captureStop: () => call('captureStop'),
    dumpRing: (reason = 'manual') => call('dumpRing', [reason]),
    freeze: (...args: unknown[]) => send('freeze', args) as Promise<boolean>,
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
