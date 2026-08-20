export const EXT_APP_MANIFEST_FORMAT = 'instant-os-ext-app-manifest' as const
export const EXT_APP_MANIFEST_SCHEMA_VERSION = 1 as const

export const EXT_APP_ENTER_MESSAGE_TYPE = 'instant-os-ext-app-enter' as const

export const GENERATED_APP_AI_BASE_URL = 'https://instant-os.local/v1'
export const GENERATED_APP_AI_REQUEST_MESSAGE_TYPE = 'instant-generated-app-ai-request' as const
export const GENERATED_APP_AI_RESPONSE_MESSAGE_TYPE = 'instant-generated-app-ai-response' as const
export const GENERATED_APP_AI_STREAM_MESSAGE_TYPE = 'instant-generated-app-ai-stream' as const
export const GENERATED_APP_AI_STREAM_END_MESSAGE_TYPE = 'instant-generated-app-ai-stream-end' as const

export const GENERATED_APP_STORAGE_MESSAGE_TYPE = 'instant-os-app-storage' as const

export const GENERATED_APP_FILES_REQUEST_MESSAGE_TYPE = 'instant-generated-app-files-request' as const
export const GENERATED_APP_FILES_RESPONSE_MESSAGE_TYPE = 'instant-generated-app-files-response' as const

export const GENERATED_APP_TERMINAL_REQUEST_MESSAGE_TYPE =
  'instant-generated-app-terminal-request' as const
export const GENERATED_APP_TERMINAL_RESPONSE_MESSAGE_TYPE =
  'instant-generated-app-terminal-response' as const
export const GENERATED_APP_TERMINAL_EVENT_MESSAGE_TYPE =
  'instant-generated-app-terminal-event' as const

export type ExtAppManifest = {
  format: typeof EXT_APP_MANIFEST_FORMAT
  schemaVersion: typeof EXT_APP_MANIFEST_SCHEMA_VERSION
  id: string
  name: string
  description: string
  version: string
  entry: string
  icon: string
  splash: {
    light: string
    dark: string
  }
  themeColor: string
  tags: string[]
}

export type ExtAppEnterMessage = {
  type: typeof EXT_APP_ENTER_MESSAGE_TYPE
  manifest: ExtAppManifest
}

export function isExtAppEnterMessage(data: unknown): data is ExtAppEnterMessage {
  if (!data || typeof data !== 'object') {
    return false
  }

  const message = data as ExtAppEnterMessage
  return (
    message.type === EXT_APP_ENTER_MESSAGE_TYPE &&
    typeof message.manifest === 'object' &&
    message.manifest !== undefined &&
    message.manifest.format === EXT_APP_MANIFEST_FORMAT
  )
}
