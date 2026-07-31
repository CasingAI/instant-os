import type OpenAI from 'openai'
import type { VscodeAiAgentResult } from './vscode-ai-agent.ts'
import {
  hydrateRuns,
  listRuns,
  type SubagentRunState,
} from './vscode-subagent-store.ts'

/** 长期落盘的 Sub Agent 线程快照（随工作区 AI 聊天 store 一起存） */
export type PersistedSubagentRun = {
  runId: string
  parentChatId: string | undefined
  agentId: string
  description: string
  taskPrompt: string
  lastFollowUpPrompt?: string
  modelKey?: string
  modelLabel: string
  status: 'running' | 'done' | 'error'
  startedAt: number
  text?: string
  toolCallCount?: number
  incomplete?: boolean
  messages?: OpenAI.Chat.ChatCompletionMessageParam[]
  error?: string
  updatedAt: number
}

function isMessageRole(value: unknown): value is OpenAI.Chat.ChatCompletionMessageParam['role'] {
  return value === 'system' || value === 'user' || value === 'assistant' || value === 'tool'
}

function normalizeMessages(
  raw: unknown,
): OpenAI.Chat.ChatCompletionMessageParam[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const role = (item as { role?: unknown }).role
    if (isMessageRole(role)) {
      out.push(item as OpenAI.Chat.ChatCompletionMessageParam)
    }
  }
  return out.length > 0 ? out : undefined
}

export function normalizePersistedSubagentRuns(raw: unknown): PersistedSubagentRun[] {
  if (!Array.isArray(raw)) return []
  const out: PersistedSubagentRun[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Partial<PersistedSubagentRun>
    if (typeof entry.runId !== 'string' || !entry.runId.trim()) continue
    if (typeof entry.agentId !== 'string' || !entry.agentId.trim()) continue
    const status =
      entry.status === 'running' || entry.status === 'done' || entry.status === 'error'
        ? entry.status
        : 'error'
    out.push({
      runId: entry.runId,
      parentChatId:
        typeof entry.parentChatId === 'string' && entry.parentChatId.trim()
          ? entry.parentChatId
          : undefined,
      agentId: entry.agentId,
      description:
        typeof entry.description === 'string' && entry.description.trim()
          ? entry.description
          : entry.agentId,
      taskPrompt: typeof entry.taskPrompt === 'string' ? entry.taskPrompt : '',
      lastFollowUpPrompt:
        typeof entry.lastFollowUpPrompt === 'string'
          ? entry.lastFollowUpPrompt
          : undefined,
      modelKey: typeof entry.modelKey === 'string' ? entry.modelKey : undefined,
      modelLabel:
        typeof entry.modelLabel === 'string' && entry.modelLabel.trim()
          ? entry.modelLabel
          : '未配置',
      status,
      startedAt:
        typeof entry.startedAt === 'number' && Number.isFinite(entry.startedAt)
          ? entry.startedAt
          : Date.now(),
      text: typeof entry.text === 'string' ? entry.text : undefined,
      toolCallCount:
        typeof entry.toolCallCount === 'number' && Number.isFinite(entry.toolCallCount)
          ? entry.toolCallCount
          : undefined,
      incomplete: entry.incomplete === true,
      messages: normalizeMessages(entry.messages),
      error: typeof entry.error === 'string' ? entry.error : undefined,
      updatedAt:
        typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
          ? entry.updatedAt
          : Date.now(),
    })
  }
  return out
}

export function serializeSubagentRunsForPersist(
  states: readonly SubagentRunState[] = listRuns(),
): PersistedSubagentRun[] {
  return states.map((run) => {
    const result = run.result
    return {
      runId: run.runId,
      parentChatId: run.parentChatId,
      agentId: run.agentId,
      description: run.description,
      taskPrompt: run.taskPrompt,
      lastFollowUpPrompt: run.lastFollowUpPrompt,
      modelKey: run.modelKey,
      modelLabel: run.modelLabel,
      status: run.status,
      startedAt: run.startedAt,
      text: result?.text,
      toolCallCount: result?.toolCallCount,
      incomplete: result?.incomplete,
      messages: result?.messages,
      error: run.error,
      updatedAt: Date.now(),
    }
  })
}

export function persistedRunsToStoreStates(
  persisted: readonly PersistedSubagentRun[],
): SubagentRunState[] {
  return persisted.map((item) => {
    const result: VscodeAiAgentResult | undefined =
      item.messages || item.text !== undefined
        ? {
            text: item.text ?? item.error ?? '',
            toolCallCount: item.toolCallCount ?? 0,
            investigation: {
              activities: [],
              timeline: [],
              toolCallCount: item.toolCallCount ?? 0,
              durationMs: 0,
            },
            incomplete: item.incomplete,
            messages: item.messages,
          }
        : undefined
    return {
      runId: item.runId,
      agentId: item.agentId,
      description: item.description,
      parentChatId: item.parentChatId,
      taskPrompt: item.taskPrompt,
      lastFollowUpPrompt: item.lastFollowUpPrompt,
      modelKey: item.modelKey,
      modelLabel: item.modelLabel,
      status: item.status,
      startedAt: item.startedAt,
      liveProgress: undefined,
      result,
      contextUsage: undefined,
      error: item.error,
    }
  })
}

export function hydrateSubagentStoreFromPersisted(
  persisted: readonly PersistedSubagentRun[],
): void {
  hydrateRuns(persistedRunsToStoreStates(persisted))
}
