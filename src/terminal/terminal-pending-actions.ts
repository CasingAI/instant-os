/**
 * @deprecated 随模拟终端弃用。此文件实现模拟终端的待确认特权操作队列，
 * 用于从其他 app（如帮助）向模拟终端注入待确认的操作（挂载/写存储/删除等）。
 * 复用提示：os-context 仍通过 enqueueTerminalPendingAction 向队列注入操作，
 * 迁移完成前不要删除。
 * 保留仅为过渡，新功能不要加在这里。
 */
import type { TerminalPrivilegeRequest } from './terminal-privilege-types.ts'

let queue: TerminalPrivilegeRequest[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function enqueueTerminalPendingAction(action: TerminalPrivilegeRequest): void {
  queue = [...queue, action]
  emit()
}

export function peekTerminalPendingActions(): readonly TerminalPrivilegeRequest[] {
  return queue
}

/** 取出队首待办（终端 APP 消费） */
export function takeTerminalPendingAction(): TerminalPrivilegeRequest | undefined {
  if (queue.length === 0) return undefined
  const [first, ...rest] = queue
  queue = rest
  emit()
  return first
}

export function subscribeTerminalPendingActions(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
