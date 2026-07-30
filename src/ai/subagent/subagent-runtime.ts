import type { AgentTool } from '../agent-tool.ts'
import type { AiUsageContext } from '../ai-usage-context.ts'
import { createAgent } from '../create-agent.ts'
import { createOpenAiClient } from '../openai-client.ts'
import { mergeOpenAiConfig } from '../openai-config.ts'
import {
  loadAccountSettings,
  openAiConfigForModelRef,
} from '../../os/account-settings-storage.ts'
import { osNowMs } from '../../os/os-clock.ts'
import type { EffectiveSubAgent, SubAgentRunResult } from './subagent-types.ts'

const SUBAGENT_MAX_STEPS = 20

const running = new Map<string, AbortController>()

export function getRunningSubAgentCount(): number {
  return running.size
}

function parseModelRef(modelKey: string | undefined): {
  providerEntryId: string
  modelId: string
} | undefined {
  if (!modelKey) return undefined
  const separator = modelKey.indexOf(':')
  if (separator <= 0) return undefined
  const providerEntryId = modelKey.slice(0, separator)
  const modelId = modelKey.slice(separator + 1)
  if (!providerEntryId || !modelId) return undefined
  return { providerEntryId, modelId }
}

function openAiConfigForModelKey(modelKey: string | undefined) {
  const settings = loadAccountSettings()
  let config = mergeOpenAiConfig(undefined, 'text')
  const ref = parseModelRef(modelKey)
  if (settings && ref) {
    const partial = openAiConfigForModelRef(settings, ref, 'text')
    if (partial) {
      config = mergeOpenAiConfig(partial, 'text')
    }
  }
  return config
}

export type RunSubAgentOptions = {
  definition: EffectiveSubAgent
  taskPrompt: string
  tools: AgentTool[]
  usageContext: AiUsageContext
  /** 工作区等环境说明，拼进 system */
  environmentSection?: string
  maxConcurrent: number
  signal?: AbortSignal
  onProgress?: (event: {
    runId: string
    phase: 'started' | 'tool' | 'done'
    label?: string
    text?: string
  }) => void
}

/**
 * 在独立上下文中跑一个 Sub Agent（无父对话历史）。
 * 不向子 Agent 注册 delegate_subagent（禁止嵌套）。
 */
export async function runSubAgent(options: RunSubAgentOptions): Promise<SubAgentRunResult> {
  if (running.size >= options.maxConcurrent) {
    throw new Error(
      `Sub Agent 并发已达上限（${options.maxConcurrent}）。请等待现有子任务完成，或在设置中提高上限。`,
    )
  }

  const runId = `subagent-${options.definition.id}-${osNowMs()}-${Math.random().toString(36).slice(2, 8)}`
  const localController = new AbortController()
  running.set(runId, localController)

  const onAbort = () => {
    localController.abort()
  }
  options.signal?.addEventListener('abort', onAbort)

  try {
    const modelConfig = openAiConfigForModelKey(options.definition.modelKey)
    const client = createOpenAiClient(modelConfig, 'text')
    const model = modelConfig.defaultModel

    const env = options.environmentSection?.trim()
      ? `\n\n【环境】\n${options.environmentSection.trim()}`
      : ''
    const system = `${options.definition.systemPrompt}${env}`

    options.onProgress?.({
      runId,
      phase: 'started',
      label: options.definition.id,
    })

    const agent = createAgent({
      prompt: system,
      tools: options.tools,
      maxSteps: SUBAGENT_MAX_STEPS,
      config: modelConfig,
      client,
      model,
      usageContext: options.usageContext,
      signal: localController.signal,
    })

    let toolCallCount = 0
    const result = await agent.ask(options.taskPrompt.trim(), {
      onToolCall: (event) => {
        if (event.synthetic) return
        toolCallCount += 1
        options.onProgress?.({
          runId,
          phase: 'tool',
          label: event.toolName,
        })
      },
    })

    const text =
      result.text.trim() ||
      (result.incomplete
        ? '（子 Agent 步数用尽，未返回完整结论）'
        : '（子 Agent 无文本输出）')

    options.onProgress?.({
      runId,
      phase: 'done',
      text,
    })

    return {
      runId,
      text,
      toolCallCount,
      incomplete: result.incomplete,
    }
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
    running.delete(runId)
  }
}

/** 测试用：清空并发池 */
export function resetSubAgentRuntimeForTests(): void {
  for (const controller of running.values()) {
    controller.abort()
  }
  running.clear()
}
