import { loadDisplaySettings, type EmojiFontMode } from '../os/display-settings-storage.ts'
import { appendBundledEmojiFontFaceMetrics, buildBundledEmojiLayoutMetricsCss } from './bundled-emoji-font-metrics.ts'
import appleColorEmojiCss from './apple-color-emoji.css?raw'
import {
  shouldApplyBundledEmojiMetrics,
  shouldLoadBundledEmojiFonts,
} from './ensure-apple-color-emoji-fonts.ts'

const TEXT_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei'"

const MONO_FONT_STACK =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"

function emojiFontStackForMode(mode: EmojiFontMode): string {
  if (mode === 'off') {
    return "'Segoe UI Emoji', 'Noto Color Emoji'"
  }

  return "'Apple Color Emoji'"
}

function buildTextFontFamilyRule(emojiStack: string): string {
  return `${TEXT_FONT_STACK}, ${emojiStack}, sans-serif`
}

export function buildIframeEmojiFontHeadInjection(mode?: EmojiFontMode): string {
  const resolvedMode = mode ?? loadDisplaySettings().emojiFontMode
  const useBundled = shouldLoadBundledEmojiFonts(resolvedMode)
  if (!useBundled) {
    return ''
  }

  const useMetrics = shouldApplyBundledEmojiMetrics(resolvedMode)
  const fontFaces = useMetrics
    ? appendBundledEmojiFontFaceMetrics(appleColorEmojiCss)
    : appleColorEmojiCss

  return `<style id="instant-os-emoji-font-faces">
${fontFaces}
</style>`
}

export function buildIframeEmojiFontBodyInjection(mode?: EmojiFontMode): string {
  const resolvedMode = mode ?? loadDisplaySettings().emojiFontMode
  const emojiStack = emojiFontStackForMode(resolvedMode)
  const fontFamily = buildTextFontFamilyRule(emojiStack)
  const layoutMetrics = shouldApplyBundledEmojiMetrics(resolvedMode)
    ? `\n${buildBundledEmojiLayoutMetricsCss()}`
    : ''

  return `<style id="instant-os-emoji-fonts">
html,
body,
button,
input,
textarea,
select,
* {
  font-family: ${fontFamily} !important;
}
code,
pre,
kbd,
samp {
  font-family: ${MONO_FONT_STACK} !important;
}${layoutMetrics}
</style>`
}

function injectBeforeClosingTag(html: string, tagName: string, injection: string): string | undefined {
  const pattern = new RegExp(`<\\/${tagName}>`, 'i')
  if (!pattern.test(html)) {
    return undefined
  }

  return html.replace(pattern, `${injection}\n</${tagName}>`)
}

function injectInHead(html: string, injection: string): string {
  const beforeHeadClose = injectBeforeClosingTag(html, 'head', injection)
  if (beforeHeadClose) {
    return beforeHeadClose
  }

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${injection}`)
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, (match) => `${match}\n<head>${injection}</head>`)
  }

  return `<head>${injection}</head>\n${html}`
}

function injectAtDocumentEnd(html: string, injection: string): string {
  const beforeBodyClose = injectBeforeClosingTag(html, 'body', injection)
  if (beforeBodyClose) {
    return beforeBodyClose
  }

  const beforeHtmlClose = injectBeforeClosingTag(html, 'html', injection)
  if (beforeHtmlClose) {
    return beforeHtmlClose
  }

  return `${html}\n${injection}`
}

export function injectIframeEmojiFonts(html: string, mode?: EmojiFontMode): string {
  if (!html.trim()) {
    return html
  }

  const headInjection = buildIframeEmojiFontHeadInjection(mode)
  const bodyInjection = buildIframeEmojiFontBodyInjection(mode)

  let result = html
  if (headInjection) {
    result = injectInHead(result, headInjection)
  }

  return injectAtDocumentEnd(result, bodyInjection)
}
