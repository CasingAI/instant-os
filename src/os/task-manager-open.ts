import { osOpenApp } from './os-open-app-bridge.ts'

export const OPEN_TASK_MANAGER_EVENT = 'instant-os:open-task-manager'

export type TaskManagerOpenTarget =
  | { tab: 'programs' }
  | { tab: 'performance'; category: 'proxy-server' }

let pending: TaskManagerOpenTarget | undefined

export function openTaskManager(target: TaskManagerOpenTarget = { tab: 'programs' }): void {
  try {
    osOpenApp('task-manager')
  } catch {
    // 系统尚未挂载 openApp（极少见）；仍保留 pending，窗口打开后会 consume
  }
  pending = target
  window.dispatchEvent(new CustomEvent(OPEN_TASK_MANAGER_EVENT, { detail: target }))
}

export function consumePendingOpenTaskManager(): TaskManagerOpenTarget | undefined {
  if (!pending) {
    return undefined
  }
  const target = pending
  pending = undefined
  return target
}
