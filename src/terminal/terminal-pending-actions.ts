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
