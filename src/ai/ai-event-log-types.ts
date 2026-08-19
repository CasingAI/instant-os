import type { TokenUsageSnapshot } from '../apps/browser/browser-token-usage.ts'
import type { AiEventLogTimingInput } from './ai-event-log-timing.ts'

export type AiEventLogMessageRole = 'system' | 'user' | 'assistant' | 'tool'

export type AiEventLogMessage = {
  role: AiEventLogMessageRole
  content: string
}

export type AiEventLogStatus = 'running' | 'success' | 'aborted' | 'error'

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
  cachedPromptTokens: number | undefined
  totalTokens: number | undefined
  /** token 是否为估算值（流式进行中常见）；旧记录可能缺失。 */
  usageEstimated: boolean | undefined
  status: AiEventLogStatus
  errorMessage: string | undefined
  /** 请求开始（系统虚拟时钟）；旧记录可能缺失。 */
  startedAt: number | undefined
  /** 请求开始（真实墙钟）；旧记录可能缺失。 */
  startedRealAt: number | undefined
  /** 首个 token 到达（系统虚拟时钟）；旧记录或非流式可能缺失。 */
  firstTokenAt: number | undefined
  /** 首个 token 到达（真实墙钟）；旧记录或非流式可能缺失。 */
  firstTokenRealAt: number | undefined
  /** 整段请求耗时（真实墙钟）；进行中为截至当前；旧记录可能缺失。 */
  durationMs: number | undefined
  /** 首 token 延迟（真实墙钟）；旧记录或非流式可能缺失。 */
  timeToFirstTokenMs: number | undefined
  /** 输出 token 速度（优先按首 token→结束/现在）；旧记录可能缺失。 */
  completionTokensPerSecond: number | undefined
  /** 响应正文字符数；旧记录可能缺失。 */
  responseCharCount: number | undefined
  /** 响应字符输出速度；旧记录可能缺失。 */
  responseCharsPerSecond: number | undefined
}

export type AiEventLogInput = {
  model?: string
  thinkingEnabled?: boolean
  messages: AiEventLogMessage[]
  response: string
  usage?: TokenUsageSnapshot
  usageEstimated?: boolean
  status?: AiEventLogStatus
  errorMessage?: string
  /** 请求计时；缺省则不写入速度相关字段。 */
  timing?: AiEventLogTimingInput
  /** 指定记录 id（用于实时会话最终落盘时保持同一条）。 */
  id?: string
}
