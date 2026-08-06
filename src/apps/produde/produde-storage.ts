import { osNowMs } from '../../os/os-clock.ts'
import {
  DEVICE_STORAGE_KEYS,
  getLocalStorageKeyBytes,
  writeLocalStorageItem,
} from '../../os/device-storage.ts'
import type { ProdudeMessage, ProdudeSession, ProdudeStore } from './produde-types.ts'
import { PRODUDE_DEFAULT_WORKSPACE } from './produde-types.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.produde

const SESSION_EMOJIS = [
  '🛠️',
  '💻',
  '🔧',
  '⚙️',
  '🧠',
  '📦',
  '🗂️',
  '⚡',
  '🚀',
  '🧩',
  '📝',
  '🔍',
] as const

export function deriveSessionEmoji(sessionId: string): string {
  let hash = 0
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) >>> 0
  }
  return SESSION_EMOJIS[hash % SESSION_EMOJIS.length]
}

function normalizeWorkspace(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  return PRODUDE_DEFAULT_WORKSPACE
}

function normalizeSession(session: ProdudeSession): ProdudeSession {
  return {
    ...session,
    emoji: session.emoji || deriveSessionEmoji(session.id),
    workspaceFolder: normalizeWorkspace(session.workspaceFolder),
    modelSource:
      session.modelSource === 'text-secondary' || session.modelSource === 'custom'
        ? session.modelSource
        : 'text',
    messages: Array.isArray(session.messages) ? session.messages : [],
  }
}

function normalizeStore(store: ProdudeStore): ProdudeStore {
  return {
    ...store,
    sessions: store.sessions.map(normalizeSession),
  }
}

function emptyStore(): ProdudeStore {
  return { sessions: [] }
}

function loadStore(): ProdudeStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return emptyStore()
    }
    const parsed = JSON.parse(raw) as ProdudeStore
    if (!Array.isArray(parsed.sessions)) {
      return emptyStore()
    }
    return normalizeStore({
      sessions: parsed.sessions,
      activeSessionId: parsed.activeSessionId,
    })
  } catch {
    return emptyStore()
  }
}

export function readProdudeStore(): ProdudeStore {
  return loadStore()
}

export function writeProdudeStore(store: ProdudeStore): boolean {
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(store))
}

export function getProdudeStorageBytes(): number {
  return getLocalStorageKeyBytes(STORAGE_KEY)
}

export function createSessionId(): string {
  return `produde-${osNowMs()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createMessageId(): string {
  return `produde-msg-${osNowMs()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createSession(
  options?: Partial<Pick<ProdudeSession, 'workspaceFolder' | 'modelSource' | 'modelKey'>>,
): ProdudeSession {
  const now = osNowMs()
  const id = createSessionId()
  return {
    id,
    title: '新对话',
    emoji: deriveSessionEmoji(id),
    messages: [],
    workspaceFolder: normalizeWorkspace(options?.workspaceFolder),
    modelSource: options?.modelSource ?? 'text',
    modelKey: options?.modelKey,
    createdAt: now,
    updatedAt: now,
  }
}

export function createMessage(
  role: ProdudeMessage['role'],
  content: string,
  options?: { isError?: boolean; investigation?: ProdudeMessage['investigation'] },
): ProdudeMessage {
  return {
    id: createMessageId(),
    role,
    content: content.trim(),
    createdAt: osNowMs(),
    isError: options?.isError,
    investigation: options?.investigation,
  }
}

export function deriveSessionTitle(messages: ProdudeMessage[]): string {
  const firstUser = messages.find((message) => message.role === 'user')
  if (!firstUser?.content) {
    return '新对话'
  }
  const trimmed = firstUser.content.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= 18) {
    return trimmed
  }
  return `${trimmed.slice(0, 18)}…`
}

export function upsertSession(store: ProdudeStore, session: ProdudeSession): ProdudeStore {
  const index = store.sessions.findIndex((item) => item.id === session.id)
  const sessions =
    index >= 0
      ? store.sessions.map((item, i) => (i === index ? session : item))
      : [session, ...store.sessions]
  return { ...store, sessions }
}

export function removeSession(store: ProdudeStore, sessionId: string): ProdudeStore {
  const sessions = store.sessions.filter((session) => session.id !== sessionId)
  const activeSessionId =
    store.activeSessionId === sessionId ? sessions[0]?.id : store.activeSessionId
  return { ...store, sessions, activeSessionId }
}
