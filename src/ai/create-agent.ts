import type OpenAI from 'openai'
import type { AgentTool } from './agent-tool.ts'
import type { OpenAiConfig } from './openai-config.ts'
import { runAgent, type RunAgentResult } from './run-agent.ts'

export type AgentDefaults = {
  prompt: string
  tools?: AgentTool[]
  model?: string
  maxSteps?: number
  config?: Partial<OpenAiConfig>
  client?: OpenAI
}

export type AgentCallOptions = {
  input?: string
  messages?: OpenAI.Chat.ChatCompletionMessageParam[]
  prompt?: string
  tools?: AgentTool[]
  model?: string
  maxSteps?: number
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
    })

  const ask = (input: string, overrides?: Omit<AgentCallOptions, 'input'>) =>
    run({ input, ...overrides })

  return { run, ask }
}
