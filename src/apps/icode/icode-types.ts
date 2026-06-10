import type { AppCapabilityTag } from '../appstore/app-capability-tags.ts'
import type { GeneratedAppDataStore } from '../../os/generated-app-data-storage.ts'
import type { GeneratedAppId } from '../../os/types.ts'

export type ICodeProjectKind = 'internal' | 'formal'

export type ICodeChatEditBlock = {
  search: string
  replace: string
}

export type ICodeChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  /** 助手消息：模型思考过程 */
  reasoningText?: string
  /** 助手消息：折叠区内的完整自然语言回复（主气泡默认只显示末段） */
  fullReply?: string
  /** 助手消息：原始输出（含 SEARCH/REPLACE 块） */
  outputText?: string
  /** 助手消息：成功应用的编辑块 */
  edits?: ICodeChatEditBlock[]
  appliedEdits?: number
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
  /** 创建时写入，对应桌面应用 ID，发布时同步 */
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
