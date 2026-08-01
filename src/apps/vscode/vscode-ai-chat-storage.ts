import {
  DATA_META_STORE,
  DATA_STORAGE_CHANGED_EVENT,
  DeviceDataStorageFullError,
  runDataStoreTransaction,
  VSCODE_AI_CHAT_STORE,
  wouldExceedDataCapacity,
} from '../../os/device-data-storage.ts'
import type { TerminalChangeKind } from '../../terminal/terminal-changeset.ts'
import type OpenAI from 'openai'
import {
  trimInvestigationForPersist,
  truncateToolResultForStore,
  type VscodeAiInvestigation,
} from './vscode-ai-agent.ts'
import {
  normalizeVscodeAiImageAttachments,
  type VscodeAiImageAttachment,
} from './vscode-ai-attachments.ts'
import { normalizeVscodeAiMode, type VscodeAiMode } from './vscode-ai-mode.ts'
import type { VscodeAiLastSentTerminal } from './vscode-ai-system-reminder.ts'
import type { VscodeModelSource } from './vscode-prefs.ts'
import type { PersistedSubagentRun } from './vscode-subagent-persistence.ts'
import { normalizePersistedSubagentRuns } from './vscode-subagent-persistence.ts'
import type { VscodeAgentTerminalSnapshot } from './vscode-terminal-sessions.ts'

export type VscodeAiChatRole = 'user' | 'assistant'

/** Agent 受控终端/npm 本轮已写入的改动审查（Keep=保留，Revert=整轮回滚） */
export type VscodeAiTerminalChangeReviewFile = {
  path: string
  kind: TerminalChangeKind
  fromPath?: string
  beforeBlobId?: string
  isDirectory?: boolean
  byteSize?: number
}

export type VscodeAiTerminalChangeReview = {
  sessionId: string
  source: 'terminal' | 'npm' | 'github'
  sealedAt: number
  status: 'pending' | 'kept' | 'reverted'
  files: VscodeAiTerminalChangeReviewFile[]
}

export type VscodeAiReviewStatus = 'pending' | 'kept' | 'reverted'

export type VscodeAiChatMessage = {
  id: string
  role: VscodeAiChatRole
  content: string
  createdAt: number
  isError?: boolean
  /** @deprecated 旧气泡审查卡；仅兼容存储，UI 不再展示 */
  terminalChangeReview?: VscodeAiTerminalChangeReview
  /** 本轮 Agent 产生的受控 ChangeSet sessionId（时间序） */
  changeSessionIds?: string[]
  /** 本轮涉及路径（去重，供审查条计数） */
  changePaths?: string[]
  /** 是否仍计入输入框上方未审查改动 */
  reviewStatus?: VscodeAiReviewStatus
  incomplete?: boolean
  investigation?: VscodeAiInvestigation
  /** 本轮发给模型的 system-reminder 正文（不含标签；debug 展示用） */
  systemReminder?: string
  /** 本轮发送时的 AI 模式（user 消息） */
  sentMode?: VscodeAiMode
  /** 本轮发送时的模型来源（user 消息） */
  sentModelSource?: VscodeModelSource
  /** 本轮发送时的指定模型键（仅 sentModelSource === 'custom'） */
  sentModelKey?: string
  /** 用户附加的图片（仅路径元数据，不含 blob） */
  attachments?: VscodeAiImageAttachment[]
  /** Plan 模式本轮 write_plan 落盘路径（供消息下计划气泡） */
  planPath?: string
  /** 计划 Markdown 首个一级标题（气泡左侧展示） */
  planTitle?: string
  /**
   * 由「用 Agent 实施」创建的 user 消息：指向带 plan 的 assistant.id。
   * UI 用「其后是否存在该链接」推导计划条是否已实施。
   */
  implementsPlanMessageId?: string
}

export type VscodeAiChatSession = {
  id: string
  title: string
  messages: VscodeAiChatMessage[]
  updatedAt: number
  /** 上一轮发送时本模式绑定的 AI 终端快照（供 system-reminder 事件对比） */
  lastSentTerminal?: VscodeAiLastSentTerminal
  /**
   * 规范 API transcript（不含当前轮 system；含 tool 轨）。
   * 用于编辑重发时恢复未压缩上下文；关闭进 closed 时可丢弃。
   */
  apiTranscript?: OpenAI.Chat.ChatCompletionMessageParam[]
}

