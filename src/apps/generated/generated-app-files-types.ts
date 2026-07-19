import type { ExtAppId, GeneratedAppId } from '../../os/types.ts'
import type { FilesApiEntry, FilesApiVolume } from '../files/files-api.ts'

export type BridgeAppId = GeneratedAppId | ExtAppId

export const GENERATED_APP_FILES_REQUEST_MESSAGE_TYPE = 'instant-generated-app-files-request' as const
export const GENERATED_APP_FILES_RESPONSE_MESSAGE_TYPE = 'instant-generated-app-files-response' as const

/** 第三方/生成应用可调用的文件操作 */
export type GeneratedAppFilesOp =
  | 'listVolumes'
  | 'list'
  | 'stat'
  | 'readText'
  | 'writeText'
  | 'mkdir'
  | 'createText'
  | 'rename'
  | 'remove'

export type GeneratedAppFilesRequestMessage = {
  type: typeof GENERATED_APP_FILES_REQUEST_MESSAGE_TYPE
  appId: BridgeAppId
  requestId: string
  op: GeneratedAppFilesOp
  path?: string
  text?: string
  nextName?: string
}

export type GeneratedAppFilesResult =
  | FilesApiVolume[]
  | FilesApiEntry[]
  | FilesApiEntry
  | string
  | undefined
  | null

export type GeneratedAppFilesResponseMessage = {
  type: typeof GENERATED_APP_FILES_RESPONSE_MESSAGE_TYPE
  appId: BridgeAppId
  requestId: string
  ok: boolean
  result?: GeneratedAppFilesResult
  error?: string
}

const FILES_OPS = new Set<string>([
  'listVolumes',
  'list',
  'stat',
  'readText',
  'writeText',
  'mkdir',
  'createText',
  'rename',
  'remove',
])

export function isGeneratedAppFilesRequestMessage(
  data: unknown,
): data is GeneratedAppFilesRequestMessage {
  if (!data || typeof data !== 'object') {
    return false
  }

  const message = data as GeneratedAppFilesRequestMessage
  return (
    message.type === GENERATED_APP_FILES_REQUEST_MESSAGE_TYPE &&
    typeof message.appId === 'string' &&
    typeof message.requestId === 'string' &&
    typeof message.op === 'string' &&
    FILES_OPS.has(message.op)
  )
}
