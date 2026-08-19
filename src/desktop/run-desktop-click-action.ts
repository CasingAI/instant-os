import { closeOpenDesktopFolder } from './desktop-open-folder-session.ts'
import { resolveDesktopClickAction } from '../dock/dock-settings-storage.ts'

/** 桌面空白处与程序坞两侧热区共用：随设置立即读取，不缓存。 */
export function runDesktopClickAction(handlers: {
  enterFlip3d: () => void
  toggleDesktopReveal: () => void
}): void {
  closeOpenDesktopFolder()
  if (resolveDesktopClickAction() === 'flip3d') {
    handlers.enterFlip3d()
    return
  }
  handlers.toggleDesktopReveal()
}
