import { useEffect } from 'preact/hooks'
import type { RefObject } from 'preact'
import { applyWallpaperToElement } from './apply-wallpaper.ts'
import { WALLPAPER_SETTINGS_CHANGED_EVENT } from './wallpaper-settings-storage.ts'

export function useWallpaper(shellRef: RefObject<HTMLElement>) {
  useEffect(() => {
    const shell = shellRef.current
    if (!shell) {
      return
    }

    const refresh = () => {
      applyWallpaperToElement(shell)
    }

    refresh()
    window.addEventListener(WALLPAPER_SETTINGS_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(WALLPAPER_SETTINGS_CHANGED_EVENT, refresh)
  }, [shellRef])
}
