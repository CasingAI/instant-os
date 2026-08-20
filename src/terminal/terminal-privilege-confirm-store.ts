import type { TerminalPrivilegeRequest } from './terminal-privilege-types.ts'

export type TerminalPrivilegeConfirmOutcome =
  | { confirmed: false }
  | { confirmed: true; mountHandle?: FileSystemDirectoryHandle }

type PendingConfirm = {
  request: TerminalPrivilegeRequest
  resolve: (outcome: TerminalPrivilegeConfirmOutcome) => void
}

let pending: PendingConfirm | undefined
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function getPendingTerminalPrivilegeConfirm(): TerminalPrivilegeRequest | undefined {
  return pending?.request
}

export function subscribeTerminalPrivilegeConfirm(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 弹出 OS 级确认；同一时间只允许一个待确认请求。
 * 若已有待确认，新请求直接视为取消。
 */
export function requestTerminalPrivilegeConfirm(
  request: TerminalPrivilegeRequest,
): Promise<TerminalPrivilegeConfirmOutcome> {
  if (pending) {
    return Promise.resolve({ confirmed: false })
  }

  return new Promise<TerminalPrivilegeConfirmOutcome>((resolve) => {
    pending = {
      request,
      resolve: (outcome) => {
        pending = undefined
        emit()
        resolve(outcome)
      },
    }
    emit()
  })
}

export function resolveTerminalPrivilegeConfirm(outcome: TerminalPrivilegeConfirmOutcome): void {
  const current = pending
  if (!current) return
  current.resolve(outcome)
}
