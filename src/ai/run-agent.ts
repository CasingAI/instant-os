import type OpenAI from 'openai'
import type { AgentTool } from './agent-tool.ts'
import { isAgentToolStructuredResult, toChatCompletionTool } from './agent-tool.ts'
import { formatStreamEventResponse } from './ai-event-log-serialize.ts'
import { buildThinkingRequestExtras, providerRequiresReasoningContentEcho, readStreamDelta } from './ai-thinking.ts'
import type { AiReasoningEffort } from './ai-thinking.ts'
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
  createChatCompletionStream,
  forEachStreamChunk,
  isStreamAbortError,
  raceWithAbortSignal,
  throwIfStreamAborted,
} from './stream-abort.ts'
import {
  appendSelfCompactRubric,
  applyToolObservationBudget,
  cloneMessages,
  createCompactContextTool,
  createToolBudgetDedupState,
  estimateMessagesTokensRough,
  nextCompressionId,
  resolveCompressionOptions,
  runCompressionPipeline,
  type AgentCompressionEvent,
  type AgentCompressionOptions,
} from './context-compression/index.ts'

export type AgentToolCallEvent = {
  step: number
  /** 本轮 tool_calls 下标（与流式 delta 对齐） */
  index?: number
  toolName: string
  arguments: Record<string, unknown>
  /** 宿主合成（如 spill 自动读）；不计模型步数 */
  synthetic?: boolean
}

export type AgentToolResultEvent = {
  step: number
  toolName: string
  arguments: Record<string, unknown>
  /** 与写入 messages 的 tool content 一致（已序列化） */
  result: string
  /** 宿主合成（如 spill 自动读）；不计模型步数 */
  synthetic?: boolean
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

/** 工具调用参数流式增量（arguments 尚未 parse 完成） */
export type AgentToolCallDeltaEvent = {
  step: number
  /** 本轮 stream 内 tool_calls 下标 */
  index: number
  id: string
  toolName: string
  /** 累计的 function.arguments 原始 JSON 字符串 */
  argumentsRaw: string
}

/** 单轮 model 调用的 usage（非跨步累加；适合上下文占用展示） */
export type AgentUsageEvent = {
  step: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
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
  /** 上下文压缩；默认启用 */
  compression?: AgentCompressionOptions
  onContextCompression?: (event: AgentCompressionEvent) => void
  onStep?: (event: AgentStepEvent) => void
  onToolCall?: (event: AgentToolCallEvent) => void
  onToolResult?: (event: AgentToolResultEvent) => void
  onToolCallDelta?: (event: AgentToolCallDeltaEvent) => void
  onTextDelta?: (event: AgentTextDeltaEvent) => void
  onReasoningDelta?: (event: AgentReasoningDeltaEvent) => void
  onUsage?: (event: AgentUsageEvent) => void
}

export type RunAgentResult = {
  text: string
  /** 规范历史（完整，供续跑 / 编辑撤销） */
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
  /** 最后一轮实际发给模型的线历史 */
  wireMessages?: OpenAI.Chat.ChatCompletionMessageParam[]
  compressions?: AgentCompressionEvent[]
  steps: number
  /** 达到 maxSteps 仍有未完成的工具轮次，调用方可携带 messages 继续 */
  incomplete?: boolean
}

export type { AgentCompressionEvent, AgentCompressionOptions }

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
  if (isAgentToolStructuredResult(result)) {
    return result.content
  }
  if (typeof result === 'string') {
    return result
  }

  return JSON.stringify(result)
}

function emitSyntheticActivities(
  step: number,
  result: unknown,
  onToolCall?: (event: AgentToolCallEvent) => void,
  onToolResult?: (event: AgentToolResultEvent) => void,
): void {
  if (!isAgentToolStructuredResult(result) || !result.syntheticActivities?.length) {
    return
  }
  for (const activity of result.syntheticActivities) {
    onToolCall?.({
      step,
      toolName: activity.toolName,
      arguments: activity.arguments,
      synthetic: true,
    })
    onToolResult?.({
      step,
      toolName: activity.toolName,
      arguments: activity.arguments,
      result: activity.result,
      synthetic: true,
    })
  }
}

