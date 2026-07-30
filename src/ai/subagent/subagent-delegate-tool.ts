import { defineTool, type AgentTool } from '../agent-tool.ts'
import type { AiUsageContext } from '../ai-usage-context.ts'
import type { SubAgentAccess } from './subagent-types.ts'
import {
  listAvailableSubAgents,
  resolveSubAgent,
  shouldExposeSubAgentDelegation,
} from './subagent-registry.ts'
import { runSubAgent } from './subagent-runtime.ts'
import type { SubAgentHostConfig } from './subagent-types.ts'

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function usageBehaviorForAgentId(agentId: string): { behavior: string; behaviorLabel: string } {
  if (agentId === 'explore') {
    return { behavior: 'subagent:explore', behaviorLabel: 'Sub Agent · Explore' }
  }
  if (agentId === 'general') {
    return { behavior: 'subagent:general', behaviorLabel: 'Sub Agent · General' }
  }
  return {
    behavior: `subagent:custom:${agentId}`,
    behaviorLabel: `Sub Agent · ${agentId}`,
  }
}

export type CreateDelegateSubAgentToolOptions = {
  config: SubAgentHostConfig
  getToolsForAccess: (access: SubAgentAccess) => AgentTool[]
  getEnvironmentSection?: () => string
  parentUsageContext?: Pick<AiUsageContext, 'actor' | 'actorLabel'>
  signal?: AbortSignal
  onSubAgentProgress?: (event: {
    agentId: string
    description: string
    runId: string
    phase: 'started' | 'tool' | 'done'
    label?: string
  }) => void
}

function buildToolDescription(config: SubAgentHostConfig): string {
  const available = listAvailableSubAgents(config)
  const lines = available.map((agent) => {
    const access = agent.access === 'readonly' ? '只读' : '可读写'
    return `- ${agent.id}（${access}）：${agent.description}`
  })
  return [
    '将独立子任务委派给 Sub Agent。子 Agent 有独立上下文，看不到本对话；prompt 必须自包含。',
    '可并行发起多个 delegate_subagent（受并发上限约束）。',
    '可用 agent_id：',
    ...lines,
  ].join('\n')
}

/**
 * 创建委派工具。若当前无可用 Sub Agent，返回 undefined（调用方勿注册）。
 */
export function createDelegateSubAgentTool(
  options: CreateDelegateSubAgentToolOptions,
): AgentTool | undefined {
  if (!shouldExposeSubAgentDelegation(options.config)) {
    return undefined
  }

  return defineTool({
    name: 'delegate_subagent',
    description: buildToolDescription(options.config),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['agent_id', 'description', 'prompt'],
      properties: {
        agent_id: {
          type: 'string',
          description: 'Sub Agent id（见工具描述中的可用列表）',
        },
        description: {
          type: 'string',
          description: '3–5 词短标题，供界面展示',
        },
        prompt: {
          type: 'string',
          description: '自包含任务说明（路径、约束、期望输出）；子 Agent 看不到父对话',
        },
      },
    },
    execute: async (args) => {
      const agentId = asString(args.agent_id).trim()
      const description = asString(args.description).trim() || agentId
      const prompt = asString(args.prompt).trim()
      if (!agentId) {
        return '错误：缺少 agent_id'
      }
      if (!prompt) {
        return '错误：prompt 不能为空；请写出自包含的任务说明'
      }

      const resolved = resolveSubAgent(agentId, options.config)
      if (!resolved) {
        const available = listAvailableSubAgents(options.config)
          .map((item) => item.id)
          .join(', ')
        return `错误：未知或未启用的 Sub Agent「${agentId}」。可用：${available || '（无）'}`
      }

      const { behavior, behaviorLabel } = usageBehaviorForAgentId(resolved.id)
      const usageContext: AiUsageContext = {
        actor: options.parentUsageContext?.actor ?? options.config.actor ?? 'subagent',
        actorLabel:
          options.parentUsageContext?.actorLabel ?? options.config.actorLabel,
        behavior,
        behaviorLabel: options.config.parentRunId
          ? `${behaviorLabel} · parent=${options.config.parentRunId}`
          : behaviorLabel,
      }

      try {
        const result = await runSubAgent({
          definition: resolved,
          taskPrompt: prompt,
          tools: options.getToolsForAccess(resolved.access),
          usageContext,
          environmentSection: options.getEnvironmentSection?.(),
          maxConcurrent: options.config.maxConcurrent,
          signal: options.signal,
          onProgress: (event) => {
            options.onSubAgentProgress?.({
              agentId: resolved.id,
              description,
              runId: event.runId,
              phase: event.phase,
              label: event.label,
            })
          },
        })

        const header = [
          `【Sub Agent ${resolved.id}】${description}`,
          `runId=${result.runId}`,
          `access=${resolved.access}`,
          result.incomplete ? 'status=incomplete' : 'status=ok',
          `tools=${result.toolCallCount}`,
        ].join(' · ')
        return `${header}\n\n${result.text}`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `Sub Agent「${resolved.id}」失败：${message}`
      }
    },
  })
}
