import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'

export type VscodeAiChatRole = 'user' | 'assistant'

export type VscodeAiPendingEdit = {
  id: string
  path: string
  previousText: string
  nextText: string
  status: 'pending' | 'applied' | 'rejected'
}

export type VscodeAiChatMessage = {
  id: string
  role: VscodeAiChatRole
  content: string
  createdAt: number
  isError?: boolean
  pendingEdits?: VscodeAiPendingEdit[]
  incomplete?: boolean
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

function clampMessages(messages: readonly VscodeAiChatMessage[]): VscodeAiChatMessage[] {
  let total = 0
  const next: VscodeAiChatMessage[] = []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message) continue
    const len = message.content.length
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
    entry.messages.filter(
      (message): message is VscodeAiChatMessage =>
        !!message &&
        typeof message === 'object' &&
        typeof message.id === 'string' &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string' &&
        typeof message.createdAt === 'number',
    ),
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
  extras?: Pick<VscodeAiChatMessage, 'isError' | 'pendingEdits' | 'incomplete'>,
): VscodeAiChatMessage {
  return {
    id: `vscode-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: Date.now(),
    isError: extras?.isError,
    pendingEdits: extras?.pendingEdits,
    incomplete: extras?.incomplete,
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
