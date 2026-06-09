import { applyEmojiOffsetVariables } from './emoji-offset.ts'

export type EmojiCalibrationPhase = 'pending' | 'appear' | 'measure' | 'done' | 'failed'

export type EmojiCalibrationProgress = {
  index: number
  emoji: string
  phase: EmojiCalibrationPhase
  offsetEm?: number
}

type MeasureEmojiLayout = {
  emoji: string
  fontFamily: string
  fontSizePx: number
  boxSizePx: number
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((left, right) => left - right)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]
}

async function waitForPaint(): Promise<void> {
  await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()) })
  await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()) })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, ms) })
}

async function withZeroEmojiOffset<T>(run: () => Promise<T>): Promise<T> {
  const root = document.documentElement
  const hadInlineOverride = root.style.getPropertyValue('--emoji-offset-em')
  root.style.setProperty('--emoji-offset-em', '0')
  try {
    await waitForPaint()
    return await run()
  } finally {
    if (hadInlineOverride) {
      root.style.setProperty('--emoji-offset-em', hadInlineOverride)
    } else {
      root.style.removeProperty('--emoji-offset-em')
    }
    applyEmojiOffsetVariables()
    await waitForPaint()
  }
}

function resolvePrimaryEmojiFontFamily(fontFamily: string): string {
  return fontFamily.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') ?? fontFamily
}

async function loadEmojiGlyphFont(fontSizePx: number, fontFamily: string, emoji: string): Promise<void> {
  const primaryFamily = resolvePrimaryEmojiFontFamily(fontFamily)
  try { await document.fonts.load(`${fontSizePx}px "${primaryFamily}"`, emoji) } catch {}
  try { await document.fonts.load(`${fontSizePx}px ${primaryFamily}`, emoji) } catch {}
}

async function ensureEmojiFontLoaded(fontSizePx: number, fontFamily: string, emoji: string): Promise<void> {
  await loadEmojiGlyphFont(fontSizePx, fontFamily, emoji)
  const primaryFamily = resolvePrimaryEmojiFontFamily(fontFamily)
  if (document.fonts.check(`${fontSizePx}px "${primaryFamily}"`, emoji)) return
  await document.fonts.ready
}

export async function ensureEmojiPreviewFontsLoaded(emojis: readonly string[], fontFamily: string, tileSizePx = 72): Promise<void> {
  const fontSizePx = tileSizePx * (50 / 72)
  for (const emoji of emojis) {
    await loadEmojiGlyphFont(fontSizePx, fontFamily, emoji)
  }
}

/**
 * Core measurement logic:
 * 1. Uses DOM to find the exact baseline position for line-height: 1.
 * 2. Uses Canvas to find the exact ink bounding box relative to the baseline.
 * 3. Calculates offset to center the ink within the font-size box.
 */
async function measureEmojiLayout(layout: MeasureEmojiLayout): Promise<number | undefined> {
  await ensureEmojiFontLoaded(layout.fontSizePx, layout.fontFamily, layout.emoji)

  // 1. Find DOM baseline
  // We create a hidden element identical to the icon tile's text container to see exactly
  // where the browser's layout engine places the baseline.
  const container = document.createElement('div')
  container.style.cssText = `
    position: fixed; left: -9999px; top: 0;
    font-family: ${layout.fontFamily};
    font-size: ${layout.fontSizePx}px;
    line-height: 1;
  `
  const baselineMarker = document.createElement('span')
  baselineMarker.style.cssText = 'display: inline-block; width: 0; height: 0; line-height: 0; font-size: 0; vertical-align: baseline;'
  container.appendChild(document.createTextNode(layout.emoji))
  container.appendChild(baselineMarker)
  document.body.appendChild(container)

  await waitForPaint()

  const containerRect = container.getBoundingClientRect()
  const markerRect = baselineMarker.getBoundingClientRect()
  const baselineY = markerRect.top - containerRect.top
  container.remove()

  // 2. Find ink bounding box
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return undefined

  ctx.font = `${layout.fontSizePx}px ${layout.fontFamily}`
  const metrics = ctx.measureText(layout.emoji)

  let inkAscent = metrics.actualBoundingBoxAscent
  let inkDescent = metrics.actualBoundingBoxDescent

  // 3. Fallback to pixel scan if TextMetrics is missing or zero
  if (!Number.isFinite(inkAscent) || !Number.isFinite(inkDescent) || (inkAscent === 0 && inkDescent === 0)) {
    const size = Math.ceil(layout.fontSizePx * 2)
    canvas.width = size
    canvas.height = size
    ctx.font = `${layout.fontSizePx}px ${layout.fontFamily}`
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'center'

    const canvasBaselineY = size / 2
    ctx.fillText(layout.emoji, size / 2, canvasBaselineY)

    const imageData = ctx.getImageData(0, 0, size, size)
    const data = imageData.data
    let minY = size, maxY = 0, hasPixels = false

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (data[(y * size + x) * 4 + 3] > 10) {
          if (y < minY) minY = y
          if (y > maxY) maxY = y
          hasPixels = true
        }
      }
    }

    if (!hasPixels) return undefined
    inkAscent = canvasBaselineY - minY
    inkDescent = maxY - canvasBaselineY
  }

  // 4. Calculate offset
  const inkTop = baselineY - inkAscent
  const inkBottom = baselineY + inkDescent
  const inkCenterY = (inkTop + inkBottom) / 2
  const boxCenterY = layout.fontSizePx / 2
  const deltaPx = boxCenterY - inkCenterY

  return deltaPx / layout.fontSizePx
}

