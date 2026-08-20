import type { AgentTool } from '../agent-tool.ts'
import type { AiUsageContext } from '../ai-usage-context.ts'
import { osNowMs } from '../../os/os-clock.ts'
import type { EffectiveSubAgent, SubAgentRunResult } from './subagent-types.ts'

/** 并发池：限制同时运行的 Sub Agent 数量 */
const running = new Map<string, AbortController>()

export function getRunningSubAgentCount(): number {
  return running.size
}

/**
 * 注册一个 Sub Agent 运行（占用并发槽）。
 * 返回 runId 与 AbortController；调用方在完成/失败时务必调 releaseSubAgentSlot。
 */
export function acquireSubAgentSlot(
  agentId: string,
  maxConcurrent: number,
): { runId: string; controller: AbortController } | undefined {
  if (running.size >= maxConcurrent) {
    throw new Error(
      `Sub Agent 并发已达上限（${maxConcurrent}）。请等待现有子任务完成，或在设置中提高上限。`,
    )
  }
  const runId = `subagent-${agentId}-${osNowMs()}-${Math.random().toString(36).slice(2, 8)}`
  const controller = new AbortController()
  running.set(runId, controller)
  return { runId, controller }
}

/** 释放并发槽 */
export function releaseSubAgentSlot(runId: string): void {
  running.delete(runId)
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
    toolCallCount?: number
    incomplete?: boolean
  }) => void
}

/**
 * 在独立上下文中跑一个 Sub Agent（无父对话历史）。
 * 不向子 Agent 注册 delegate_subagent（禁止嵌套）。
 *
 * 注意：此为核心实现，使用 createAgent 直接跑。
 * VSCode 宿主通常注入自己的 runSubAgentFn（复用 askVscodeAiAgent）以获得完整 UI 数据。
 */
export async function runSubAgent(options: RunSubAgentOptions): Promise<SubAgentRunResult> {
  const slot = acquireSubAgentSlot(options.definition.id, options.maxConcurrent)
  if (!slot) {
    throw new Error('Sub Agent 并发已达上限')
  }
  const { runId, controller: localController } = slot

  const onAbort = () => {
    localController.abort()
  }
  options.signal?.addEventListener('abort', onAbort)

  try {
    // 延迟导入避免循环依赖
    const { createAgent } = await import('../create-agent.ts')
    const { createOpenAiClient } = await import('../openai-client.ts')
    const { mergeOpenAiConfig } = await import('../openai-config.ts')
    const {
      loadAccountSettings,
      openAiConfigForModelRef,
    } = await import('../../os/account-settings-storage.ts')

    const modelConfig = (() => {
      let config = mergeOpenAiConfig(undefined, 'text')
      const settings = loadAccountSettings()
      const modelKey = options.definition.modelKey
      if (modelKey && settings) {
        const separator = modelKey.indexOf(':')
        if (separator > 0) {
          const ref = {
            providerEntryId: modelKey.slice(0, separator),
            modelId: modelKey.slice(separator + 1),
          }
          const partial = openAiConfigForModelRef(settings, ref, 'text')
          if (partial) config = mergeOpenAiConfig(partial, 'text')
        }
      }
      return config
    })()
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
      maxSteps: 30,
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
      toolCallCount,
      incomplete: result.incomplete,
    })

    return {
      runId,
      text,
      toolCallCount,
      incomplete: result.incomplete,
    }
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
    releaseSubAgentSlot(runId)
  }
}

/** 测试用：清空并发池 */
export function resetSubAgentRuntimeForTests(): void {
  for (const controller of running.values()) {
    controller.abort()
  }
  running.clear()
}
