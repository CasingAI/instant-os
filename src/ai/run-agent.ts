import type OpenAI from 'openai'
import type { AgentTool } from './agent-tool.ts'
import { toChatCompletionTool } from './agent-tool.ts'
import { formatStreamEventResponse } from './ai-event-log-serialize.ts'
import { buildThinkingRequestExtras, readStreamDelta } from './ai-thinking.ts'
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
import {
  forEachStreamChunk,
  isStreamAbortError,
  throwIfStreamAborted,
} from './stream-abort.ts'

export type AgentToolCallEvent = {
  step: number
  toolName: string
  arguments: Record<string, unknown>
}

export type AgentStepEvent = {
  step: number
  kind: 'model' | 'tools'
  toolNames?: string[]
}

export type AgentTextDeltaEvent = {
  step: number
  delta: string
  accumulated: string
}

export type AgentReasoningDeltaEvent = {
  step: number
  delta: string
  accumulated: string
}

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
  signal?: AbortSignal
  onStep?: (event: AgentStepEvent) => void
  onToolCall?: (event: AgentToolCallEvent) => void
  onTextDelta?: (event: AgentTextDeltaEvent) => void
  onReasoningDelta?: (event: AgentReasoningDeltaEvent) => void
}

export type RunAgentResult = {
  text: string
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
  steps: number
  /** 达到 maxSteps 仍有未完成的工具轮次，调用方可携带 messages 继续 */
  incomplete?: boolean
}

type AccumulatedToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
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

function applyToolCallDelta(
  toolCalls: Map<number, AccumulatedToolCall>,
  deltas: OpenAI.Chat.ChatCompletionChunk.Choice.Delta.ToolCall[] | undefined,
): void {
  if (!deltas?.length) {
    return
  }

  for (const delta of deltas) {
    const index = delta.index
    const existing = toolCalls.get(index)
    if (!existing) {
      toolCalls.set(index, {
        id: delta.id ?? `tool-call-${index}`,
        type: 'function',
        function: {
          name: delta.function?.name ?? '',
          arguments: delta.function?.arguments ?? '',
        },
      })
      continue
    }

    if (delta.id) {
      existing.id = delta.id
    }
    if (delta.function?.name) {
      existing.function.name += delta.function.name
    }
    if (delta.function?.arguments) {
      existing.function.arguments += delta.function.arguments
    }
  }
}

function lastAssistantText(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'assistant') {
      continue
    }
    if (typeof message.content === 'string' && message.content.trim()) {
      return message.content
    }
  }
  return ''
}

function finishAgentUsage(options: {
  usageContext?: AiUsageContext
  logSession: ReturnType<typeof startAiEventLogSession> | undefined
  response: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  status?: 'success' | 'error'
  errorMessage?: string
}): void {
  const usage =
    options.totalTokens > 0
      ? {
          promptTokens: options.promptTokens,
          completionTokens: options.completionTokens,
          totalTokens: options.totalTokens,
        }
      : undefined

  if (options.usageContext && usage) {
    recordAiTokenUsage(options.usageContext, usage)
  }

  if (options.logSession && options.usageContext) {
    finishAiEventLogSession(options.logSession, options.usageContext, {
      response: options.response,
      usage,
      usageEstimated: false,
      status: options.status ?? 'success',
      errorMessage: options.errorMessage,
    })
  }
}