function readIconTileLayout(tile: HTMLElement): MeasureEmojiLayout | undefined {
  const glyph = tile.querySelector<HTMLElement>('.app-icon-tile__emoji')
  if (!glyph) return undefined
  const emoji = glyph.textContent?.trim()
  if (!emoji) return undefined

  const glyphStyle = window.getComputedStyle(glyph)
  const fontSizePx = Number.parseFloat(glyphStyle.fontSize)
  const tileRect = tile.getBoundingClientRect()
  const boxSizePx = tileRect.height

  if (!Number.isFinite(fontSizePx) || fontSizePx <= 0 || boxSizePx <= 0) return undefined

  return { emoji, fontFamily: glyphStyle.fontFamily, fontSizePx, boxSizePx }
}

type SequentialMeasureOptions = {
  onProgress?: (progress: EmojiCalibrationProgress) => void
  appearDelayMs?: number
  measureDelayMs?: number
  resolveTileElement?: (index: number) => HTMLElement | undefined
}

async function measureIconEmojiOffsetSequentially(
  emojis: readonly string[],
  fontFamily: string,
  tileSizePx: number,
  tileElements: readonly HTMLElement[] | undefined,
  options?: SequentialMeasureOptions,
): Promise<number | undefined> {
  const fontSizePx = tileSizePx * (50 / 72)
  const appearDelayMs = options?.appearDelayMs ?? 380
  const measureDelayMs = options?.measureDelayMs ?? 520
  const samples: number[] = []

  for (let index = 0; index < emojis.length; index += 1) {
    const emoji = emojis[index]!
    const tileElement = options?.resolveTileElement?.(index) ?? tileElements?.[index]

    options?.onProgress?.({ index, emoji, phase: 'appear' })
    await delay(appearDelayMs)

    options?.onProgress?.({ index, emoji, phase: 'measure' })
    await waitForPaint()

    const layout = tileElement ? (readIconTileLayout(tileElement) ?? { emoji, fontFamily, fontSizePx, boxSizePx: tileSizePx }) : { emoji, fontFamily, fontSizePx, boxSizePx: tileSizePx }
    const offsetEm = await measureEmojiLayout(layout)

    if (offsetEm !== undefined) {
      samples.push(offsetEm)
      options?.onProgress?.({ index, emoji, phase: 'done', offsetEm })
    } else {
      options?.onProgress?.({ index, emoji, phase: 'failed' })
    }

    await delay(measureDelayMs)
  }

  return median(samples)
}

export async function measureIconEmojiOffsetEm(emojis: readonly string[], fontFamily: string, tileSizePx = 72): Promise<number | undefined> {
  const fontSizePx = tileSizePx * (50 / 72)
  return withZeroEmojiOffset(async () => {
    const samples: number[] = []
    for (const emoji of emojis) {
      const offsetEm = await measureEmojiLayout({ emoji, fontFamily, fontSizePx, boxSizePx: tileSizePx })
      if (offsetEm !== undefined) samples.push(offsetEm)
    }
    return median(samples)
  })
}

export async function measureIconEmojiOffsetWithCalibrationProgress(
  emojis: readonly string[],
  fontFamily: string,
  tileSizePx: number,
  tileElements: readonly HTMLElement[] | undefined,
  options?: SequentialMeasureOptions,
): Promise<number | undefined> {
  return withZeroEmojiOffset(async () =>
    measureIconEmojiOffsetSequentially(emojis, fontFamily, tileSizePx, tileElements, options),
  )
}

export async function measureTextEmojiOffsetEm(emojis: readonly string[], fontFamily: string, previewFontSizePx = 28, cellSizePx = 40): Promise<number | undefined> {
  return withZeroEmojiOffset(async () => {
    const samples: number[] = []
    for (const emoji of emojis) {
      const offsetEm = await measureEmojiLayout({ emoji, fontFamily, fontSizePx: previewFontSizePx, boxSizePx: cellSizePx })
      if (offsetEm !== undefined) samples.push(offsetEm)
    }
    return median(samples)
  })
}

export async function measureIconEmojiOffsetFromPreviewNodes(tileElements: readonly HTMLElement[]): Promise<number | undefined> {
  return withZeroEmojiOffset(async () => {
    const samples: number[] = []
    for (const tile of tileElements) {
      const layout = readIconTileLayout(tile)
      if (!layout) continue
      const offsetEm = await measureEmojiLayout(layout)
      if (offsetEm !== undefined) samples.push(offsetEm)
    }
    return median(samples)
  })
}

export async function measureTextEmojiOffsetFromPreviewNodes(glyphElements: readonly HTMLElement[]): Promise<number | undefined> {
  return withZeroEmojiOffset(async () => {
    const samples: number[] = []
    for (const glyph of glyphElements) {
      const emoji = glyph.textContent?.trim()
      if (!emoji) continue
      const glyphStyle = window.getComputedStyle(glyph)
      const fontSizePx = Number.parseFloat(glyphStyle.fontSize)
      if (!Number.isFinite(fontSizePx) || fontSizePx <= 0) continue
      const line = glyph.closest('.settings__emoji-mixed-line') as HTMLElement | undefined
      const boxSizePx = line?.getBoundingClientRect().height ?? fontSizePx * 1.35
      const offsetEm = await measureEmojiLayout({ emoji, fontFamily: glyphStyle.fontFamily, fontSizePx, boxSizePx: Math.max(boxSizePx, fontSizePx) })
      if (offsetEm !== undefined) samples.push(offsetEm)
    }
    return median(samples)
  })
}

export function resolveActiveEmojiFontFamily(): string {
  const mode = document.documentElement.dataset.emojiFontMode
  if (mode === 'off') return "'Segoe UI Emoji', 'Noto Color Emoji', sans-serif"
  return "'Apple Color Emoji', sans-serif"
}
