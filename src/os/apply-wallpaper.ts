import { loadWallpaperSettings } from './wallpaper-settings-storage.ts'
import { isLightWallpaper, resolveBuiltinWallpaper, wallpaperPresentationStyle } from './wallpapers.ts'

export function applyWallpaperToElement(
  element: HTMLElement,
  wallpaperId = loadWallpaperSettings().wallpaperId,
): void {
  const wallpaper = resolveBuiltinWallpaper(wallpaperId)
  const presentation = wallpaperPresentationStyle(wallpaper)

  element.style.background = presentation.background
  element.style.backgroundSize = presentation.backgroundSize ?? ''
  element.style.backgroundPosition = presentation.backgroundPosition ?? ''
  element.style.setProperty('--wallpaper-background', wallpaper.background)
  element.style.setProperty('--wallpaper-background-size', presentation.backgroundSize ?? 'auto')
  element.style.setProperty(
    '--wallpaper-background-position',
    presentation.backgroundPosition ?? 'center',
  )
  element.style.setProperty(
    '--wallpaper-background-repeat',
    wallpaper.kind === 'pattern' ? 'repeat' : 'no-repeat',
  )
  element.style.setProperty('--wallpaper-overlay', wallpaper.overlay ?? 'none')
  element.dataset.wallpaperId = wallpaper.id
  element.dataset.wallpaperTone = isLightWallpaper(wallpaper) ? 'light' : 'dark'
}
