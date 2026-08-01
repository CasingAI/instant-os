import type OpenAI from 'openai'
import type { VscodeAiAgentResult } from './vscode-ai-agent.ts'
import { truncateToolResultForStore } from './vscode-ai-agent.ts'
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
  /** 各轮用户侧 image_paths（仅路径） */
  userTurns?: Array<{ prompt: string; imagePaths?: string[] }>
  /** vision 首轮图片路径（详情 UI 兜底） */
  firstImagePaths?: string[]
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

function normalizeUserTurns(
  raw: unknown,
  fallbackPrompt: string,
): Array<{ prompt: string; imagePaths?: string[] }> {
  if (Array.isArray(raw) && raw.length > 0) {
    const out: Array<{ prompt: string; imagePaths?: string[] }> = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const entry = item as { prompt?: unknown; imagePaths?: unknown }
      const prompt = typeof entry.prompt === 'string' ? entry.prompt : ''
      const imagePaths = Array.isArray(entry.imagePaths)
        ? entry.imagePaths.filter(
            (path): path is string =>
              typeof path === 'string' && path.trim().startsWith('/'),
          )
        : undefined
      out.push({
        prompt,
        ...(imagePaths && imagePaths.length > 0 ? { imagePaths } : {}),
      })
    }
    if (out.length > 0) return out
  }
  return fallbackPrompt ? [{ prompt: fallbackPrompt }] : []
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
    const taskPrompt = typeof entry.taskPrompt === 'string' ? entry.taskPrompt : ''
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
      taskPrompt,
      lastFollowUpPrompt:
        typeof entry.lastFollowUpPrompt === 'string'
          ? entry.lastFollowUpPrompt
          : undefined,
      userTurns: normalizeUserTurns(entry.userTurns, taskPrompt),
      firstImagePaths: Array.isArray(entry.firstImagePaths)
        ? entry.firstImagePaths.filter(
            (path): path is string =>
              typeof path === 'string' && path.trim().startsWith('/'),
          )
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

function trimMessagesForPersist(
  messages: OpenAI.Chat.ChatCompletionMessageParam[] | undefined,
): OpenAI.Chat.ChatCompletionMessageParam[] | undefined {
  if (!messages || messages.length === 0) return messages
  return messages.map((item) => {
    if (
      (item.role === 'tool' || item.role === 'assistant' || item.role === 'user') &&
      typeof item.content === 'string'
    ) {
      return { ...item, content: truncateToolResultForStore(item.content) }
    }
    // 多模态 user：丢掉 data URL 像素，只留占位（预览靠 userTurns.imagePaths 读 VFS）
    if (item.role === 'user' && Array.isArray(item.content)) {
      const next = item.content.map((part) => {
        if (!part || typeof part !== 'object') return part
        const typed = part as {
          type?: unknown
          image_url?: { url?: unknown; detail?: unknown }
        }
        if (typed.type !== 'image_url') return part
        const url =
          typed.image_url &&
          typeof typed.image_url === 'object' &&
          typeof typed.image_url.url === 'string'
            ? typed.image_url.url
            : ''
        if (!url.startsWith('data:')) return part
        return {
          type: 'image_url' as const,
          image_url: { url: 'about:blank#vscode-ai-image-omitted' },
        }
      })
      return { ...item, content: next }
    }
    return item
  })
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
      taskPrompt: truncateToolResultForStore(run.taskPrompt),
      lastFollowUpPrompt: run.lastFollowUpPrompt
        ? truncateToolResultForStore(run.lastFollowUpPrompt)
        : undefined,
      userTurns: run.userTurns.map((turn) => ({
        prompt: truncateToolResultForStore(turn.prompt),
        ...(turn.imagePaths && turn.imagePaths.length > 0
          ? { imagePaths: turn.imagePaths }
          : {}),
      })),
      ...(run.firstImagePaths && run.firstImagePaths.length > 0
        ? { firstImagePaths: run.firstImagePaths }
        : {}),
      modelKey: run.modelKey,
      modelLabel: run.modelLabel,
      status: run.status,
      startedAt: run.startedAt,
      text: result?.text ? truncateToolResultForStore(result.text) : result?.text,
      toolCallCount: result?.toolCallCount,
      incomplete: result?.incomplete,
      messages: trimMessagesForPersist(result?.messages),
      error: run.error ? truncateToolResultForStore(run.error) : run.error,
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
    const userTurns = normalizeUserTurns(item.userTurns, item.taskPrompt)
    const firstFromTurn = userTurns[0]?.imagePaths
    return {
      runId: item.runId,
      agentId: item.agentId,
      description: item.description,
      parentChatId: item.parentChatId,
      taskPrompt: item.taskPrompt,
      lastFollowUpPrompt: item.lastFollowUpPrompt,
      userTurns,
      firstImagePaths:
        item.firstImagePaths && item.firstImagePaths.length > 0
          ? item.firstImagePaths
          : firstFromTurn && firstFromTurn.length > 0
            ? firstFromTurn
            : undefined,
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
