import type { ExtAppId } from './types.ts'
import { rewriteCssFontUrls } from './rewrite-css-font-urls.ts'

export { rewriteCssFontUrls }

export const EXT_APP_BOOTSTRAP_MESSAGE_TYPE = 'instant-os-ext-app-bootstrap' as const
export const EXT_APP_BOOTSTRAP_REQUEST_MESSAGE_TYPE = 'instant-os-ext-app-bootstrap-request' as const
export const EXT_APP_EMOJI_UPDATE_MESSAGE_TYPE = 'instant-os-ext-app-emoji-update' as const

export type ExtAppEmojiCss = {
  fontFacesCss: string
  fontsCss: string
}

export type ExtAppBootstrapStorage = {
  data: Record<string, string>
  usedBytes: number
  limitBytes: number
}

export type ExtAppBootstrapMessage = {
  type: typeof EXT_APP_BOOTSTRAP_MESSAGE_TYPE
  appId: ExtAppId
  windowId: string
  hostOrigin: string
  storage: ExtAppBootstrapStorage
  emoji: ExtAppEmojiCss
}

export type ExtAppBootstrapRequestMessage = {
  type: typeof EXT_APP_BOOTSTRAP_REQUEST_MESSAGE_TYPE
  appId: ExtAppId
}

export type ExtAppEmojiUpdateMessage = {
  type: typeof EXT_APP_EMOJI_UPDATE_MESSAGE_TYPE
  appId: ExtAppId
  fontFacesCss: string
  fontsCss: string
}

export function isExtAppBootstrapRequestMessage(
  data: unknown,
): data is ExtAppBootstrapRequestMessage {
  if (!data || typeof data !== 'object') {
    return false
  }
  const message = data as Partial<ExtAppBootstrapRequestMessage>
  return (
    message.type === EXT_APP_BOOTSTRAP_REQUEST_MESSAGE_TYPE &&
    typeof message.appId === 'string' &&
    message.appId.startsWith('ext:') &&
    message.appId.length > 4
  )
}

export function extAppWebViewOwnerId(windowId: string): string {
  return `ext-window:${windowId}`
}
