import { applyEmojiOffsetVariables } from './emoji-offset.ts'

const ALPHA_THRESHOLD = 40

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
  if (values.length === 0) {
    return undefined
  }

  const sorted = [...values].sort((left, right) => left - right)
  const mid = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2
  }

  return sorted[mid]
}

function shouldUseInkCentroidMeasurement(): boolean {
  return document.documentElement.dataset.emojiFontBundled === 'true'
}

async function waitForPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

/** Measure with zero offset applied so prior user adjustments do not skew results. */
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

function computeVerticalOffsetEmFromImageData(
  imageData: ImageData,
  fontSizePx: number,
  devicePixelRatio: number,
): number | undefined {
  const { data, width, height } = imageData
  let weightedY = 0
  let totalWeight = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const alpha = data[index + 3] ?? 0
      if (alpha <= ALPHA_THRESHOLD) {
        continue
      }

      weightedY += y * alpha
      totalWeight += alpha
    }
  }

  if (totalWeight === 0) {
    return undefined
  }

  const centroidY = weightedY / totalWeight
  const centerY = height / 2
  const deltaPx = centerY - centroidY

  return deltaPx / (fontSizePx * devicePixelRatio)
}

function inlineElementStyles(source: Element, target: Element): void {
  if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement)) {
    return
  }

  const computed = window.getComputedStyle(source)
  const properties = [
    'display',
    'align-items',
    'justify-content',
    'flex-direction',
    'width',
    'height',
    'font-family',
    'font-size',
    'line-height',
    'box-sizing',
    'overflow',
    'border-radius',
    'background',
    'color',
    'text-align',
  ]

  for (const property of properties) {
    target.style.setProperty(property, computed.getPropertyValue(property))
  }

  target.style.setProperty('transform', 'none')
  target.style.setProperty('margin', '0')

  const sourceChildren = Array.from(source.children)
  const targetChildren = Array.from(target.children)
  for (let index = 0; index < sourceChildren.length; index += 1) {
    const sourceChild = sourceChildren[index]
    const targetChild = targetChildren[index]
    if (sourceChild && targetChild) {
      inlineElementStyles(sourceChild, targetChild)
    }
  }
}

