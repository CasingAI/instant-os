import type OpenAI from 'openai'
import { defineTool, type AgentTool } from '../agent-tool.ts'
import type { EffectiveSubAgent, SubAgentAccess } from './subagent-types.ts'
import {
  listAvailableSubAgents,
  resolveSubAgent,
  shouldExposeSubAgentDelegation,
} from './subagent-registry.ts'
import type { SubAgentHostConfig } from './subagent-types.ts'

/** 子 Agent 运行函数签名：由宿主注入（VSCode 端注入复用主 Agent 逻辑的实现） */
export type RunSubAgentFn = (params: {
  definition: EffectiveSubAgent
  taskPrompt: string
  /** 续聊时传入上一轮完整 transcript；首轮省略 */
  history?: OpenAI.Chat.ChatCompletionMessageParam[]
  signal?: AbortSignal
  onProgress?: (progress: unknown) => void
}) => Promise<{
  text: string
  toolCallCount: number
  incomplete?: boolean
  /**
   * 宿主可附加的完整运行结果（VSCode 端为 VscodeAiAgentResult），
   * 透传到 done 事件，供详情 Tab 完成后渲染完整 messages/investigation。
   */
  finalResult?: unknown
}>

export type SubAgentProgressEvent = {
  runId: string
  agentId: string
  description: string
  /** 子 Agent 解析出的 modelKey */
  modelKey: string | undefined
  phase: 'started' | 'progress' | 'done'
  /** 本轮用户侧文案（首轮任务 / 追问）；started 时携带 */
  taskPrompt?: string
  /** 主 Agent 的 progress 数据（timeline/activities/answerText 等） */
  progress?: unknown
  /** 完成时的最终文本与统计 */
  text?: string
  toolCallCount?: number
  incomplete?: boolean
  /** 宿主附加的完整运行结果，供详情 Tab 完成后渲染 */
  finalResult?: unknown
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function formatSubAgentToolResult(params: {
  agentId: string
  description: string
  access: SubAgentAccess
  runId: string
  text: string
  toolCallCount: number
  incomplete?: boolean
}): string {
  const header = [
    `【Sub Agent ${params.agentId}】${params.description}`,
    `run_id=${params.runId}`,
    `access=${params.access}`,
    params.incomplete ? 'status=incomplete' : 'status=ok',
    `tools=${params.toolCallCount}`,
  ].join(' · ')
  return `${header}\n\n${params.text}`
}

export type CreateDelegateSubAgentToolOptions = {
  config: SubAgentHostConfig
  getToolsForAccess: (access: SubAgentAccess) => AgentTool[]
  getEnvironmentSection?: () => string
  signal?: AbortSignal
  /** 宿主注入的子 Agent 运行函数（VSCode 端复用 askVscodeAiAgent） */
  runSubAgentFn: RunSubAgentFn
  onSubAgentProgress?: (event: SubAgentProgressEvent) => void
}

function buildToolDescription(config: SubAgentHostConfig): string {
  const available = listAvailableSubAgents(config)
  const lines = available.map((agent) => {
    const access = agent.access === 'readonly' ? '只读' : '可读写'
    return `- ${agent.id}（${access}）：${agent.description}`
  })
  return [
    '将独立子任务委派给 Sub Agent，开启一条可多轮私聊线程。子 Agent 有独立上下文，看不到本对话。',
    'prompt 须写成下属 brief（目标/范围约束/执行清单/交付格式），禁止原样转发用户原话。',
    '成功后会返回 run_id；若结果不够可再用 followup_subagent 对同一 run_id 追问。',
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
          description:
            '下属 brief：目标、范围与约束、执行清单、交付格式；可附极短已知上下文。禁止原样转发用户原话；子 Agent 看不到父对话',
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
        return '错误：prompt 不能为空；请写出下属 brief（目标/范围/清单/交付格式）'
      }

      const resolved = resolveSubAgent(agentId, options.config)
      if (!resolved) {
        const available = listAvailableSubAgents(options.config)
          .map((item) => item.id)
          .join(', ')
        return `错误：未知或未启用的 Sub Agent「${agentId}」。可用：${available || '（无）'}`
      }

      try {
        const runId = `subagent-${resolved.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        options.onSubAgentProgress?.({
          runId,
          agentId: resolved.id,
          description,
          modelKey: resolved.modelKey,
          phase: 'started',
          taskPrompt: prompt,
        })
        const result = await options.runSubAgentFn({
          definition: resolved,
          taskPrompt: prompt,
          signal: options.signal,
          onProgress: (progress) => {
            options.onSubAgentProgress?.({
              runId,
              agentId: resolved.id,
              description,
              modelKey: resolved.modelKey,
              phase: 'progress',
              progress,
            })
          },
        })

        options.onSubAgentProgress?.({
          runId,
          agentId: resolved.id,
          description,
          modelKey: resolved.modelKey,
          phase: 'done',
          text: result.text,
          toolCallCount: result.toolCallCount,
          incomplete: result.incomplete,
          finalResult: result.finalResult,
        })

        return formatSubAgentToolResult({
          agentId: resolved.id,
          description,
          access: resolved.access,
          runId,
          text: result.text,
          toolCallCount: result.toolCallCount,
          incomplete: result.incomplete,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `Sub Agent「${resolved.id}」失败：${message}`
      }
    },
  })
}
