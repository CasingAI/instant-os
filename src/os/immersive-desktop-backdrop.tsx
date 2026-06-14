import { useFullscreenChromeReveal } from './fullscreen-chrome-reveal-context.tsx'
import { STATUS_BAR_HEIGHT } from '../window/window-metrics.ts'
import './immersive-desktop-backdrop.css'

export function ImmersiveDesktopBackdrop() {
  const { hasImmersiveFullscreen, chromeRevealed } = useFullscreenChromeReveal()

  if (!hasImmersiveFullscreen || !chromeRevealed) {
    return undefined
  }

  return (
    <div
      class="immersive-desktop-backdrop"
      style={{ '--immersive-desktop-backdrop-height': `${STATUS_BAR_HEIGHT}px` }}
      aria-hidden="true"
    >
      <div class="immersive-desktop-backdrop__base" />
      <div class="immersive-desktop-backdrop__overlay" />
    </div>
  )
}
