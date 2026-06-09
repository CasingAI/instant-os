import {
  loadDisplaySettings,
  type DisplaySettings,
} from '../os/display-settings-storage.ts'
import { shouldApplyBundledEmojiMetrics } from './ensure-apple-color-emoji-fonts.ts'

export const EMOJI_OFFSET_CSS_VAR = '--emoji-offset-em'

/** @deprecated Use EMOJI_OFFSET_CSS_VAR */
export const EMOJI_OFFSET_ICON_CSS_VAR = '--emoji-offset-em'
/** @deprecated Use EMOJI_OFFSET_CSS_VAR */
export const EMOJI_OFFSET_TEXT_CSS_VAR = '--emoji-offset-em'

const LEGACY_BUNDLED_OFFSET_EM = -0.02

export function resolveEmojiOffsetEm(settings?: DisplaySettings): number {
  const resolved = settings ?? loadDisplaySettings()
  if (resolved.emojiOffsetEm !== undefined) {
    return resolved.emojiOffsetEm
  }
  return shouldApplyBundledEmojiMetrics(resolved.emojiFontMode)
    ? LEGACY_BUNDLED_OFFSET_EM
    : 0
}

/** @deprecated Use resolveEmojiOffsetEm */
export function resolveEmojiOffsetIconEm(settings?: DisplaySettings): number {
  return resolveEmojiOffsetEm(settings)
}

/** @deprecated Use resolveEmojiOffsetEm */
export function resolveEmojiOffsetTextEm(settings?: DisplaySettings): number {
  return resolveEmojiOffsetEm(settings)
}

export function applyEmojiOffsetVariables(settings?: DisplaySettings): void {
  const offsetEm = resolveEmojiOffsetEm(settings)
  const root = document.documentElement

  root.style.setProperty(EMOJI_OFFSET_CSS_VAR, String(offsetEm))
  root.dataset.emojiOffset = String(offsetEm)
}

export function buildEmojiOffsetVariablesCss(settings?: DisplaySettings): string {
  const offsetEm = resolveEmojiOffsetEm(settings)

  return `:root {
  ${EMOJI_OFFSET_CSS_VAR}: ${offsetEm};
}`
}

/** Format unitless em offset for display (e.g. -0.02 → "-2.0%"). */
export function formatEmojiOffsetPercent(em: number): string {
  return `${(em * 100).toFixed(1)}%`
}

/** Parse user input like "-2" or "-2.0%" into unitless em. */
export function parseEmojiOffsetPercentInput(raw: string): number | undefined {
  const trimmed = raw.trim().replace(/%$/, '')
  if (!trimmed) {
    return undefined
  }

  const parsed = Number.parseFloat(trimmed)
  if (!Number.isFinite(parsed)) {
    return undefined
  }

  return parsed / 100
}
