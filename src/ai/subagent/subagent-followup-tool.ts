import type OpenAI from 'openai'
import { defineTool, type AgentTool } from '../agent-tool.ts'
import {
  formatSubAgentToolResult,
  type RunSubAgentFn,
  type SubAgentProgressEvent,
} from './subagent-delegate-tool.ts'
import {
  resolveSubAgent,
  shouldExposeSubAgentDelegation,
} from './subagent-registry.ts'
import type { EffectiveSubAgent, SubAgentHostConfig } from './subagent-types.ts'

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** 宿主提供的可续聊会话快照 */
export type SubAgentFollowUpSession = {
  agentId: string
  description: string
  status: 'running' | 'done' | 'error'
  history: OpenAI.Chat.ChatCompletionMessageParam[]
  modelKey: string | undefined
}

export type CreateFollowUpSubAgentToolOptions = {
  config: SubAgentHostConfig
  signal?: AbortSignal
  /** 按 run_id 解析已有私聊；不存在则返回 undefined */
  getSession: (runId: string) => SubAgentFollowUpSession | undefined
  runSubAgentFn: RunSubAgentFn
  onSubAgentProgress?: (event: SubAgentProgressEvent) => void
}

/**
 * 创建追问工具。与 delegate 相同启用条件；若当前无可用 Sub Agent，返回 undefined。
 */
export function createFollowUpSubAgentTool(
  options: CreateFollowUpSubAgentToolOptions,
): AgentTool | undefined {
  if (!shouldExposeSubAgentDelegation(options.config)) {
    return undefined
  }

  return defineTool({
    name: 'followup_subagent',
    description: [
      '对已有 Sub Agent 私聊线程追加一轮追问（同一 run_id 续聊）。',
      'run_id 来自先前 delegate_subagent / followup_subagent 的返回。',
      '仅当该线程不在 running 时可追问；结果不够细或需纠偏时优先用本工具，勿无谓新开线程。',
    ].join('\n'),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['run_id', 'message'],
      properties: {
        run_id: {
          type: 'string',
          description: '要续聊的 Sub Agent 线程 id（delegate/followup 返回的 run_id）',
        },
        message: {
          type: 'string',
          description:
            '追问 brief：要补什么细节、纠偏方向、验收标准；写清期望交付，勿空泛「再查一下」',
        },
      },
    },
    execute: async (args) => {
      const runId = asString(args.run_id).trim()
      const message = asString(args.message).trim()
      if (!runId) {
        return '错误：缺少 run_id'
      }
      if (!message) {
        return '错误：message 不能为空'
      }

      const session = options.getSession(runId)
      if (!session) {
        return `错误：未知的 Sub Agent 线程「${runId}」。请先用 delegate_subagent 创建，或核对 run_id。`
      }
      if (session.status === 'running') {
        return `错误：线程「${runId}」仍在运行中，请等待完成后再追问。`
      }
      if (session.history.length === 0) {
        return `错误：线程「${runId}」缺少对话历史，无法追问。`
      }

      const resolved: EffectiveSubAgent | undefined = resolveSubAgent(
        session.agentId,
        options.config,
      )
      if (!resolved) {
        return `错误：线程「${runId}」对应的 Sub Agent「${session.agentId}」当前不可用或已禁用。`
      }

      const description = session.description || resolved.id
      // 续聊沿用会话创建时模型；若会话未记录则用当前 resolve 结果
      const definition: EffectiveSubAgent = {
        ...resolved,
        modelKey: session.modelKey ?? resolved.modelKey,
      }

      try {
        options.onSubAgentProgress?.({
          runId,
          agentId: definition.id,
          description,
          modelKey: definition.modelKey,
          phase: 'started',
          taskPrompt: message,
        })
        const result = await options.runSubAgentFn({
          definition,
          taskPrompt: message,
          history: session.history,
          signal: options.signal,
          onProgress: (progress) => {
            options.onSubAgentProgress?.({
              runId,
              agentId: definition.id,
              description,
              modelKey: definition.modelKey,
              phase: 'progress',
              progress,
            })
          },
        })

        options.onSubAgentProgress?.({
          runId,
          agentId: definition.id,
          description,
          modelKey: definition.modelKey,
          phase: 'done',
          text: result.text,
          toolCallCount: result.toolCallCount,
          incomplete: result.incomplete,
          finalResult: result.finalResult,
        })

        return formatSubAgentToolResult({
          agentId: definition.id,
          description,
          access: definition.access,
          runId,
          text: result.text,
          toolCallCount: result.toolCallCount,
          incomplete: result.incomplete,
        })
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : String(error)
        return `Sub Agent「${definition.id}」追问失败：${errMessage}`
      }
    },
  })
}
