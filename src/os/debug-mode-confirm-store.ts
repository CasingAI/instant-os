/**
 * Debug 模式进入确认 store。
 * 仿照 terminal-privilege-confirm-store 的 Promise 风格：app.tsx 请求确认，
 * 全局 DebugModeWarningDialog 订阅并展示，用户操作后 resolve。
 */
export type DebugModeConfirmRequest = {
  command?: string
}

type PendingConfirm = {
  request: DebugModeConfirmRequest
  resolve: (confirmed: boolean) => void
}

let pending: PendingConfirm | undefined
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function getPendingDebugModeConfirm(): DebugModeConfirmRequest | undefined {
  return pending?.request
}

export function subscribeDebugModeConfirm(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 弹出 OS 级确认；同一时间只允许一个待确认请求。
 * 若已有待确认，新请求直接视为未确认。
 */
export function requestDebugModeConfirm(request: DebugModeConfirmRequest): Promise<boolean> {
  if (pending) {
    return Promise.resolve(false)
  }

  return new Promise<boolean>((resolve) => {
    pending = {
      request,
      resolve: (confirmed) => {
        pending = undefined
        emit()
        resolve(confirmed)
      },
    }
    emit()
  })
}

export function resolveDebugModeConfirm(confirmed: boolean): void {
  const current = pending
  if (!current) return
  current.resolve(confirmed)
}
