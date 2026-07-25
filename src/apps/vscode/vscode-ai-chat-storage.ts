import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import type { TerminalChangeKind } from '../../terminal/terminal-changeset.ts'
import type { VscodeAiInvestigation } from './vscode-ai-agent.ts'

export type VscodeAiChatRole = 'user' | 'assistant'

export type VscodeAiPendingEdit = {
  id: string
  path: string
  previousText: string
  nextText: string
  status: 'pending' | 'applied' | 'rejected'
}

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
  source: 'terminal' | 'npm'
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
  pendingEdits?: VscodeAiPendingEdit[]
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
}

export type VscodeAiChatSession = {
  id: string
  title: string
  messages: VscodeAiChatMessage[]
  updatedAt: number
}

export type VscodeAiClosedChatSession = VscodeAiChatSession & {
  closedAt: number
}

export type VscodeAiChatStore = {
  workspaceKey: string
  openSessions: VscodeAiChatSession[]
  closedSessions: VscodeAiClosedChatSession[]
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.vscodeAiChat
const MAX_MESSAGES = 80
const MAX_CONTENT_CHARS = 48_000
const MAX_CLOSED_SESSIONS = 10
const MAX_OPEN_SESSIONS = 20
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

function messageStoredLength(message: VscodeAiChatMessage): number {
  let len = message.content.length
  if (message.investigation) {
    try {
      len += JSON.stringify(message.investigation).length
    } catch {
      // ignore
    }
  }
  if (message.terminalChangeReview) {
    try {
      len += JSON.stringify(message.terminalChangeReview).length
    } catch {
      // ignore
    }
  }
  if (message.changeSessionIds?.length) {
    len += message.changeSessionIds.join(',').length
  }
  if (message.changePaths?.length) {
    len += message.changePaths.join(',').length
  }
  return len
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
  if (entry.source !== 'terminal' && entry.source !== 'npm') return undefined
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
      return [
        {
          kind: 'activity',
          id: item.id,
          label: item.label,
          detail: normalizeOptionalString(item.detail),
          content: normalizeOptionalString(item.content),
          result: normalizeOptionalString(item.result),
          done: item.done !== false,
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
    return []
  })
  if (timeline.length === 0 && entry.activities.length === 0) {
    return undefined
  }
  return {
    activities: entry.activities.flatMap((item): VscodeAiInvestigation['activities'] => {
      if (!item || typeof item !== 'object') return []
      if (typeof item.id !== 'string' || typeof item.label !== 'string') return []
      return [
        {
          id: item.id,
          label: item.label,
          detail: normalizeOptionalString(item.detail),
          content: normalizeOptionalString(item.content),
          result: normalizeOptionalString(item.result),
          done: item.done !== false,
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

function clampMessages(messages: readonly VscodeAiChatMessage[]): VscodeAiChatMessage[] {
  let total = 0
  const next: VscodeAiChatMessage[] = []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message) continue
    const len = messageStoredLength(message)
    if (total + len > MAX_CONTENT_CHARS) break
    total += len
    next.unshift(message)
  }
  return next.slice(-MAX_MESSAGES)
}

function normalizeSession(raw: unknown): VscodeAiChatSession | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const entry = raw as Partial<VscodeAiChatSession>
  if (typeof entry.id !== 'string' || !entry.id.trim()) return undefined
  if (!Array.isArray(entry.messages)) return undefined
  const messages = clampMessages(
    entry.messages
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
        let reviewStatus = normalizeReviewStatus(
          (message as { reviewStatus?: unknown }).reviewStatus,
        )
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
        }
      }),
  )
  const updatedAt =
    typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
      ? entry.updatedAt
      : messages[messages.length - 1]?.createdAt ?? Date.now()
  const title =
    typeof entry.title === 'string' && entry.title.trim()
      ? entry.title.trim()
      : titleFromVscodeAiMessages(messages)
  return { id: entry.id, title, messages, updatedAt }
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

function emptyStore(key: string): VscodeAiChatStore {
  return { workspaceKey: key, openSessions: [], closedSessions: [] }
}

export function buildVscodeAiChatSession(
  partial?: Partial<Pick<VscodeAiChatSession, 'id' | 'title' | 'messages' | 'updatedAt'>>,
): VscodeAiChatSession {
  const messages = clampMessages(partial?.messages ?? [])
  return {
    id: partial?.id ?? createVscodeAiChatSessionId(),
    title:
      partial?.title?.trim() ||
      titleFromVscodeAiMessages(messages) ||
      DEFAULT_TITLE,
    messages,
    updatedAt: partial?.updatedAt ?? Date.now(),
  }
}

export function loadVscodeAiChatStore(workspaceFolder: string | undefined): VscodeAiChatStore {
  const key = workspaceKey(workspaceFolder)
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyStore(key)
    const parsed = JSON.parse(raw) as {
      workspaceKey?: string
      messages?: VscodeAiChatMessage[]
      openSessions?: unknown[]
      closedSessions?: unknown[]
    }
    if (parsed.workspaceKey !== key) return emptyStore(key)

    // 旧版：单线程 messages
    if (!Array.isArray(parsed.openSessions) && Array.isArray(parsed.messages)) {
      const messages = clampMessages(parsed.messages)
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
      .slice(0, MAX_OPEN_SESSIONS)
    const closedSessions = (parsed.closedSessions ?? [])
      .map(normalizeClosedSession)
      .filter((session): session is VscodeAiClosedChatSession => session !== undefined)
      .sort((a, b) => b.closedAt - a.closedAt)
      .slice(0, MAX_CLOSED_SESSIONS)

    return { workspaceKey: key, openSessions, closedSessions }
  } catch {
    return emptyStore(key)
  }
}

export function saveVscodeAiChatStore(store: VscodeAiChatStore): void {
  writeLocalStorageItem(
    STORAGE_KEY,
    JSON.stringify({
      workspaceKey: store.workspaceKey,
      openSessions: store.openSessions.slice(0, MAX_OPEN_SESSIONS).map((session) => ({
        ...session,
        messages: clampMessages(session.messages),
        title: session.title.trim() || titleFromVscodeAiMessages(session.messages),
      })),
      closedSessions: store.closedSessions
        .slice(0, MAX_CLOSED_SESSIONS)
        .map((session) => ({
          ...session,
          messages: clampMessages(session.messages),
          title: session.title.trim() || titleFromVscodeAiMessages(session.messages),
        })),
    }),
  )
}

/** @deprecated 兼容旧单线程 API；新代码请用 loadVscodeAiChatStore */
export type VscodeAiChatThread = {
  workspaceKey: string
  messages: VscodeAiChatMessage[]
}

/** @deprecated */
export function loadVscodeAiChatThread(workspaceFolder: string | undefined): VscodeAiChatThread {
  const store = loadVscodeAiChatStore(workspaceFolder)
  return {
    workspaceKey: store.workspaceKey,
    messages: store.openSessions[0]?.messages ?? [],
  }
}

/** @deprecated */
export function saveVscodeAiChatThread(thread: VscodeAiChatThread): void {
  const existing = loadVscodeAiChatStore(
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
  saveVscodeAiChatStore({
    workspaceKey: thread.workspaceKey,
    openSessions,
    closedSessions: existing.closedSessions,
  })
}

export function createVscodeAiChatMessage(
  role: VscodeAiChatRole,
  content: string,
  extras?: Pick<
    VscodeAiChatMessage,
    | 'isError'
    | 'pendingEdits'
    | 'terminalChangeReview'
    | 'changeSessionIds'
    | 'changePaths'
    | 'reviewStatus'
    | 'incomplete'
    | 'investigation'
    | 'systemReminder'
  >,
): VscodeAiChatMessage {
  return {
    id: `vscode-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: Date.now(),
    isError: extras?.isError,
    pendingEdits: extras?.pendingEdits,
    terminalChangeReview: extras?.terminalChangeReview,
    changeSessionIds: extras?.changeSessionIds,
    changePaths: extras?.changePaths,
    reviewStatus: extras?.reviewStatus,
    incomplete: extras?.incomplete,
    investigation: extras?.investigation,
    systemReminder: extras?.systemReminder,
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
    messages: clampMessages(session.messages),
    closedAt: Date.now(),
  }
  return [entry, ...closed.filter((item) => item.id !== entry.id)].slice(0, MAX_CLOSED_SESSIONS)
}
