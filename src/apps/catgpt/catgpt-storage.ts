import {
  DEVICE_STORAGE_KEYS,
  getLocalStorageKeyBytes,
  writeLocalStorageItem,
} from '../../os/device-storage.ts'
import type { CatGptMessage, CatGptSession, CatGptStore } from './catgpt-types.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.catgpt

const SESSION_EMOJIS = [
  '🐱',
  '😺',
  '😸',
  '😻',
  '🙀',
  '😽',
  '🐾',
  '✨',
  '🌙',
  '💫',
  '🎐',
  '🔮',
  '😿',
  '🦁',
  '🐯',
  '⭐',
  '🌟',
  '🍀',
  '🎋',
  '🪷',
] as const

export function deriveSessionEmoji(sessionId: string): string {
  let hash = 0
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) >>> 0
  }
  return SESSION_EMOJIS[hash % SESSION_EMOJIS.length]
}

function normalizeSession(session: CatGptSession): CatGptSession {
  return {
    ...session,
    emoji: session.emoji || deriveSessionEmoji(session.id),
  }
}

function normalizeStore(store: CatGptStore): CatGptStore {
  return {
    ...store,
    sessions: store.sessions.map(normalizeSession),
  }
}

function emptyStore(): CatGptStore {
  return { sessions: [] }
}

function loadStore(): CatGptStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return emptyStore()
    }
    const parsed = JSON.parse(raw) as CatGptStore
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

export function readCatGptStore(): CatGptStore {
  return loadStore()
}

export function writeCatGptStore(store: CatGptStore): boolean {
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(store))
}

export function getCatGptStorageBytes(): number {
  return getLocalStorageKeyBytes(STORAGE_KEY)
}

export function createSessionId(): string {
  return `catgpt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createMessageId(): string {
  return `catgpt-msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createSession(title = '新对话'): CatGptSession {
  const now = Date.now()
  const id = createSessionId()
  return {
    id,
    title,
    emoji: deriveSessionEmoji(id),
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function createMessage(
  role: CatGptMessage['role'],
  content: string,
  options?: { isError?: boolean },
): CatGptMessage {
  return {
    id: createMessageId(),
    role,
    content: content.trim(),
    createdAt: Date.now(),
    isError: options?.isError,
  }
}

export function deriveSessionTitle(messages: CatGptMessage[]): string {
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

export function upsertSession(store: CatGptStore, session: CatGptSession): CatGptStore {
  const index = store.sessions.findIndex((item) => item.id === session.id)
  const sessions =
    index >= 0
      ? store.sessions.map((item, i) => (i === index ? session : item))
      : [session, ...store.sessions]
  return { ...store, sessions }
}

export function removeSession(store: CatGptStore, sessionId: string): CatGptStore {
  const sessions = store.sessions.filter((session) => session.id !== sessionId)
  const activeSessionId =
    store.activeSessionId === sessionId ? sessions[0]?.id : store.activeSessionId
  return { ...store, sessions, activeSessionId }
}