export type VscodeAiClosedChatSession = VscodeAiChatSession & {
  closedAt: number
}

export type VscodeAiChatStore = {
  workspaceKey: string
  openSessions: VscodeAiChatSession[]
  closedSessions: VscodeAiClosedChatSession[]
  /** 上次保存时聚焦的编辑器类型（与 activeSessionId 配合恢复 AI 标签焦点） */
  lastFocusedEditor?: 'file' | 'aiChat'
  /** lastFocusedEditor === 'aiChat' 时对应的 sessionId */
  activeSessionId?: string
  /** Sub Agent 私聊线程（长期存，供崩溃后续聊） */
  subagentRuns?: PersistedSubagentRun[]
}

type VscodeAiChatDbRecord = VscodeAiChatStore & {
  byteSize: number
}

/** 关闭历史软上限：仅 LRU 丢弃最旧 closed，不裁剪 open 会话正文 */
const MAX_CLOSED_SESSIONS = 30
const DEFAULT_TITLE = '新对话'

function workspaceKey(folder: string | undefined): string {
  const trimmed = folder?.trim() || ''
  return trimmed || '__no_workspace__'
}

export function vscodeAiChatWorkspaceKey(folder: string | undefined): string {
  return workspaceKey(folder)
}

let sessionSeq = 0

export function createVscodeAiChatSessionId(): string {
  sessionSeq += 1
  return `vscode-ai-session-${Date.now()}-${sessionSeq}`
}

export function titleFromVscodeAiMessages(messages: readonly VscodeAiChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === 'user' && message.content.trim())
  if (!firstUser) return DEFAULT_TITLE
  const compact = firstUser.content.trim().replace(/\s+/g, ' ')
  if (compact.length <= 28) return compact
  return `${compact.slice(0, 28)}…`
}

function normalizeStringList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const list = raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return list.length > 0 ? list : undefined
}

function normalizeReviewStatus(raw: unknown): VscodeAiReviewStatus | undefined {
  if (raw === 'pending' || raw === 'kept' || raw === 'reverted') return raw
  return undefined
}

const CHANGE_KINDS = new Set<TerminalChangeKind>(['added', 'modified', 'deleted', 'renamed'])

function normalizeTerminalChangeReview(raw: unknown): VscodeAiTerminalChangeReview | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const entry = raw as Partial<VscodeAiTerminalChangeReview>
  if (typeof entry.sessionId !== 'string' || !entry.sessionId.trim()) return undefined
  if (entry.source !== 'terminal' && entry.source !== 'npm' && entry.source !== 'github') {
    return undefined
  }
  if (typeof entry.sealedAt !== 'number' || !Number.isFinite(entry.sealedAt)) return undefined
  if (entry.status !== 'pending' && entry.status !== 'kept' && entry.status !== 'reverted') {
    return undefined
  }
  if (!Array.isArray(entry.files) || entry.files.length === 0) return undefined
  const files = entry.files.filter(
    (file): file is VscodeAiTerminalChangeReviewFile =>
      !!file &&
      typeof file === 'object' &&
      typeof file.path === 'string' &&
      CHANGE_KINDS.has(file.kind),
  )
  if (files.length === 0) return undefined
  return {
    sessionId: entry.sessionId,
    source: entry.source,
    sealedAt: entry.sealedAt,
    status: entry.status,
    files,
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

/** 从活动字段或工具结果头 `run_id=` 恢复 Sub Agent 详情入口 id */
function normalizeSubagentRunId(
  value: unknown,
  result?: string,
): string | undefined {
  const fromField = normalizeOptionalString(value)
  if (fromField) return fromField
  if (!result) return undefined
  const match = /(?:^|[ ·])run_id=([^\s·]+)/.exec(result)
  return match?.[1] ? match[1] : undefined
}

function normalizeSentModelSource(value: unknown): VscodeModelSource | undefined {
  if (value === 'text-secondary' || value === 'text' || value === 'custom') {
    return value
  }
  return undefined
}

function normalizeLastSentTerminal(raw: unknown): VscodeAiLastSentTerminal | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const entry = raw as {
    kind?: unknown
    snapshot?: Partial<VscodeAgentTerminalSnapshot>
  }
  if (entry.kind !== 'ask' && entry.kind !== 'plan' && entry.kind !== 'agent') return undefined
  const snapshot = entry.snapshot
  if (!snapshot || typeof snapshot !== 'object') return undefined
  if (
    snapshot.status !== 'none' &&
    snapshot.status !== 'alive' &&
    snapshot.status !== 'closed'
  ) {
    return undefined
  }
  return {
    kind: entry.kind,
    snapshot: {
      status: snapshot.status,
      sessionId: normalizeOptionalString(snapshot.sessionId),
      cwd: normalizeOptionalString(snapshot.cwd),
      tmpdir: normalizeOptionalString(snapshot.tmpdir),
      recovering: snapshot.recovering === true ? true : undefined,
    },
  }
}

