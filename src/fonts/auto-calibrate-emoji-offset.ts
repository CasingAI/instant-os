import { applyEmojiFontMode, ensureAppleColorEmojiFonts } from './ensure-apple-color-emoji-fonts.ts'
import { applyEmojiOffsetVariables } from './emoji-offset.ts'
import { EMOJI_PREVIEW_GLYPHS } from './emoji-preview-glyphs.ts'
import {
  ensureEmojiPreviewFontsLoaded,
  measureIconEmojiOffsetEm,
  resolveActiveEmojiFontFamily,
} from './measure-emoji-visual-offset.ts'
import { loadDisplaySettings, patchDisplaySettings } from '../os/display-settings-storage.ts'

const ICON_TILE_SIZE_PX = 72
const OFFSET_CLAMP_MIN = -0.15
const OFFSET_CLAMP_MAX = 0.15
const FONT_READY_MAX_ATTEMPTS = 3
const FONT_READY_RETRY_DELAY_MS = 2000

let autoCalibrationScheduled = false
let autoCalibrationRunning = false

function clampOffsetEm(value: number): number {
  return Math.min(OFFSET_CLAMP_MAX, Math.max(OFFSET_CLAMP_MIN, value))
}

function roundOffsetEm(value: number): number {
  return Math.round(value * 10000) / 10000
}

/** True when the user has never stored an emoji offset (manual or automatic). */
export function needsEmojiOffsetAutoCalibration(): boolean {
  return loadDisplaySettings().emojiOffsetEm === undefined
}

function scheduleBackgroundTask(task: () => void | Promise<void>): void {
  const run = () => {
    void task()
  }

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 4000 })
    return
  }

  window.setTimeout(run, 0)
}

async function waitForMeasurementFonts(): Promise<boolean> {
  const fontFamily = resolveActiveEmojiFontFamily()

  for (let attempt = 0; attempt < FONT_READY_MAX_ATTEMPTS; attempt += 1) {
    await applyEmojiFontMode()
    await ensureEmojiPreviewFontsLoaded(EMOJI_PREVIEW_GLYPHS, fontFamily, ICON_TILE_SIZE_PX)

    const fontSizePx = ICON_TILE_SIZE_PX * (50 / 72)
    const primaryFamily = fontFamily.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') ?? fontFamily
    const probeEmoji = EMOJI_PREVIEW_GLYPHS[0] ?? '😀'
    const faceReady = document.fonts.check(`${fontSizePx}px "${primaryFamily}"`, probeEmoji)

    if (faceReady) {
      return true
    }

    if (attempt < FONT_READY_MAX_ATTEMPTS - 1) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, FONT_READY_RETRY_DELAY_MS)
      })
    }
  }

  await document.fonts.ready
  return false
}

/**
 * Measure and persist emoji offset when the user has no stored value yet.
 * Runs silently in the background; does not block first paint.
 */
export async function autoCalibrateEmojiOffsetIfNeeded(): Promise<boolean> {
  if (autoCalibrationRunning) {
    return false
  }

  if (!needsEmojiOffsetAutoCalibration()) {
    return false
  }

  autoCalibrationRunning = true

  try {
    await ensureAppleColorEmojiFonts()
    await waitForMeasurementFonts()

    const measured = await measureIconEmojiOffsetEm(
      EMOJI_PREVIEW_GLYPHS,
      resolveActiveEmojiFontFamily(),
      ICON_TILE_SIZE_PX,
    )

    if (measured === undefined) {
      return false
    }

    if (!needsEmojiOffsetAutoCalibration()) {
      return false
    }

    const nextEm = roundOffsetEm(clampOffsetEm(measured))
    if (!patchDisplaySettings({ emojiOffsetEm: nextEm })) {
      return false
    }

    applyEmojiOffsetVariables()
    return true
  } finally {
    autoCalibrationRunning = false
  }
}

/** Schedule first-run calibration after the app has rendered. */
export function scheduleEmojiOffsetAutoCalibration(): void {
  if (autoCalibrationScheduled) {
    return
  }

  if (!needsEmojiOffsetAutoCalibration()) {
    return
  }

  autoCalibrationScheduled = true

  scheduleBackgroundTask(async () => {
    await autoCalibrateEmojiOffsetIfNeeded()
  })
}
