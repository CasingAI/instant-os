import { loadDisplaySettings, type EmojiFontMode } from '../os/display-settings-storage.ts'
import appleColorEmojiCss from './apple-color-emoji.css?raw'
import { shouldLoadBundledEmojiFonts } from './ensure-apple-color-emoji-fonts.ts'

const TEXT_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei'"

function emojiFontStackForMode(mode: EmojiFontMode): string {
  if (mode === 'off') {
    return "'Segoe UI Emoji', 'Noto Color Emoji'"
  }

  return "'Apple Color Emoji'"
}

export function buildIframeEmojiFontInjection(mode?: EmojiFontMode): string {
  const resolvedMode = mode ?? loadDisplaySettings().emojiFontMode
  const useBundled = shouldLoadBundledEmojiFonts(resolvedMode)
  const emojiStack = emojiFontStackForMode(resolvedMode)
  const fontFaces = useBundled ? appleColorEmojiCss : ''

  return `<style id="instant-os-emoji-fonts">
${fontFaces}
html,
body {
  font-family: ${TEXT_FONT_STACK}, ${emojiStack}, sans-serif;
}
</style>`
}

export function injectIframeEmojiFonts(html: string, mode?: EmojiFontMode): string {
  if (!html.trim()) {
    return html
  }

  const injection = buildIframeEmojiFontInjection(mode)

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${injection}\n</head>`)
  }

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${injection}`)
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, (match) => `${match}\n<head>${injection}</head>`)
  }

  return `<head>${injection}</head>\n${html}`
}