async function rasterizeElementWithInlineStyles(element: HTMLElement): Promise<ImageData | undefined> {
  const rect = element.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  const devicePixelRatio = window.devicePixelRatio || 1
  const pixelWidth = Math.max(1, Math.round(width * devicePixelRatio))
  const pixelHeight = Math.max(1, Math.round(height * devicePixelRatio))

  const clone = element.cloneNode(true) as HTMLElement
  inlineElementStyles(element, clone)

  const xhtmlNamespace = 'http://www.w3.org/1999/xhtml'
  const markup = new XMLSerializer().serializeToString(clone)
  const svgMarkup = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${pixelWidth}" height="${pixelHeight}">
  <foreignObject width="100%" height="100%">
    <div xmlns="${xhtmlNamespace}" style="width:${width}px;height:${height}px;margin:0;padding:0;overflow:hidden">
      ${markup}
    </div>
  </foreignObject>
</svg>`

  const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' })
  const objectUrl = URL.createObjectURL(blob)

  try {
    const image = new Image()
    image.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('emoji rasterize failed'))
      image.src = objectUrl
    })

    const canvas = document.createElement('canvas')
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      return undefined
    }

    context.drawImage(image, 0, 0, pixelWidth, pixelHeight)
    return context.getImageData(0, 0, pixelWidth, pixelHeight)
  } catch {
    return undefined
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function ensureEmojiFontLoaded(fontSizePx: number, fontFamily: string): Promise<void> {
  const primaryFamily = fontFamily.split(',')[0]?.trim() ?? fontFamily
  try {
    await document.fonts.load(`${fontSizePx}px ${primaryFamily}`)
  } catch {
    // Some browsers reject complex stacks; rely on document.fonts.ready below.
  }
  await document.fonts.ready
}

/** Preload preview glyphs at icon-tile size so measurement uses real font faces. */
export async function ensureEmojiPreviewFontsLoaded(
  emojis: readonly string[],
  fontFamily: string,
  tileSizePx = 72,
): Promise<void> {
  const fontSizePx = tileSizePx * (50 / 72)
  const primaryFamily = fontFamily.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') ?? fontFamily

  for (const emoji of emojis) {
    try {
      await document.fonts.load(`${fontSizePx}px "${primaryFamily}"`, emoji)
    } catch {
      // Continue with other glyphs.
    }

    try {
      await document.fonts.load(`${fontSizePx}px ${primaryFamily}`, emoji)
    } catch {
      // Continue with other glyphs.
    }
  }

  await document.fonts.ready
}

function createFlexHarness(layout: MeasureEmojiLayout): HTMLElement {
  const harness = document.createElement('div')
  harness.className = 'measure-emoji-harness'
  harness.style.cssText = [
    `width:${layout.boxSizePx}px`,
    `height:${layout.boxSizePx}px`,
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'position:fixed',
    'left:-9999px',
    'top:0',
    'visibility:hidden',
    'pointer-events:none',
  ].join(';')

  const glyph = document.createElement('span')
  glyph.className = 'measure-emoji-glyph'
  glyph.textContent = layout.emoji
  glyph.style.fontFamily = layout.fontFamily
  glyph.style.fontSize = `${layout.fontSizePx}px`
  glyph.style.lineHeight = '1'
  glyph.style.display = 'block'
  glyph.style.transform = 'none'
  harness.appendChild(glyph)

  return harness
}

/** Flex-centered layout box vs container — matches system emoji on Apple platforms. */
async function measureEmojiOffsetFromFlexHarnessLayoutBox(
  layout: MeasureEmojiLayout,
): Promise<number | undefined> {
  const harness = createFlexHarness(layout)
  document.body.appendChild(harness)

  try {
    await waitForPaint()
    const glyph = harness.querySelector('.measure-emoji-glyph')
    if (!(glyph instanceof HTMLElement)) {
      return undefined
    }

    const harnessRect = harness.getBoundingClientRect()
    const glyphRect = glyph.getBoundingClientRect()
    const containerCenterY = harnessRect.top + harnessRect.height / 2
    const glyphCenterY = glyphRect.top + glyphRect.height / 2
    const deltaPx = containerCenterY - glyphCenterY

    return deltaPx / layout.fontSizePx
  } finally {
    harness.remove()
  }
}

/** Ink centroid from flex harness rasterization — for bundled emoji with metric overrides. */
async function measureEmojiOffsetFromFlexHarnessRasterize(
  layout: MeasureEmojiLayout,
): Promise<number | undefined> {
  const harness = createFlexHarness(layout)
  document.body.appendChild(harness)

  try {
    await waitForPaint()
    const imageData = await rasterizeElementWithInlineStyles(harness)
    if (!imageData) {
      return undefined
    }

    return computeVerticalOffsetEmFromImageData(
      imageData,
      layout.fontSizePx,
      window.devicePixelRatio || 1,
    )
  } finally {
    harness.remove()
  }
}

function measureEmojiOffsetFromLiveTile(tile: HTMLElement): number | undefined {
  const glyph = tile.querySelector<HTMLElement>('.app-icon-tile__emoji')
  if (!glyph) {
    return undefined
  }

  const fontSizePx = Number.parseFloat(window.getComputedStyle(glyph).fontSize)
  if (!Number.isFinite(fontSizePx) || fontSizePx <= 0) {
    return undefined
  }

  const tileRect = tile.getBoundingClientRect()
  const glyphRect = glyph.getBoundingClientRect()
  const containerCenterY = tileRect.top + tileRect.height / 2
  const glyphCenterY = glyphRect.top + glyphRect.height / 2
  const deltaPx = containerCenterY - glyphCenterY

  return deltaPx / fontSizePx
}

/**
 * Draw emoji on canvas — last-resort fallback when DOM methods fail.
 * Canvas baseline placement does not match flex centering; avoid on Apple platforms.
 */
async function measureEmojiOffsetWithCanvasDraw(layout: MeasureEmojiLayout): Promise<number | undefined> {
  const { emoji, fontFamily, fontSizePx, boxSizePx } = layout
  if (!emoji.trim()) {
    return undefined
  }

  await ensureEmojiFontLoaded(fontSizePx, fontFamily)

  const devicePixelRatio = window.devicePixelRatio || 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(boxSizePx * devicePixelRatio))
  canvas.height = Math.max(1, Math.round(boxSizePx * devicePixelRatio))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    return undefined
  }

  context.scale(devicePixelRatio, devicePixelRatio)
  context.clearRect(0, 0, boxSizePx, boxSizePx)
  context.font = `${fontSizePx}px ${fontFamily}`
  context.textBaseline = 'alphabetic'
  context.textAlign = 'center'

  const metrics = context.measureText(emoji)
  const ascent = metrics.actualBoundingBoxAscent || metrics.fontBoundingBoxAscent || fontSizePx * 0.85
  const descent = metrics.actualBoundingBoxDescent || metrics.fontBoundingBoxDescent || fontSizePx * 0.15
  const lineBoxHeight = fontSizePx
  const lineBoxTop = (boxSizePx - lineBoxHeight) / 2
  const fontAscent = metrics.fontBoundingBoxAscent || ascent
  const baselineY = lineBoxTop + fontAscent

  context.fillText(emoji, boxSizePx / 2, baselineY)

  let imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  let offsetEm = computeVerticalOffsetEmFromImageData(imageData, fontSizePx, devicePixelRatio)

  if (offsetEm !== undefined) {
    return offsetEm
  }

  const baselineCandidates = [
    lineBoxTop + fontAscent,
    lineBoxTop + ascent,
    boxSizePx / 2 + (descent - ascent) / 2,
    boxSizePx / 2,
  ]

  for (const candidateBaseline of baselineCandidates) {
    context.clearRect(0, 0, boxSizePx, boxSizePx)
    context.font = `${fontSizePx}px ${fontFamily}`
    context.textBaseline = 'alphabetic'
    context.textAlign = 'center'
    context.fillText(emoji, boxSizePx / 2, candidateBaseline)

    imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    offsetEm = computeVerticalOffsetEmFromImageData(imageData, fontSizePx, devicePixelRatio)
    if (offsetEm !== undefined) {
      return offsetEm
    }
  }

  return undefined
}

async function measureEmojiLayout(layout: MeasureEmojiLayout): Promise<number | undefined> {
  await ensureEmojiFontLoaded(layout.fontSizePx, layout.fontFamily)

  if (shouldUseInkCentroidMeasurement()) {
    const rasterOffset = await measureEmojiOffsetFromFlexHarnessRasterize(layout)
    if (rasterOffset !== undefined) {
      return rasterOffset
    }

    return measureEmojiOffsetWithCanvasDraw(layout)
  }

  const layoutBoxOffset = await measureEmojiOffsetFromFlexHarnessLayoutBox(layout)
  if (layoutBoxOffset !== undefined) {
    return layoutBoxOffset
  }

  const rasterOffset = await measureEmojiOffsetFromFlexHarnessRasterize(layout)
  if (rasterOffset !== undefined) {
    return rasterOffset
  }

  return measureEmojiOffsetWithCanvasDraw(layout)
}

function readIconTileLayout(tile: HTMLElement): MeasureEmojiLayout | undefined {
  const glyph = tile.querySelector<HTMLElement>('.app-icon-tile__emoji')
  if (!glyph) {
    return undefined
  }

  const emoji = glyph.textContent?.trim()
  if (!emoji) {
    return undefined
  }

  const glyphStyle = window.getComputedStyle(glyph)
  const fontSizePx = Number.parseFloat(glyphStyle.fontSize)
  const tileRect = tile.getBoundingClientRect()
  const boxSizePx = tileRect.height

  if (!Number.isFinite(fontSizePx) || fontSizePx <= 0 || boxSizePx <= 0) {
    return undefined
  }

  return {
    emoji,
    fontFamily: glyphStyle.fontFamily,
    fontSizePx,
    boxSizePx,
  }
}

async function measureSingleIconEmojiOffset(
  layout: MeasureEmojiLayout,
  tileElement?: HTMLElement,
): Promise<number | undefined> {
  if (tileElement && !shouldUseInkCentroidMeasurement()) {
    return measureEmojiOffsetFromLiveTile(tileElement)
  }

  if (tileElement) {
    const liveLayout = readIconTileLayout(tileElement)
    if (liveLayout) {
      return measureEmojiLayout(liveLayout)
    }
  }

  return measureEmojiLayout(layout)
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

    const layout: MeasureEmojiLayout = {
      emoji,
      fontFamily,
      fontSizePx,
      boxSizePx: tileSizePx,
    }

    const offsetEm = await measureSingleIconEmojiOffset(layout, tileElement)

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

/** Measure icon-tile emoji vertical offset (em) using loaded emoji fonts. */
export async function measureIconEmojiOffsetEm(
  emojis: readonly string[],
  fontFamily: string,
  tileSizePx = 72,
): Promise<number | undefined> {
  const fontSizePx = tileSizePx * (50 / 72)

  return withZeroEmojiOffset(async () => {
    const samples: number[] = []
    for (const emoji of emojis) {
      const offsetEm = await measureEmojiLayout({
        emoji,
        fontFamily,
        fontSizePx,
        boxSizePx: tileSizePx,
      })
      if (offsetEm !== undefined) {
        samples.push(offsetEm)
      }
    }
    return median(samples)
  })
}

/** Animated sequential measurement for calibration UI. */
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

/** Measure inline / preview emoji vertical offset (em) using loaded emoji fonts. */
export async function measureTextEmojiOffsetEm(
  emojis: readonly string[],
  fontFamily: string,
  previewFontSizePx = 28,
  cellSizePx = 40,
): Promise<number | undefined> {
  return withZeroEmojiOffset(async () => {
    const samples: number[] = []
    for (const emoji of emojis) {
      const offsetEm = await measureEmojiLayout({
        emoji,
        fontFamily,
        fontSizePx: previewFontSizePx,
        boxSizePx: cellSizePx,
      })
      if (offsetEm !== undefined) {
        samples.push(offsetEm)
      }
    }
    return median(samples)
  })
}

/**
 * Measure from live icon preview tiles (same font block as settings UI).
 * Uses computed font metrics from the preview DOM after zeroing the global offset.
 */
export async function measureIconEmojiOffsetFromPreviewNodes(
  tileElements: readonly HTMLElement[],
): Promise<number | undefined> {
  return withZeroEmojiOffset(async () => {
    const samples: number[] = []

    for (const tile of tileElements) {
      if (!shouldUseInkCentroidMeasurement()) {
        const layoutBoxOffset = measureEmojiOffsetFromLiveTile(tile)
        if (layoutBoxOffset !== undefined) {
          samples.push(layoutBoxOffset)
          continue
        }
      }

      const layout = readIconTileLayout(tile)
      if (!layout) {
        continue
      }

      const offsetEm = await measureEmojiLayout(layout)
      if (offsetEm !== undefined) {
        samples.push(offsetEm)
      }
    }

    return median(samples)
  })
}

/** @deprecated Text preview measurement uses the same layout recipe as icon tiles. */
export async function measureTextEmojiOffsetFromPreviewNodes(
  glyphElements: readonly HTMLElement[],
): Promise<number | undefined> {
  return withZeroEmojiOffset(async () => {
    const samples: number[] = []

    for (const glyph of glyphElements) {
      const emoji = glyph.textContent?.trim()
      if (!emoji) {
        continue
      }

      const glyphStyle = window.getComputedStyle(glyph)
      const fontSizePx = Number.parseFloat(glyphStyle.fontSize)
      if (!Number.isFinite(fontSizePx) || fontSizePx <= 0) {
        continue
      }

      const line = glyph.closest('.settings__emoji-mixed-line') as HTMLElement | undefined
      const boxSizePx = line?.getBoundingClientRect().height ?? fontSizePx * 1.35

      const offsetEm = await measureEmojiLayout({
        emoji,
        fontFamily: glyphStyle.fontFamily,
        fontSizePx,
        boxSizePx: Math.max(boxSizePx, fontSizePx),
      })
      if (offsetEm !== undefined) {
        samples.push(offsetEm)
      }
    }

    return median(samples)
  })
}

/** Resolve emoji font-family string for measurement based on current document mode. */
export function resolveActiveEmojiFontFamily(): string {
  const mode = document.documentElement.dataset.emojiFontMode
  if (mode === 'off') {
    return "'Segoe UI Emoji', 'Noto Color Emoji', sans-serif"
  }

  return "'Apple Color Emoji', sans-serif"
}