async function streamAssistantTurn(options: {
  client: OpenAI
  model: string
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
  chatTools: OpenAI.Chat.ChatCompletionTool[] | undefined
  providerId: ReturnType<typeof mergeOpenAiConfig>['providerId']
  thinkingEnabled: boolean
  includeUsage: boolean
  step: number
  signal?: AbortSignal
  onTextDelta?: (event: AgentTextDeltaEvent) => void
  onReasoningDelta?: (event: AgentReasoningDeltaEvent) => void
}): Promise<{
  content: string
  reasoning: string
  toolCalls: AccumulatedToolCall[]
  usage: ReturnType<typeof snapshotFromOpenAiUsage>
}> {
  throwIfStreamAborted(options.signal)

  const stream = await options.client.chat.completions.create({
    model: options.model,
    messages: options.messages,
    tools: options.chatTools,
    stream: true,
    ...(options.includeUsage ? { stream_options: { include_usage: true } } : {}),
    ...buildThinkingRequestExtras(options.providerId, options.thinkingEnabled),
    ...(options.signal ? { signal: options.signal } : {}),
  })

  let content = ''
  let reasoning = ''
  let usage: ReturnType<typeof snapshotFromOpenAiUsage>
  const toolCallMap = new Map<number, AccumulatedToolCall>()

  await forEachStreamChunk(
    stream,
    (chunk) => {
      const chunkUsage = snapshotFromOpenAiUsage(chunk.usage)
      if (chunkUsage) {
        usage = chunkUsage
      }

      const choice = chunk.choices[0]
      if (!choice) {
        return
      }

      applyToolCallDelta(toolCallMap, choice.delta.tool_calls)

      const { reasoning: reasoningDelta, content: contentDelta } = readStreamDelta(
        choice.delta,
      )

      if (reasoningDelta) {
        reasoning += reasoningDelta
        options.onReasoningDelta?.({
          step: options.step,
          delta: reasoningDelta,
          accumulated: reasoning,
        })
      }

      if (contentDelta) {
        content += contentDelta
        options.onTextDelta?.({
          step: options.step,
          delta: contentDelta,
          accumulated: content,
        })
      }
    },
    options.signal,
  )

  const toolCalls = [...toolCallMap.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, toolCall]) => toolCall)
    .filter((toolCall) => toolCall.function.name.trim().length > 0)

  return { content, reasoning, toolCalls, usage }
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
      throwIfStreamAborted(options.signal)
      options.onStep?.({ step, kind: 'model' })

      const turn = await streamAssistantTurn({
        client,
        model,
        messages,
        chatTools,
        providerId: config.providerId,
        thinkingEnabled: config.thinkingEnabled,
        includeUsage: Boolean(options.usageContext),
        step,
        signal: options.signal,
        onTextDelta: options.onTextDelta,
        onReasoningDelta: options.onReasoningDelta,
      })

      throwIfStreamAborted(options.signal)

      if (turn.usage) {
        accumulatedPromptTokens += turn.usage.promptTokens
        accumulatedCompletionTokens += turn.usage.completionTokens
        accumulatedTotalTokens += turn.usage.totalTokens
      }

      const assistantMessage: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: turn.content || undefined,
        ...(turn.toolCalls.length > 0
          ? {
              tool_calls: turn.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                type: 'function' as const,
                function: {
                  name: toolCall.function.name,
                  arguments: toolCall.function.arguments,
                },
              })),
            }
          : {}),
      }
      messages.push(assistantMessage)

      if (logSession) {
        logSession.update({
          response: formatStreamEventResponse(turn.reasoning, turn.content),
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

      if (turn.toolCalls.length === 0) {
        finishAgentUsage({
          usageContext: options.usageContext,
          logSession,
          response: formatStreamEventResponse(turn.reasoning, turn.content),
          promptTokens: accumulatedPromptTokens,
          completionTokens: accumulatedCompletionTokens,
          totalTokens: accumulatedTotalTokens,
        })
        return {
          text: turn.content,
          messages,
          steps: step + 1,
        }
      }

      options.onStep?.({
        step,
        kind: 'tools',
        toolNames: turn.toolCalls.map((toolCall) => toolCall.function.name),
      })

      const availableToolNames = [...toolByName.keys()]

      for (const toolCall of turn.toolCalls) {
        throwIfStreamAborted(options.signal)

        let args: Record<string, unknown> = {}
        try {
          args = parseToolArguments(toolCall.function.arguments)
        } catch (error) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: serializeToolResult({
              error: `工具参数无效: ${error instanceof Error ? error.message : String(error)}`,
            }),
          })
          continue
        }

        options.onToolCall?.({
          step,
          toolName: toolCall.function.name,
          arguments: args,
        })

        const tool = toolByName.get(toolCall.function.name)
        if (!tool) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: serializeToolResult({
              error: `未注册的工具: ${toolCall.function.name}。可用工具: ${availableToolNames.join(', ') || '（无）'}。请改用已注册的工具名重试。`,
            }),
          })
          continue
        }

        try {
          const result = await tool.execute(args)
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: serializeToolResult(result),
          })
        } catch (error) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: serializeToolResult({
              error:
                error instanceof Error ? error.message : `工具执行失败: ${String(error)}`,
            }),
          })
        }
      }
    }

    const incompleteText = lastAssistantText(messages)
    finishAgentUsage({
      usageContext: options.usageContext,
      logSession,
      response: incompleteText || `已达最大步数 ${maxSteps}，可继续`,
      promptTokens: accumulatedPromptTokens,
      completionTokens: accumulatedCompletionTokens,
      totalTokens: accumulatedTotalTokens,
    })

    return {
      text: incompleteText,
      messages,
      steps: maxSteps,
      incomplete: true,
    }
  } catch (error) {
    if (logSession && options.usageContext) {
      const snapshot = logSession.snapshot()
      if (snapshot) {
        const aborted = isStreamAbortError(error, options.signal)
        finishAiEventLogSession(logSession, options.usageContext, {
          response: snapshot.response,
          status: aborted ? 'aborted' : 'error',
          errorMessage: aborted
            ? '用户停止'
            : error instanceof Error
              ? error.message
              : 'Agent 执行失败',
        })
      }
    }
    throw error
  }
}