function normalizeInvestigation(raw: unknown): VscodeAiInvestigation | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const entry = raw as Partial<VscodeAiInvestigation>
  if (!Array.isArray(entry.timeline) || !Array.isArray(entry.activities)) return undefined
  if (typeof entry.toolCallCount !== 'number' || typeof entry.durationMs !== 'number') {
    return undefined
  }
  const timeline = entry.timeline.flatMap((item): VscodeAiInvestigation['timeline'] => {
    if (!item || typeof item !== 'object') return []
    if (item.kind === 'activity') {
      if (typeof item.id !== 'string' || typeof item.label !== 'string') return []
      const result = normalizeOptionalString(item.result)
      return [
        {
          kind: 'activity',
          id: item.id,
          label: item.label,
          detail: normalizeOptionalString(item.detail),
          content: normalizeOptionalString(item.content),
          result,
          done: item.done !== false,
          subagentRunId: normalizeSubagentRunId(item.subagentRunId, result),
        },
      ]
    }
    if (item.kind === 'reasoning') {
      if (
        typeof item.id !== 'string' ||
        typeof item.content !== 'string' ||
        typeof item.startedAt !== 'number'
      ) {
        return []
      }
      return [
        {
          kind: 'reasoning',
          id: item.id,
          content: item.content,
          done: item.done !== false,
          startedAt: item.startedAt,
          durationMs:
            typeof item.durationMs === 'number' && Number.isFinite(item.durationMs)
              ? item.durationMs
              : undefined,
        },
      ]
    }
    if (item.kind === 'write') {
      if (
        typeof item.id !== 'string' ||
        typeof item.toolName !== 'string' ||
        typeof item.title !== 'string' ||
        typeof item.preview !== 'string'
      ) {
        return []
      }
      const phase =
        item.phase === 'streaming' || item.phase === 'writing' || item.phase === 'done'
          ? item.phase
          : 'done'
      return [
        {
          kind: 'write',
          id: item.id,
          toolName: item.toolName,
          title: item.title,
          preview: item.preview,
          phase: item.done === false ? phase : 'done',
          done: item.done !== false,
          result: normalizeOptionalString(item.result),
        },
      ]
    }
    if (item.kind === 'compression') {
      if (
        typeof item.id !== 'string' ||
        typeof item.label !== 'string' ||
        typeof item.beforeTokens !== 'number' ||
        typeof item.afterTokens !== 'number' ||
        typeof item.compressionKind !== 'string'
      ) {
        return []
      }
      return [
        {
          kind: 'compression',
          id: item.id,
          label: item.label,
          detail: normalizeOptionalString(item.detail),
          summaryPreview: normalizeOptionalString(item.summaryPreview),
          beforeTokens: item.beforeTokens,
          afterTokens: item.afterTokens,
          compressionKind: item.compressionKind as Extract<
            VscodeAiInvestigation['timeline'][number],
            { kind: 'compression' }
          >['compressionKind'],
          done: true,
        },
      ]
    }
    return []
  })
  if (timeline.length === 0 && entry.activities.length === 0) {
    return undefined
  }
  return {
    activities: entry.activities.flatMap((item): VscodeAiInvestigation['activities'] => {
      if (!item || typeof item !== 'object') return []
      if (typeof item.id !== 'string' || typeof item.label !== 'string') return []
      const result = normalizeOptionalString(item.result)
      return [
        {
          id: item.id,
          label: item.label,
          detail: normalizeOptionalString(item.detail),
          content: normalizeOptionalString(item.content),
          result,
          done: item.done !== false,
          subagentRunId: normalizeSubagentRunId(item.subagentRunId, result),
        },
      ]
    }),
    timeline,
    reasoningText:
      typeof entry.reasoningText === 'string' && entry.reasoningText.trim()
        ? entry.reasoningText
        : undefined,
    reasoningDurationMs:
      typeof entry.reasoningDurationMs === 'number' && Number.isFinite(entry.reasoningDurationMs)
        ? entry.reasoningDurationMs
        : undefined,
    toolCallCount: entry.toolCallCount,
    durationMs: entry.durationMs,
  }
}

