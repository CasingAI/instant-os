import type { TokenUsageSnapshot } from '../apps/browser/browser-token-usage.ts'

export type AiEventLogMessageRole = 'system' | 'user' | 'assistant' | 'tool'

export type AiEventLogMessage = {
  role: AiEventLogMessageRole
  content: string
}

export type AiEventLogRecord = {
  id: string
  day: string
  /** 系统虚拟时钟（可被「日期与时间」设置偏移）。 */
  at: number
  /** 真实墙钟毫秒；旧记录可能缺失。 */
  realAt: number | undefined
  actor: string
  behavior: string
  actorLabel: string
  behaviorLabel: string
  model: string | undefined
  /** 本次请求是否启用思考；旧记录可能缺失。 */
  thinkingEnabled: boolean | undefined
  messages: AiEventLogMessage[]
  response: string
  promptTokens: number | undefined
  completionTokens: number | undefined
  totalTokens: number | undefined
  status: 'success' | 'aborted' | 'error'
  errorMessage: string | undefined
}

export type AiEventLogInput = {
  model?: string
  thinkingEnabled?: boolean
  messages: AiEventLogMessage[]
  response: string
  usage?: TokenUsageSnapshot
  status?: AiEventLogRecord['status']
  errorMessage?: string
}
