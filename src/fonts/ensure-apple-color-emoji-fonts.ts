import { loadDisplaySettings, type EmojiFontMode } from '../os/display-settings-storage.ts'

/** True when the OS already provides Apple Color Emoji (no web fallback needed). */
export function systemHasAppleColorEmoji(): boolean {
  const platform = navigator.platform ?? ''
  const ua = navigator.userAgent ?? ''

  // Only Apple platforms ship this font. Do not use document.fonts.check() here:
  // per spec it returns true for non-web font names even when the face is absent
  // (e.g. on Windows), which would skip bundled emoji loading in auto mode.
  return /Mac|iPhone|iPad|iPod/i.test(platform) || /Macintosh|iPhone|iPad/i.test(ua)
}

let webFontsEnsured = false

export function shouldLoadBundledEmojiFonts(mode: EmojiFontMode): boolean {
  if (mode === 'on') {
    return true
  }
  if (mode === 'off') {
    return false
  }
  return !systemHasAppleColorEmoji()
}

/** Applies emoji font mode at runtime: updates document state and loads bundled fonts when needed. */
export async function applyEmojiFontMode(mode?: EmojiFontMode): Promise<void> {
  const resolvedMode = mode ?? loadDisplaySettings().emojiFontMode
  const useBundled = shouldLoadBundledEmojiFonts(resolvedMode)
  const useBundledMetrics = useBundled && !systemHasAppleColorEmoji()
  document.documentElement.dataset.emojiFontMode = resolvedMode
  document.documentElement.dataset.emojiFontBundled = useBundledMetrics ? 'true' : 'false'

  if (!useBundled || webFontsEnsured) {
    return
  }

  webFontsEnsured = true
  await import('./apple-color-emoji.css')
  await document.fonts.ready
}

/** Loads bundled emoji web fonts according to display settings and system availability. */
export async function ensureAppleColorEmojiFonts(): Promise<void> {
  await applyEmojiFontMode()
}
