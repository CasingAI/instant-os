import type OpenAI from 'openai'
import type { AgentTool } from './agent-tool.ts'
import type { AiUsageContext } from './ai-usage-context.ts'
import type { OpenAiConfig } from './openai-config.ts'
import {
  runAgent,
  type AgentReasoningDeltaEvent,
  type AgentStepEvent,
  type AgentTextDeltaEvent,
  type AgentToolCallEvent,
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
  onStep?: (event: AgentStepEvent) => void
  onToolCall?: (event: AgentToolCallEvent) => void
  onTextDelta?: (event: AgentTextDeltaEvent) => void
  onReasoningDelta?: (event: AgentReasoningDeltaEvent) => void
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
  onStep?: (event: AgentStepEvent) => void
  onToolCall?: (event: AgentToolCallEvent) => void
  onTextDelta?: (event: AgentTextDeltaEvent) => void
  onReasoningDelta?: (event: AgentReasoningDeltaEvent) => void
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
      onStep: options.onStep ?? defaults.onStep,
      onToolCall: options.onToolCall ?? defaults.onToolCall,
      onTextDelta: options.onTextDelta ?? defaults.onTextDelta,
      onReasoningDelta: options.onReasoningDelta ?? defaults.onReasoningDelta,
    })

  const ask = (input: string, overrides?: Omit<AgentCallOptions, 'input'>) =>
    run({ input, ...overrides })

  return { run, ask }
}
