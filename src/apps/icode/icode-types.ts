import type { AppCapabilityTag } from '../appstore/app-capability-tags.ts'
import type { GeneratedAppDataStore } from '../../os/generated-app-data-storage.ts'
import type { GeneratedAppId } from '../../os/types.ts'
import type { VscodeAiInvestigation } from '../vscode/vscode-ai-agent.ts'

export type ICodeChatEditBlock = {
  search: string
  replace: string
}

export type ICodeChatCapabilityRequestStatus = 'pending' | 'granted' | 'dismissed'

/**
 * 旧引擎（SEARCH/REPLACE 时代）的聊天字段：历史原文只读保留，不再解析执行。
 */
export type ICodeChatCapabilityRequest = {
  tag: '3d' | 'ai' | 'files' | 'terminal'
  reason: string
  status: ICodeChatCapabilityRequestStatus
}

export type ICodeChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  /** 助手消息：模型思考过程 */
  reasoningText?: string
  /** ---- 旧引擎字段（历史原文只读保留，不再解析执行） ---- */
  fullReply?: string
  outputText?: string
  edits?: ICodeChatEditBlock[]
  appliedEdits?: number
  capabilityRequests?: ICodeChatCapabilityRequest[]
  /** ---- 三期 agent 时间线（活动工具调用卡片等） ---- */
  investigation?: VscodeAiInvestigation
  /** 本轮被用户停止 */
  stopped?: boolean
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

/** 旧「内部项目」（第一期迁移源；迁移完成后不再产生新数据） */
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
  linkedAppId?: GeneratedAppId
  createdAt: number
  updatedAt: number
}

export const ICODE_BUNDLE_FORMAT = 'instant-os-icode-bundle' as const
export const ICODE_BUNDLE_VERSION = 1 as const

/** 旧导出包格式（导入兼容：读入后转成版本布局包） */
export type ICodeExportBundle = {
  format: typeof ICODE_BUNDLE_FORMAT
  version: typeof ICODE_BUNDLE_VERSION
  kind: 'internal' | 'formal'
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

export const ICODE_PACKAGE_BUNDLE_FORMAT = 'instant-os-icode-package' as const
