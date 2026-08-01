import { isCrashScreenActive } from '../boot/crash-guard.ts'
import { loadExperimentalSettings } from './experimental-settings-storage.ts'

const BOOT_SPLASH_ID = 'instant-boot-splash'
const BOOT_HIDE_CURSOR_CLASS = 'instant-boot-hide-cursor'

export function getBootSplash(): HTMLElement | undefined {
  return document.getElementById(BOOT_SPLASH_ID) ?? undefined
}

export function setBootCursorHidden(hidden: boolean): void {
  // 崩溃屏需要可点按钮；启动隐藏光标的 !important 规则会盖掉崩溃 UI 的 cursor
  const alwaysShowCursor = loadExperimentalSettings().alwaysShowCursor === true
  const shouldHide = hidden && !isCrashScreenActive() && !alwaysShowCursor
  document.documentElement.classList.toggle(BOOT_HIDE_CURSOR_CLASS, shouldHide)
}

export function claimBootSplash(): void {
  const splash = getBootSplash()
  if (!splash) {
    return
  }

  splash.classList.remove('instant-boot-splash--dismissed', 'instant-boot-splash--cold-exit')
  splash.setAttribute('aria-busy', 'true')
  setBootCursorHidden(true)
}

export function startBootSplashColdExit(): void {
  const splash = getBootSplash()
  if (!splash) {
    return
  }

  splash.classList.add('instant-boot-splash--cold-exit')
  splash.setAttribute('aria-busy', 'false')
}

export function removeBootSplash(): void {
  getBootSplash()?.remove()
}