function normalizeMessages(raw: unknown): VscodeAiChatMessage[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (message): message is VscodeAiChatMessage =>
        !!message &&
        typeof message === 'object' &&
        typeof message.id === 'string' &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string' &&
        typeof message.createdAt === 'number',
    )
    .map((message) => {
      const investigation = normalizeInvestigation(
        (message as { investigation?: unknown }).investigation,
      )
      const terminalChangeReview = normalizeTerminalChangeReview(
        (message as { terminalChangeReview?: unknown }).terminalChangeReview,
      )
      const changeSessionIds = normalizeStringList(
        (message as { changeSessionIds?: unknown }).changeSessionIds,
      )
      const changePaths = normalizeStringList((message as { changePaths?: unknown }).changePaths)
      let reviewStatus = normalizeReviewStatus((message as { reviewStatus?: unknown }).reviewStatus)
      if (!reviewStatus && terminalChangeReview) {
        reviewStatus = terminalChangeReview.status
      }
      if (!reviewStatus && changeSessionIds?.length) {
        reviewStatus = 'pending'
      }
      return {
        ...message,
        investigation,
        terminalChangeReview,
        changeSessionIds,
        changePaths:
          changePaths ??
          (terminalChangeReview
            ? [...new Set(terminalChangeReview.files.map((file) => file.path))]
            : undefined),
        reviewStatus,
        systemReminder: normalizeOptionalString(
          (message as { systemReminder?: unknown }).systemReminder,
        ),
        sentMode: (() => {
          const raw = (message as { sentMode?: unknown }).sentMode
          if (raw === undefined || raw === null) return undefined
          return normalizeVscodeAiMode(raw)
        })(),
        sentModelSource: normalizeSentModelSource(
          (message as { sentModelSource?: unknown }).sentModelSource,
        ),
        sentModelKey: normalizeOptionalString(
          (message as { sentModelKey?: unknown }).sentModelKey,
        ),
        attachments: normalizeVscodeAiImageAttachments(
          (message as { attachments?: unknown }).attachments,
        ),
        planPath: normalizeOptionalString((message as { planPath?: unknown }).planPath),
        planTitle: normalizeOptionalString((message as { planTitle?: unknown }).planTitle),
        implementsPlanMessageId: normalizeOptionalString(
          (message as { implementsPlanMessageId?: unknown }).implementsPlanMessageId,
        ),
      }
    })
}

function normalizeApiTranscript(
  raw: unknown,
): OpenAI.Chat.ChatCompletionMessageParam[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const role = (item as { role?: unknown }).role
    if (role === 'system' || role === 'user' || role === 'assistant' || role === 'tool') {
      out.push(item as OpenAI.Chat.ChatCompletionMessageParam)
    }
  }
  return out.length > 0 ? out : undefined
}

function normalizeSession(raw: unknown): VscodeAiChatSession | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const entry = raw as Partial<VscodeAiChatSession>
  if (typeof entry.id !== 'string' || !entry.id.trim()) return undefined
  if (!Array.isArray(entry.messages)) return undefined
  const messages = normalizeMessages(entry.messages)
  const updatedAt =
    typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
      ? entry.updatedAt
      : messages[messages.length - 1]?.createdAt ?? Date.now()
  const title =
    typeof entry.title === 'string' && entry.title.trim()
      ? entry.title.trim()
      : titleFromVscodeAiMessages(messages)
  const lastSentTerminal = normalizeLastSentTerminal(
    (entry as { lastSentTerminal?: unknown }).lastSentTerminal,
  )
  const apiTranscript = normalizeApiTranscript(
    (entry as { apiTranscript?: unknown }).apiTranscript,
  )
  return {
    id: entry.id,
    title,
    messages,
    updatedAt,
    lastSentTerminal,
    ...(apiTranscript ? { apiTranscript } : {}),
  }
}

