import type OpenAI from 'openai'
import type { AgentTool } from './agent-tool.ts'
import type { AiUsageContext } from './ai-usage-context.ts'
import type { AgentCompressionEvent, AgentCompressionOptions } from './context-compression/types.ts'
import type { OpenAiConfig } from './openai-config.ts'
import {
  runAgent,
  type AgentReasoningDeltaEvent,
  type AgentStepEvent,
  type AgentTextDeltaEvent,
  type AgentToolCallDeltaEvent,
  type AgentToolCallEvent,
  type AgentToolResultEvent,
  type AgentUsageEvent,
  type RunAgentResult,
} from './run-agent.ts'

export type AgentDefaults = {
  prompt: string
  tools?: AgentTool[]
  model?: string
  maxSteps?: number
  config?: Partial<OpenAiConfig>
  client?: OpenAI
  usageContext?: AiUsageContext
  signal?: AbortSignal
  idleTimeoutMs?: number
  idleRetryCount?: number
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

export type AgentCallOptions = {
  input?: string
  messages?: OpenAI.Chat.ChatCompletionMessageParam[]
  prompt?: string
  tools?: AgentTool[]
  model?: string
  maxSteps?: number
  usageContext?: AiUsageContext
  signal?: AbortSignal
  idleTimeoutMs?: number
  idleRetryCount?: number
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

export type AgentRunner = {
  run: (options: AgentCallOptions) => Promise<RunAgentResult>
  ask: (input: string, overrides?: Omit<AgentCallOptions, 'input'>) => Promise<RunAgentResult>
}

export function createAgent(defaults: AgentDefaults): AgentRunner {
  const run = (options: AgentCallOptions) =>
    runAgent({
      prompt: options.prompt ?? defaults.prompt,
      input: options.input,
      messages: options.messages,
      tools: options.tools ?? defaults.tools,
      model: options.model ?? defaults.model,
      maxSteps: options.maxSteps ?? defaults.maxSteps,
      client: defaults.client,
      config: defaults.config,
      usageContext: options.usageContext ?? defaults.usageContext,
      signal: options.signal ?? defaults.signal,
      idleTimeoutMs: options.idleTimeoutMs ?? defaults.idleTimeoutMs,
      idleRetryCount: options.idleRetryCount ?? defaults.idleRetryCount,
      compression: options.compression ?? defaults.compression,
      onContextCompression:
        options.onContextCompression ?? defaults.onContextCompression,
      onStep: options.onStep ?? defaults.onStep,
      onToolCall: options.onToolCall ?? defaults.onToolCall,
      onToolResult: options.onToolResult ?? defaults.onToolResult,
      onToolCallDelta: options.onToolCallDelta ?? defaults.onToolCallDelta,
      onTextDelta: options.onTextDelta ?? defaults.onTextDelta,
      onReasoningDelta: options.onReasoningDelta ?? defaults.onReasoningDelta,
      onUsage: options.onUsage ?? defaults.onUsage,
    })

  const ask = (input: string, overrides?: Omit<AgentCallOptions, 'input'>) =>
    run({ input, ...overrides })

  return { run, ask }
}
