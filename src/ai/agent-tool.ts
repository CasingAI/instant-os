import type OpenAI from 'openai'

export type JsonSchema = Record<string, unknown>

/** 工具执行后由宿主注入的合成 UI activity（如 spill 自动预览）；不计入模型 tool 步数。 */
export type AgentSyntheticActivity = {
  toolName: string
  arguments: Record<string, unknown>
  result: string
}

/** 工具可返回纯数据（序列化为 JSON 字符串），或带追加对话消息的结构（如截图 vision）。 */
export type AgentToolStructuredResult = {
  content: string
  appendMessages?: OpenAI.Chat.ChatCompletionMessageParam[]
  /** 与 appendMessages 配套的 timeline 记录（由 run-agent 再发 onToolCall/onToolResult） */
  syntheticActivities?: AgentSyntheticActivity[]
  /**
   * 为 true 时：本工具结果写入 transcript 后立刻结束当前 runAgent 循环
   *（不再进入下一步 model 调用；同轮后续 tool_calls 仍会先跑完）。
   */
  stopRun?: boolean
}

export type AgentToolExecuteResult = unknown | AgentToolStructuredResult

export function isAgentToolStructuredResult(
  value: unknown,
): value is AgentToolStructuredResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'content' in value &&
    typeof (value as AgentToolStructuredResult).content === 'string'
  )
}

export type AgentTool<TArgs extends Record<string, unknown> = Record<string, unknown>> = {
  name: string
  description: string
  parameters: JsonSchema
  execute: (args: TArgs) => Promise<unknown> | unknown
}

export function defineTool<TArgs extends Record<string, unknown>>(
  tool: AgentTool<TArgs>,
): AgentTool<TArgs> {
  return tool
}

export function toChatCompletionTool(tool: AgentTool): OpenAI.Chat.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
}