function normalizeClosedSession(raw: unknown): VscodeAiClosedChatSession | undefined {
  const session = normalizeSession(raw)
  if (!session) return undefined
  const closedAt =
    raw && typeof raw === 'object' && typeof (raw as { closedAt?: unknown }).closedAt === 'number'
      ? (raw as { closedAt: number }).closedAt
      : session.updatedAt
  return { ...session, closedAt }
}

function normalizeLastFocusedEditor(raw: unknown): 'file' | 'aiChat' | undefined {
  if (raw === 'file' || raw === 'aiChat') return raw
  return undefined
}

function normalizeActiveSessionId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function emptyStore(key: string): VscodeAiChatStore {
  return { workspaceKey: key, openSessions: [], closedSessions: [] }
}

function trimClosedSessions(
  closed: readonly VscodeAiClosedChatSession[],
): VscodeAiClosedChatSession[] {
  return [...closed]
    .sort((a, b) => b.closedAt - a.closedAt)
    .slice(0, MAX_CLOSED_SESSIONS)
    .map((session) => {
      const { apiTranscript: _drop, ...rest } = session
      return {
        ...rest,
        title: session.title.trim() || titleFromVscodeAiMessages(session.messages),
        messages: trimChatMessagesForPersist(session.messages),
      }
    })
}

function truncateOptionalText(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  return truncateToolResultForStore(text)
}

function trimChatMessagesForPersist(
  messages: readonly VscodeAiChatMessage[],
): VscodeAiChatMessage[] {
  return messages.map((message) => ({
    ...message,
    content: truncateToolResultForStore(message.content),
    investigation: message.investigation
      ? trimInvestigationForPersist(message.investigation)
      : undefined,
  }))
}

function trimApiTranscriptForPersist(
  transcript: OpenAI.Chat.ChatCompletionMessageParam[] | undefined,
): OpenAI.Chat.ChatCompletionMessageParam[] | undefined {
  if (!transcript || transcript.length === 0) return transcript
  return transcript.map((item) => {
    if (item.role === 'tool' && typeof item.content === 'string') {
      return { ...item, content: truncateToolResultForStore(item.content) }
    }
    if (item.role === 'assistant' && typeof item.content === 'string') {
      return { ...item, content: truncateToolResultForStore(item.content) }
    }
    if (item.role === 'user' && typeof item.content === 'string') {
      return { ...item, content: truncateToolResultForStore(item.content) }
    }
    return item
  })
}

function prepareStoreForSave(store: VscodeAiChatStore): VscodeAiChatStore {
  const openSessions = store.openSessions.map((session) => ({
    ...session,
    title: session.title.trim() || titleFromVscodeAiMessages(session.messages),
    messages: trimChatMessagesForPersist(session.messages),
    apiTranscript: trimApiTranscriptForPersist(session.apiTranscript),
  }))
  const closedSessions = trimClosedSessions(store.closedSessions)
  const lastFocusedEditor = store.lastFocusedEditor
  const activeSessionId = store.activeSessionId
  const subagentRuns =
    store.subagentRuns && store.subagentRuns.length > 0
      ? store.subagentRuns.map((run) => ({
          ...run,
          text: truncateOptionalText(run.text),
          error: truncateOptionalText(run.error),
          taskPrompt: truncateToolResultForStore(run.taskPrompt),
          lastFollowUpPrompt: truncateOptionalText(run.lastFollowUpPrompt),
          messages: run.messages
            ? (trimApiTranscriptForPersist(run.messages) as typeof run.messages)
            : undefined,
        }))
      : undefined
  return {
    workspaceKey: store.workspaceKey,
    openSessions,
    closedSessions,
    lastFocusedEditor,
    activeSessionId:
      lastFocusedEditor === 'aiChat' &&
      activeSessionId &&
      openSessions.some((session) => session.id === activeSessionId)
        ? activeSessionId
        : undefined,
    ...(subagentRuns ? { subagentRuns } : {}),
  }
}

