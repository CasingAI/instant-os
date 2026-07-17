import type OpenAI from 'openai'
import type { AgentTool } from './agent-tool.ts'
import { toChatCompletionTool } from './agent-tool.ts'
import { buildThinkingRequestExtras } from './ai-thinking.ts'
import type { AiUsageContext } from './ai-usage-context.ts'
import {
  finishAiEventLogSession,
  startAiEventLogSession,
  toEventLogMessages,
} from './ai-event-log.ts'
import { recordAiTokenUsage } from './ai-token-usage.ts'
import { snapshotFromOpenAiUsage } from './openai-usage.ts'
import { mergeOpenAiConfig, type OpenAiConfig } from './openai-config.ts'
import { getOpenAiClient } from './openai-client.ts'

export type RunAgentOptions = {
  prompt: string
  input?: string
  messages?: OpenAI.Chat.ChatCompletionMessageParam[]
  tools?: AgentTool[]
  model?: string
  maxSteps?: number
  client?: OpenAI
  config?: Partial<OpenAiConfig>
  usageContext?: AiUsageContext
}

export type RunAgentResult = {
  text: string
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
  steps: number
}

function buildInitialMessages(
  options: RunAgentOptions,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const seed: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: options.prompt },
  ]

  if (options.messages?.length) {
    seed.push(...options.messages)
  }

  if (options.input !== undefined) {
    seed.push({ role: 'user', content: options.input })
  }

  return seed
}

function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) {
    return {}
  }

  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Tool 参数必须是 JSON 对象')
  }

  return parsed as Record<string, unknown>
}

function serializeToolResult(result: unknown): string {
  if (typeof result === 'string') {
    return result
  }

  return JSON.stringify(result)
}

export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const config = mergeOpenAiConfig(options.config)
  const client = options.client ?? getOpenAiClient(config)
  const model = options.model ?? config.defaultModel
  const maxSteps = options.maxSteps ?? 8
  const tools = options.tools ?? []
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]))

  const messages = buildInitialMessages(options)
  const chatTools = tools.length > 0 ? tools.map(toChatCompletionTool) : undefined
  let accumulatedPromptTokens = 0
  let accumulatedCompletionTokens = 0
  let accumulatedTotalTokens = 0

  const logSession = options.usageContext
    ? startAiEventLogSession(options.usageContext, {
        model,
        thinkingEnabled: config.thinkingEnabled,
        messages: toEventLogMessages(messages),
      })
    : undefined

  try {
    for (let step = 0; step < maxSteps; step += 1) {
      const response = await client.chat.completions.create({
        model,
        messages,
        tools: chatTools,
        ...buildThinkingRequestExtras(config.providerId, config.thinkingEnabled),
      })

      const usage = snapshotFromOpenAiUsage(response.usage)
      if (usage) {
        accumulatedPromptTokens += usage.promptTokens
        accumulatedCompletionTokens += usage.completionTokens
        accumulatedTotalTokens += usage.totalTokens
      }

      const choice = response.choices[0]
      if (!choice) {
        throw new Error('模型未返回任何结果')
      }

      const assistantMessage = choice.message
      messages.push(assistantMessage)

      if (logSession) {
        logSession.update({
          response: assistantMessage.content ?? '',
          usage:
            accumulatedTotalTokens > 0
              ? {
                  promptTokens: accumulatedPromptTokens,
                  completionTokens: accumulatedCompletionTokens,
                  totalTokens: accumulatedTotalTokens,
                }
              : undefined,
        })
      }

      const toolCalls = assistantMessage.tool_calls
      if (!toolCalls?.length) {
        if (options.usageContext && accumulatedTotalTokens > 0) {
          const usage = {
            promptTokens: accumulatedPromptTokens,
            completionTokens: accumulatedCompletionTokens,
            totalTokens: accumulatedTotalTokens,
          }
          recordAiTokenUsage(options.usageContext, usage)
          if (logSession) {
            finishAiEventLogSession(logSession, options.usageContext, {
              response: assistantMessage.content ?? '',
              usage,
              usageEstimated: false,
              status: 'success',
            })
          }
        } else if (logSession && options.usageContext) {
          finishAiEventLogSession(logSession, options.usageContext, {
            response: assistantMessage.content ?? '',
            status: 'success',
          })
        }
        return {
          text: assistantMessage.content ?? '',
          messages,
          steps: step + 1,
        }
      }

      for (const toolCall of toolCalls) {
        if (toolCall.type !== 'function') {
          continue
        }

        const tool = toolByName.get(toolCall.function.name)
        if (!tool) {
          throw new Error(`未注册的工具: ${toolCall.function.name}`)
        }

        const args = parseToolArguments(toolCall.function.arguments)
        const result = await tool.execute(args)

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: serializeToolResult(result),
        })
      }
    }

    throw new Error(`Agent 在 ${maxSteps} 步内未完成，请增大 maxSteps 或简化任务`)
  } catch (error) {
    if (logSession && options.usageContext) {
      const snapshot = logSession.snapshot()
      if (snapshot) {
        finishAiEventLogSession(logSession, options.usageContext, {
          response: snapshot.response,
          status: 'error',
          errorMessage: error instanceof Error ? error.message : 'Agent 执行失败',
        })
      }
    }
    throw error
  }
}
