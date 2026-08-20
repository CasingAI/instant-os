import type { BridgeAppId } from '../../os/types.ts'

export const GENERATED_APP_RUNTIME_ERROR_MESSAGE_TYPE = 'instant-os-generated-app-runtime-error' as const

export type GeneratedAppRuntimeErrorKind = 'error' | 'unhandledrejection'

export type GeneratedAppRuntimeErrorMessage = {
  type: typeof GENERATED_APP_RUNTIME_ERROR_MESSAGE_TYPE
  appId: BridgeAppId
  kind: GeneratedAppRuntimeErrorKind
  text: string
  timestamp: number
}

export type GeneratedAppRuntimeErrorEntry = {
  id: string
  kind: GeneratedAppRuntimeErrorKind
  text: string
  timestamp: number
}

export const GENERATED_APP_RUNTIME_ERROR_MAX_ENTRIES = 500