function normalizeStore(raw: unknown, key: string): VscodeAiChatStore {
  if (!raw || typeof raw !== 'object') return emptyStore(key)
  const parsed = raw as {
    workspaceKey?: string
    messages?: unknown
    openSessions?: unknown[]
    closedSessions?: unknown[]
    lastFocusedEditor?: unknown
    activeSessionId?: unknown
    subagentRuns?: unknown
  }
  if (parsed.workspaceKey && parsed.workspaceKey !== key) return emptyStore(key)

  if (!Array.isArray(parsed.openSessions) && Array.isArray(parsed.messages)) {
    const messages = normalizeMessages(parsed.messages)
    if (messages.length === 0) return emptyStore(key)
    return {
      workspaceKey: key,
      openSessions: [
        buildVscodeAiChatSession({
          messages,
          updatedAt: messages[messages.length - 1]?.createdAt ?? Date.now(),
        }),
      ],
      closedSessions: [],
    }
  }

  const openSessions = (parsed.openSessions ?? [])
    .map(normalizeSession)
    .filter((session): session is VscodeAiChatSession => session !== undefined)
  const closedSessions = (parsed.closedSessions ?? [])
    .map(normalizeClosedSession)
    .filter((session): session is VscodeAiClosedChatSession => session !== undefined)

  const lastFocusedEditor = normalizeLastFocusedEditor(parsed.lastFocusedEditor)
  const activeSessionId = normalizeActiveSessionId(parsed.activeSessionId)
  const subagentRuns = normalizePersistedSubagentRuns(parsed.subagentRuns)

  return prepareStoreForSave({
    workspaceKey: key,
    openSessions,
    closedSessions,
    lastFocusedEditor,
    activeSessionId,
    ...(subagentRuns.length > 0 ? { subagentRuns } : {}),
  })
}

function estimateStoreBytes(store: VscodeAiChatStore): number {
  return new TextEncoder().encode(JSON.stringify(store)).length
}

async function readByteTotal(): Promise<number> {
  try {
    const meta = await runDataStoreTransaction<{ totalBytes?: number } | undefined>(
      DATA_META_STORE,
      'readonly',
      (store) => store.get('byte-total'),
    )
    return meta?.totalBytes ?? 0
  } catch {
    return 0
  }
}

async function writeByteTotal(totalBytes: number): Promise<void> {
  await runDataStoreTransaction(DATA_META_STORE, 'readwrite', (store) =>
    store.put({ key: 'byte-total', totalBytes }),
  )
}

function emitDataStorageChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DATA_STORAGE_CHANGED_EVENT))
  }
}

export function buildVscodeAiChatSession(
  partial?: Partial<
    Pick<VscodeAiChatSession, 'id' | 'title' | 'messages' | 'updatedAt' | 'lastSentTerminal'>
  >,
): VscodeAiChatSession {
  const messages = normalizeMessages(partial?.messages ?? [])
  return {
    id: partial?.id ?? createVscodeAiChatSessionId(),
    title:
      partial?.title?.trim() ||
      titleFromVscodeAiMessages(messages) ||
      DEFAULT_TITLE,
    messages,
    updatedAt: partial?.updatedAt ?? Date.now(),
    lastSentTerminal: partial?.lastSentTerminal,
  }
}

export async function loadVscodeAiChatStore(
  workspaceFolder: string | undefined,
): Promise<VscodeAiChatStore> {
  const key = workspaceKey(workspaceFolder)
  try {
    const record = await runDataStoreTransaction<VscodeAiChatDbRecord | undefined>(
      VSCODE_AI_CHAT_STORE,
      'readonly',
      (store) => store.get(key),
    )
    if (!record) return emptyStore(key)
    return normalizeStore(record, key)
  } catch {
    return emptyStore(key)
  }
}

