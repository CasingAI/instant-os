export type LlmPlaygroundRole = 'system' | 'user' | 'assistant'

export type LlmPlaygroundMessage = {
  id: string
  role: LlmPlaygroundRole
  content: string
}

export type LlmPlaygroundConfig = {
  /** 模型引用键 `${providerEntryId}:${modelId}`；空字符串表示跟随账户首选文本模型 */
  modelRefKey: string
  /** 是否开启深度思考 */
  thinkingEnabled: boolean
  /** reasoning_effort 档位；'default' 表示不指定（走模型默认） */
  thinkingEffort: string
  /** 采样温度（0~2）；null 表示不指定 */
  temperature: number | null
  /** 核采样 top_p（0~1）；null 表示不指定 */
  topP: number | null
  /** 频率惩罚（-2~2）；null 表示不指定 */
  frequencyPenalty: number | null
  /** 出现惩罚（-2~2）；null 表示不指定 */
  presencePenalty: number | null
  /** 最大输出 token 数；null 表示模型默认 */
  maxTokens: number | null
  /** 停止序列（逗号分隔文本存储）；空字符串表示不指定 */
  stop: string
  /** 发送完成后自动把响应追加为 Assistant 消息 */
  autoAppendResponse: boolean
}

export type LlmPlaygroundStore = {
  version: 1
  messages: LlmPlaygroundMessage[]
  config: LlmPlaygroundConfig
}

export const LLM_PLAYGROUND_DEFAULT_CONFIG: LlmPlaygroundConfig = {
  modelRefKey: '',
  thinkingEnabled: false,
  thinkingEffort: 'default',
  temperature: 0.7,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  maxTokens: null,
  stop: '',
  autoAppendResponse: true,
}
