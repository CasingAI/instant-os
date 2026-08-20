import {
  buildIframeEmojiFontBodyInjection,
  buildIframeEmojiFontHeadInjection,
} from '../fonts/inject-iframe-emoji-fonts.ts'
import {
  EXT_APP_BOOTSTRAP_MESSAGE_TYPE,
  EXT_APP_EMOJI_UPDATE_MESSAGE_TYPE,
  rewriteCssFontUrls,
  type ExtAppBootstrapMessage,
  type ExtAppBootstrapStorage,
  type ExtAppEmojiCss,
  type ExtAppEmojiUpdateMessage,
} from './ext-app-bootstrap-messages.ts'
import { type ExtAppId } from './types.ts'

export {
  EXT_APP_BOOTSTRAP_MESSAGE_TYPE,
  EXT_APP_BOOTSTRAP_REQUEST_MESSAGE_TYPE,
  EXT_APP_EMOJI_UPDATE_MESSAGE_TYPE,
  extAppWebViewOwnerId,
  isExtAppBootstrapRequestMessage,
  rewriteCssFontUrls,
  type ExtAppBootstrapMessage,
  type ExtAppBootstrapRequestMessage,
  type ExtAppBootstrapStorage,
  type ExtAppEmojiCss,
  type ExtAppEmojiUpdateMessage,
} from './ext-app-bootstrap-messages.ts'

function extractStyleInner(markup: string): string {
  const trimmed = markup.trim()
  if (!trimmed) {
    return ''
  }
  const match = /<style[^>]*>([\s\S]*)<\/style>/i.exec(trimmed)
  return match?.[1]?.trim() ?? trimmed
}

export function buildExtAppEmojiCss(hostOrigin: string): ExtAppEmojiCss {
  return {
    fontFacesCss: rewriteCssFontUrls(extractStyleInner(buildIframeEmojiFontHeadInjection()), hostOrigin),
    fontsCss: extractStyleInner(buildIframeEmojiFontBodyInjection()),
  }
}

export function resolveExtAppHostOrigin(): string {
  return window.location.origin
}

export function buildExtAppBootstrapMessage(input: {
  appId: ExtAppId
  windowId: string
  storage: ExtAppBootstrapStorage
}): ExtAppBootstrapMessage {
  const hostOrigin = resolveExtAppHostOrigin()
  return {
    type: EXT_APP_BOOTSTRAP_MESSAGE_TYPE,
    appId: input.appId,
    windowId: input.windowId,
    hostOrigin,
    storage: input.storage,
    emoji: buildExtAppEmojiCss(hostOrigin),
  }
}

export function buildExtAppEmojiUpdateMessage(appId: ExtAppId): ExtAppEmojiUpdateMessage {
  const emoji = buildExtAppEmojiCss(resolveExtAppHostOrigin())
  return {
    type: EXT_APP_EMOJI_UPDATE_MESSAGE_TYPE,
    appId,
    fontFacesCss: emoji.fontFacesCss,
    fontsCss: emoji.fontsCss,
  }
}