function applyToolCallDelta(
  toolCalls: Map<number, AccumulatedToolCall>,
  deltas: OpenAI.Chat.ChatCompletionChunk.Choice.Delta.ToolCall[] | undefined,
): number[] {
  if (!deltas?.length) {
    return []
  }

  const touched = new Set<number>()
  for (const delta of deltas) {
    const index = delta.index
    touched.add(index)
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
  return [...touched]
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
  thinkingEffort?: AiReasoningEffort
  includeUsage: boolean
  step: number
  signal?: AbortSignal
  onTextDelta?: (event: AgentTextDeltaEvent) => void
  onReasoningDelta?: (event: AgentReasoningDeltaEvent) => void
  onToolCallDelta?: (event: AgentToolCallDeltaEvent) => void
}): Promise<{
  content: string
  reasoning: string
  toolCalls: AccumulatedToolCall[]
  usage: ReturnType<typeof snapshotFromOpenAiUsage>
}> {
  throwIfStreamAborted(options.signal)

  const stream = await raceWithAbortSignal(
    createChatCompletionStream(
      options.client,
      {
        model: options.model,
        messages: options.messages,
        tools: options.chatTools,
        stream: true,
        ...(options.includeUsage ? { stream_options: { include_usage: true } } : {}),
        ...buildThinkingRequestExtras(
          options.providerId,
          options.thinkingEnabled,
          options.model,
          options.thinkingEffort,
        ),
      },
      options.signal,
    ),
    options.signal,
  )

  // create() 已返回后仍须把外部 abort 打到 SDK 内部 controller，才能取消 body
  const abortStreamController = () => {
    if (!stream.controller || stream.controller.signal.aborted) return
    stream.controller.abort()
  }
  if (options.signal) {
    if (options.signal.aborted) {
      abortStreamController()
      throwIfStreamAborted(options.signal)
    }
    options.signal.addEventListener('abort', abortStreamController, { once: true })
  }

  let content = ''
  let reasoning = ''
  let usage: ReturnType<typeof snapshotFromOpenAiUsage>
  const toolCallMap = new Map<number, AccumulatedToolCall>()

  try {
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

        const touchedIndexes = applyToolCallDelta(toolCallMap, choice.delta.tool_calls)
        if (options.onToolCallDelta && touchedIndexes.length > 0) {
          for (const index of touchedIndexes) {
            const toolCall = toolCallMap.get(index)
            if (!toolCall) continue
            options.onToolCallDelta({
              step: options.step,
              index,
              id: toolCall.id,
              toolName: toolCall.function.name,
              argumentsRaw: toolCall.function.arguments,
            })
          }
        }

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
  } finally {
    options.signal?.removeEventListener('abort', abortStreamController)
  }

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
  const compression = resolveCompressionOptions(options.compression)
  const requireReasoningEcho = providerRequiresReasoningContentEcho(config.providerId, model)
  const dedup = createToolBudgetDedupState()
  const compressions: AgentCompressionEvent[] = []
  let estimatedTokens = 0

  const emitCompression = (event: AgentCompressionEvent) => {
    compressions.push(event)
    options.onContextCompression?.(event)
  }

  const systemPrompt =
    compression.enabled && compression.selfCompactTool
      ? appendSelfCompactRubric(options.prompt)
      : options.prompt

  const canonical = buildInitialMessages({ ...options, prompt: systemPrompt })
  let wire = cloneMessages(canonical)

  type MutableBuffers = {
    canonical: OpenAI.Chat.ChatCompletionMessageParam[]
    wire: OpenAI.Chat.ChatCompletionMessageParam[]
  }
  const buffers: MutableBuffers = { canonical, wire }

  const pushBoth = (message: OpenAI.Chat.ChatCompletionMessageParam) => {
    buffers.canonical.push(message)
    buffers.wire.push(structuredClone(message))
  }

  const budgetAndPushTool = async (
    toolCallId: string,
    rawContent: string,
    step: number,
  ): Promise<string> => {
    if (!compression.enabled) {
      const message: OpenAI.Chat.ChatCompletionMessageParam = {
        role: 'tool',
        tool_call_id: toolCallId,
        content: rawContent,
      }
      pushBoth(message)
      return rawContent
    }

    const budgeted = await applyToolObservationBudget(rawContent, {
      step,
      dedup,
      spill: compression.spill,
    })
    if (budgeted.changed) {
      emitCompression({
        id: nextCompressionId('tool'),
        kind: 'tool_budget',
        atStep: step,
        beforeTokens: estimatedTokens,
        afterTokens: estimatedTokens,
        coveredCanonicalFrom: buffers.canonical.length,
        coveredCanonicalTo: buffers.canonical.length + 1,
        summaryPreview: budgeted.content.slice(0, 200),
        spilled: budgeted.spilled,
        note: budgeted.duplicate ? 'duplicate' : undefined,
      })
    }
    const message: OpenAI.Chat.ChatCompletionMessageParam = {
      role: 'tool',
      tool_call_id: toolCallId,
      content: budgeted.content,
    }
    pushBoth(message)
    return budgeted.content
  }

  const runPipeline = async (
    step: number,
    extras?: { forceLlmCompact?: boolean; focus?: string },
  ) => {
    if (!compression.enabled) return
    const result = await runCompressionPipeline({
      canonical: buffers.canonical,
      wire: buffers.wire,
      step,
      estimatedTokens,
      options: compression,
      requireReasoningEcho,
      model,
      usageContext: options.usageContext,
      client,
      focus: extras?.focus,
      forceLlmCompact: extras?.forceLlmCompact,
      signal: options.signal,
    })
    buffers.wire = result.wire
    estimatedTokens = result.estimatedTokens
    for (const event of result.events) {
      emitCompression(event)
    }
  }

  const baseTools = options.tools ?? []
  const tools: AgentTool[] = [...baseTools]
  if (compression.enabled && compression.selfCompactTool) {
    tools.push(
      createCompactContextTool(async (args) => {
        const before = estimatedTokens || estimateMessagesTokensRough(buffers.wire)
        await runPipeline(Math.max(0, compressions.length), {
          forceLlmCompact: true,
          focus: args.focus,
        })
        const last = compressions[compressions.length - 1]
        return {
          ok: true,
          focus: args.focus ?? null,
          reason: args.reason ?? null,
          beforeTokens: before,
          afterTokens: estimatedTokens,
          compressionId: last?.id ?? null,
          summaryPreview: last?.summaryPreview ?? null,
        }
      }),
    )
  }

  const toolByName = new Map(tools.map((tool) => [tool.name, tool]))
  const chatTools = tools.length > 0 ? tools.map(toChatCompletionTool) : undefined
  let accumulatedPromptTokens = 0
  let accumulatedCompletionTokens = 0
  let accumulatedTotalTokens = 0

  const logSession = options.usageContext
    ? startAiEventLogSession(options.usageContext, {
        model,
        thinkingEnabled: config.thinkingEnabled,
        messages: toEventLogMessages(buffers.canonical),
      })
    : undefined

  const resultExtras = () => ({
    wireMessages: cloneMessages(buffers.wire),
    compressions: compressions.length > 0 ? [...compressions] : undefined,
  })

  try {
    for (let step = 0; step < maxSteps; step += 1) {
      throwIfStreamAborted(options.signal)
      await runPipeline(step)
      options.onStep?.({ step, kind: 'model' })

      const turn = await streamAssistantTurn({
        client,
        model,
        messages: buffers.wire,
        chatTools,
        providerId: config.providerId,
        thinkingEnabled: config.thinkingEnabled,
        thinkingEffort: config.thinkingEffort,
        includeUsage: Boolean(options.usageContext || options.onUsage),
        step,
        signal: options.signal,
        onTextDelta: options.onTextDelta,
        onReasoningDelta: options.onReasoningDelta,
        onToolCallDelta: options.onToolCallDelta,
      })

      throwIfStreamAborted(options.signal)

      if (turn.usage) {
        accumulatedPromptTokens += turn.usage.promptTokens
        accumulatedCompletionTokens += turn.usage.completionTokens
        accumulatedTotalTokens += turn.usage.totalTokens
        estimatedTokens = turn.usage.promptTokens
        options.onUsage?.({
          step,
          promptTokens: turn.usage.promptTokens,
          completionTokens: turn.usage.completionTokens,
          totalTokens: turn.usage.totalTokens,
        })
      }

      const assistantMessage: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: turn.content || '',
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
      if (requireReasoningEcho) {
        ;(assistantMessage as OpenAI.Chat.ChatCompletionAssistantMessageParam & {
          reasoning_content?: string
        }).reasoning_content = turn.reasoning || ''
      }
      pushBoth(assistantMessage)

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
          messages: buffers.canonical,
          steps: step + 1,
          ...resultExtras(),
        }
      }

      options.onStep?.({
        step,
        kind: 'tools',
        toolNames: turn.toolCalls.map((toolCall) => toolCall.function.name),
      })

      const availableToolNames = [...toolByName.keys()]

      for (const [toolIndex, toolCall] of turn.toolCalls.entries()) {
        throwIfStreamAborted(options.signal)

        let args: Record<string, unknown> = {}
        try {
          args = parseToolArguments(toolCall.function.arguments)
        } catch (error) {
          await budgetAndPushTool(
            toolCall.id,
            serializeToolResult({
              error: `工具参数无效: ${error instanceof Error ? error.message : String(error)}`,
            }),
            step,
          )
          continue
        }

        const toolName = toolCall.function.name
        options.onToolCall?.({
          step,
          index: toolIndex,
          toolName,
          arguments: args,
        })

        const emitToolResult = (result: string) => {
          options.onToolResult?.({
            step,
            toolName,
            arguments: args,
            result,
          })
        }

        const tool = toolByName.get(toolName)
        if (!tool) {
          const content = await budgetAndPushTool(
            toolCall.id,
            serializeToolResult({
              error: `未注册的工具: ${toolName}。可用工具: ${availableToolNames.join(', ') || '（无）'}。请改用已注册的工具名重试。`,
            }),
            step,
          )
          throwIfStreamAborted(options.signal)
          emitToolResult(content)
          continue
        }

        try {
          const result = await raceWithAbortSignal(
            Promise.resolve(tool.execute(args)),
            options.signal,
          )
          const rawContent = serializeToolResult(result)
          // 已由工具侧 spill 的 structured 短柄：跳过二次 L0 大裁剪（budget 内会识别标记）
          const content = await budgetAndPushTool(toolCall.id, rawContent, step)
          // appendMessages 仅写入规范+线历史（合成 vision 等）
          if (isAgentToolStructuredResult(result) && result.appendMessages?.length) {
            for (const extra of result.appendMessages) {
              pushBoth(extra)
            }
          }
          throwIfStreamAborted(options.signal)
          emitToolResult(content)
          emitSyntheticActivities(step, result, options.onToolCall, options.onToolResult)
        } catch (error) {
          if (isStreamAbortError(error, options.signal)) {
            throw error
          }
          const content = await budgetAndPushTool(
            toolCall.id,
            serializeToolResult({
              error:
                error instanceof Error ? error.message : `工具执行失败: ${String(error)}`,
            }),
            step,
          )
          throwIfStreamAborted(options.signal)
          emitToolResult(content)
        }
      }
    }

    const incompleteText = lastAssistantText(buffers.canonical)
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
      messages: buffers.canonical,
      steps: maxSteps,
      incomplete: true,
      ...resultExtras(),
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
