import { loadWallpaperSettings } from './wallpaper-settings-storage.ts'
import { resolveBuiltinWallpaper, wallpaperPresentationStyle } from './wallpapers.ts'

export function applyWallpaperToElement(
  element: HTMLElement,
  wallpaperId = loadWallpaperSettings().wallpaperId,
): void {
  const wallpaper = resolveBuiltinWallpaper(wallpaperId)
  const presentation = wallpaperPresentationStyle(wallpaper)

  element.style.background = presentation.background
  element.style.backgroundSize = presentation.backgroundSize ?? ''
  element.style.backgroundPosition = presentation.backgroundPosition ?? ''
  element.style.setProperty('--wallpaper-overlay', wallpaper.overlay ?? 'none')
  element.dataset.wallpaperId = wallpaper.id
}
