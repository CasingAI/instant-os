import type { AppCapabilityTag } from '../appstore/app-capability-tags.ts'
import type { GeneratedAppDataStore } from '../../os/generated-app-data-storage.ts'
import type { GeneratedAppId } from '../../os/types.ts'

export type ICodeProjectKind = 'internal' | 'formal'

export type ICodeChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

export const ICODE_CONSOLE_MESSAGE_TYPE = 'instant-os-icode-console' as const

export type ICodeConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

export type ICodeConsoleMessage = {
  type: typeof ICODE_CONSOLE_MESSAGE_TYPE
  appId: GeneratedAppId
  level: ICodeConsoleLevel
  text: string
  timestamp: number
}

export type ICodeConsoleEntry = {
  id: string
  level: ICodeConsoleLevel
  text: string
  timestamp: number
}

export type ICodeInternalProject = {
  id: string
  name: string
  description: string
  category: string
  iconEmoji: string
  themeColor: string
  tags: AppCapabilityTag[]
  html: string
  appData: GeneratedAppDataStore
  chat: ICodeChatMessage[]
  /** 关联的正式应用 ID：从正式应用导入或发布成功后写入，用于下次发布时更新 */
  linkedAppId?: GeneratedAppId
  createdAt: number
  updatedAt: number
}

export type ICodeFormalProjectRef = {
  kind: 'formal'
  appId: GeneratedAppId
}

export type ICodeInternalProjectRef = {
  kind: 'internal'
  projectId: string
}

export type ICodeOpenProject = ICodeFormalProjectRef | ICodeInternalProjectRef

export const ICODE_BUNDLE_FORMAT = 'instant-os-icode-bundle' as const
export const ICODE_BUNDLE_VERSION = 1 as const

export type ICodeExportBundle = {
  format: typeof ICODE_BUNDLE_FORMAT
  version: typeof ICODE_BUNDLE_VERSION
  kind: ICodeProjectKind
  exportedAt: number
  project: ICodeInternalProject | {
    appId: GeneratedAppId
    name: string
    description: string
    category: string
    iconEmoji: string
    themeColor: string
    tags?: AppCapabilityTag[]
    html: string
    version?: string
  }
  appData: GeneratedAppDataStore
}
