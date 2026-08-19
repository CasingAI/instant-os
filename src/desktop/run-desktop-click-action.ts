import {
  resolveDesktopClickAction,
  resolveDesktopHoldAction,
  type DesktopClickAction,
} from '../dock/dock-settings-storage.ts'
import { closeOpenDesktopFolder } from './desktop-open-folder-session.ts'

type DesktopEmptyActionHandlers = {
  enterFlip3d: () => void
  toggleDesktopReveal: () => void
  hideDesktopReveal: () => void
  desktopRevealed: boolean
}

function runDesktopEmptyAction(
  action: DesktopClickAction,
  handlers: DesktopEmptyActionHandlers,
): void {
  closeOpenDesktopFolder()
  if (action === 'flip3d') {
    handlers.enterFlip3d()
    return
  }
  handlers.toggleDesktopReveal()
}

export function isDesktopEmptyPointerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return true
  }
  return target.closest('.desktop-icon') === null && target.closest('.desktop__page-dot') === null
}

/** 桌面空白处与程序坞两侧热区共用：随设置立即读取，不缓存。散开时点击只收回窗口。 */
export function runDesktopClickAction(handlers: DesktopEmptyActionHandlers): void {
  if (handlers.desktopRevealed) {
    closeOpenDesktopFolder()
    handlers.hideDesktopReveal()
    return
  }
  runDesktopEmptyAction(resolveDesktopClickAction(), handlers)
}

/** 按住桌面空白处：随设置立即读取，不缓存。 */
export function runDesktopHoldAction(handlers: DesktopEmptyActionHandlers): void {
  runDesktopEmptyAction(resolveDesktopHoldAction(), handlers)
}
