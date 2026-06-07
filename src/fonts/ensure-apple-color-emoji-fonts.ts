/** True when the OS already provides Apple Color Emoji (no web fallback needed). */
export function systemHasAppleColorEmoji(): boolean {
  const platform = navigator.platform ?? ''
  const ua = navigator.userAgent ?? ''

  if (/Mac|iPhone|iPad|iPod/i.test(platform) || /Macintosh|iPhone|iPad/i.test(ua)) {
    return true
  }

  try {
    return document.fonts.check('32px "Apple Color Emoji"')
  } catch {
    return false
  }
}

let webFontsEnsured = false

/** Loads chunked web fonts only when the system font is unavailable. */
export async function ensureAppleColorEmojiFonts(): Promise<void> {
  if (webFontsEnsured || systemHasAppleColorEmoji()) {
    return
  }

  webFontsEnsured = true
  await import('./apple-color-emoji.css')
}