export async function saveVscodeAiChatStore(store: VscodeAiChatStore): Promise<void> {
  const prepared = prepareStoreForSave(store)
  const byteSize = estimateStoreBytes(prepared)

  let previousByteSize = 0
  try {
    const existing = await runDataStoreTransaction<VscodeAiChatDbRecord | undefined>(
      VSCODE_AI_CHAT_STORE,
      'readonly',
      (store) => store.get(prepared.workspaceKey),
    )
    previousByteSize = existing?.byteSize ?? 0
  } catch {
    previousByteSize = 0
  }

  const currentTotal = await readByteTotal()
  const projectedTotal = currentTotal - previousByteSize + byteSize
  if (await wouldExceedDataCapacity(projectedTotal)) {
    throw new DeviceDataStorageFullError()
  }

  const dbRecord: VscodeAiChatDbRecord = {
    ...prepared,
    byteSize,
  }

  await runDataStoreTransaction(VSCODE_AI_CHAT_STORE, 'readwrite', (store) => store.put(dbRecord))
  await writeByteTotal(Math.max(0, projectedTotal))
  emitDataStorageChanged()
}

export async function getVscodeAiChatBytes(): Promise<number> {
  try {
    const records = await runDataStoreTransaction<Array<{ byteSize?: number }>>(
      VSCODE_AI_CHAT_STORE,
      'readonly',
      (store) => store.getAll(),
    )
    return records.reduce((total, record) => total + (record.byteSize ?? 0), 0)
  } catch {
    return 0
  }
}

/** @deprecated 兼容旧单线程 API；新代码请用 loadVscodeAiChatStore */
export type VscodeAiChatThread = {
  workspaceKey: string
  messages: VscodeAiChatMessage[]
}

/** @deprecated */
export async function loadVscodeAiChatThread(
  workspaceFolder: string | undefined,
): Promise<VscodeAiChatThread> {
  const store = await loadVscodeAiChatStore(workspaceFolder)
  return {
    workspaceKey: store.workspaceKey,
    messages: store.openSessions[0]?.messages ?? [],
  }
}

/** @deprecated */
export async function saveVscodeAiChatThread(thread: VscodeAiChatThread): Promise<void> {
  const existing = await loadVscodeAiChatStore(
    thread.workspaceKey === '__no_workspace__' ? undefined : thread.workspaceKey,
  )
  const first = existing.openSessions[0]
  const openSessions =
    thread.messages.length === 0 && !first
      ? []
      : [
          buildVscodeAiChatSession({
            id: first?.id,
            messages: thread.messages,
            updatedAt: Date.now(),
          }),
          ...existing.openSessions.slice(1),
        ]
  await saveVscodeAiChatStore({
    workspaceKey: thread.workspaceKey,
    openSessions,
    closedSessions: existing.closedSessions,
  })
}

export function createVscodeAiChatMessage(
  role: VscodeAiChatRole,
  content: string,
  extras?: Partial<Pick<
    VscodeAiChatMessage,
    | 'id'
    | 'createdAt'
    | 'isError'
    | 'terminalChangeReview'
    | 'changeSessionIds'
    | 'changePaths'
    | 'reviewStatus'
    | 'incomplete'
    | 'investigation'
    | 'systemReminder'
    | 'sentMode'
    | 'sentModelSource'
    | 'sentModelKey'
    | 'attachments'
    | 'planPath'
    | 'planTitle'
    | 'implementsPlanMessageId'
  >>,
): VscodeAiChatMessage {
  return {
    id: extras?.id ?? `vscode-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: extras?.createdAt ?? Date.now(),
    isError: extras?.isError,
    terminalChangeReview: extras?.terminalChangeReview,
    changeSessionIds: extras?.changeSessionIds,
    changePaths: extras?.changePaths,
    reviewStatus: extras?.reviewStatus,
    incomplete: extras?.incomplete,
    investigation: extras?.investigation,
    systemReminder: extras?.systemReminder,
    sentMode: extras?.sentMode,
    sentModelSource: extras?.sentModelSource,
    sentModelKey: extras?.sentModelKey,
    attachments: extras?.attachments,
    planPath: extras?.planPath,
    planTitle: extras?.planTitle,
    implementsPlanMessageId: extras?.implementsPlanMessageId,
  }
}

export function pushClosedVscodeAiChatSession(
  closed: readonly VscodeAiClosedChatSession[],
  session: VscodeAiChatSession,
): VscodeAiClosedChatSession[] {
  if (session.messages.length === 0) return [...closed]
  const entry: VscodeAiClosedChatSession = {
    ...session,
    title: session.title.trim() || titleFromVscodeAiMessages(session.messages),
    closedAt: Date.now(),
  }
  return trimClosedSessions([entry, ...closed.filter((item) => item.id !== entry.id)])
}
