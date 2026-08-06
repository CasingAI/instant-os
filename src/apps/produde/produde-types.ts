import type {
  VscodeAiInvestigation,
  VscodeAiTimelineItem,
} from '../vscode/vscode-ai-agent.ts'

/** ProDude 默认工作区：用户目录 */
export const PRODUDE_DEFAULT_WORKSPACE = '/user'

export type ProdudeRole = 'user' | 'assistant'

export type ProdudeMessage = {
  id: string
  role: ProdudeRole
  content: string
  createdAt: number
  isError?: boolean
  /** 助手消息调查时间线（与 VS Code AI 一致） */
  investigation?: VscodeAiInvestigation
}

export type ProdudeSession = {
  id: string
  title: string
  emoji: string
  messages: ProdudeMessage[]
  /** 工作区 VFS 绝对路径；缺省为用户目录 */
  workspaceFolder: string
  /** 模型选择：capability 或 custom key */
  modelSource: 'text' | 'text-secondary' | 'custom'
  modelKey?: string
  createdAt: number
  updatedAt: number
}

export type ProdudeStore = {
  sessions: ProdudeSession[]
  activeSessionId?: string
}

export type ProdudeLiveProgress = {
  timeline: VscodeAiTimelineItem[]
  answerText: string
}
