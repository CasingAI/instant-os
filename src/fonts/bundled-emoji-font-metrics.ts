const BUNDLED_EMOJI_FONT_FACE_METRICS = `ascent-override: 100%;
  descent-override: 0%;
  line-gap-override: 0%;`

const BUNDLED_EMOJI_LAYOUT_METRIC_SELECTORS = [
  '.generated-app-icon__emoji',
  '.app-icon-tile__emoji',
  '.settings__emoji-preview-glyph',
  '.catgpt-app__session-emoji',
  '.weather-app__hero-emoji',
  '.weather-app__hourly-emoji',
  '.weather-app__city-chip-emoji',
  '.notification-center__weather-emoji',
].join(',\n')

/** Patch @font-face blocks so bundled TTF glyphs align with surrounding text metrics. */
export function appendBundledEmojiFontFaceMetrics(css: string): string {
  return css.replace(
    /@font-face\s*\{/g,
    `@font-face {\n  ${BUNDLED_EMOJI_FONT_FACE_METRICS}`,
  )
}

export function buildBundledEmojiLayoutMetricsCss(scopeSelector?: string): string {
  const selector = scopeSelector
    ? `${scopeSelector} ${BUNDLED_EMOJI_LAYOUT_METRIC_SELECTORS.split(',\n').join(`,\n${scopeSelector} `)}`
    : BUNDLED_EMOJI_LAYOUT_METRIC_SELECTORS

  return `/* Web-bundled emoji on non-Apple platforms: fine-tune flex/grid centered glyphs. */
${selector} {
  transform: translateY(-0.02em);
}`
}
