import { loadDisplaySettings, type EmojiFontMode } from '../os/display-settings-storage.ts'
import appleColorEmojiCss from './apple-color-emoji.css?raw'
import { appendBundledEmojiFontFaceMetrics } from './bundled-emoji-font-metrics.ts'
import { applyEmojiOffsetVariables } from './emoji-offset.ts'

const BUNDLED_EMOJI_STYLE_ID = 'instant-os-bundled-emoji-faces'

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

function injectBundledEmojiFontFaces(useMetrics: boolean): void {
  if (document.getElementById(BUNDLED_EMOJI_STYLE_ID)) {
    return
  }

  const css = useMetrics
    ? appendBundledEmojiFontFaceMetrics(appleColorEmojiCss)
    : appleColorEmojiCss
  const style = document.createElement('style')
  style.id = BUNDLED_EMOJI_STYLE_ID
  style.textContent = css
  document.head.appendChild(style)
}

export function shouldLoadBundledEmojiFonts(mode: EmojiFontMode): boolean {
  if (mode === 'on') {
    return true
  }
  if (mode === 'off') {
    return false
  }
  return !systemHasAppleColorEmoji()
}

/** True when web-bundled emoji metrics correction should apply (non-Apple + bundled fonts). */
export function shouldApplyBundledEmojiMetrics(mode?: EmojiFontMode): boolean {
  const resolvedMode = mode ?? loadDisplaySettings().emojiFontMode
  return shouldLoadBundledEmojiFonts(resolvedMode) && !systemHasAppleColorEmoji()
}

/** Applies emoji font mode at runtime: updates document state and loads bundled fonts when needed. */
export async function applyEmojiFontMode(mode?: EmojiFontMode): Promise<void> {
  const resolvedMode = mode ?? loadDisplaySettings().emojiFontMode
  const useBundled = shouldLoadBundledEmojiFonts(resolvedMode)
  const useBundledMetrics = shouldApplyBundledEmojiMetrics(resolvedMode)
  document.documentElement.dataset.emojiFontMode = resolvedMode
  document.documentElement.dataset.emojiFontBundled = useBundledMetrics ? 'true' : 'false'
  applyEmojiOffsetVariables()

  if (!useBundled || webFontsEnsured) {
    if (useBundled) {
      await document.fonts.ready
    }
    return
  }

  webFontsEnsured = true
  injectBundledEmojiFontFaces(useBundledMetrics)
  await document.fonts.ready
}

/** Loads bundled emoji web fonts according to display settings and system availability. */
export async function ensureAppleColorEmojiFonts(): Promise<void> {
  await applyEmojiFontMode()
}
