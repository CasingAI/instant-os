const BOOT_SPLASH_ID = 'instant-boot-splash'

export function getBootSplash(): HTMLElement | undefined {
  return document.getElementById(BOOT_SPLASH_ID) ?? undefined
}

export function claimBootSplash(): void {
  const splash = getBootSplash()
  if (!splash) {
    return
  }

  splash.classList.remove('instant-boot-splash--dismissed', 'instant-boot-splash--cold-exit')
  splash.setAttribute('aria-busy', 'true')
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
