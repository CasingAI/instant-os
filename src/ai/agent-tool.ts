import type OpenAI from 'openai'

export type JsonSchema = Record<string, unknown>

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
