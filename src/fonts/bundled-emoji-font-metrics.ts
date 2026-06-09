export const EMOJI_OFFSET_SELECTORS = [
  '.generated-app-icon__emoji',
  '.app-icon-tile__emoji',
  '.settings__emoji-preview-glyph',
  '.catgpt-app__session-emoji',
  '.weather-app__hero-emoji',
  '.weather-app__hourly-emoji',
  '.weather-app__city-chip-emoji',
  '.notification-center__weather-emoji',
].join(',\n')

const BUNDLED_EMOJI_FONT_FACE_METRICS = `ascent-override: 100%;
  descent-override: 0%;
  line-gap-override: 0%;`

/** Patch @font-face blocks so bundled TTF glyphs align with surrounding text metrics. */
export function appendBundledEmojiFontFaceMetrics(css: string): string {
  return css.replace(
    /@font-face\s*\{/g,
    `@font-face {\n  ${BUNDLED_EMOJI_FONT_FACE_METRICS}`,
  )
}

export function buildBundledEmojiLayoutMetricsCss(scopeSelector?: string): string {
  const selector = scopeSelector
    ? `${scopeSelector} ${EMOJI_OFFSET_SELECTORS.split(',\n').join(`,\n${scopeSelector} `)}`
    : EMOJI_OFFSET_SELECTORS

  return `/* Emoji vertical offset from display settings (em × font-size). */
${selector} {
  transform: translateY(calc(var(--emoji-offset-em, 0) * 1em));
}`
}
