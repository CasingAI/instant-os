import { osNowMs } from '../../os/os-clock.ts'
import { createRegistryStore } from '../../os/registry-store.ts'
import type { CatGptMessage, CatGptSession, CatGptStore } from './catgpt-types.ts'

const registryStore = createRegistryStore<CatGptStore>({
  appId: 'catgpt',
  defaultValue: emptyStore,
  legacyKey: 'store',
  fields: [
    {
      key: 'sessions',
      valueType: 'json',
      read: (store) => store.sessions,
      write: (value, draft) => ({ ...draft, sessions: value }),
      normalize: (raw) =>
        Array.isArray(raw) ? raw.filter(isSessionLike).map(normalizeSession) : [],
    },
    {
      key: 'activeSessionId',
      read: (store) => store.activeSessionId,
      write: (value, draft) => ({ ...draft, activeSessionId: value }),
      serialize: (value) => value ?? '',
      deserialize: (raw) => (raw ? raw : undefined),
    },
  ],
})

function isSessionLike(value: unknown): value is CatGptSession {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }
  const session = value as Record<string, unknown>
  return (
    typeof session.id === 'string' &&
    typeof session.title === 'string' &&
    Array.isArray(session.messages) &&
    typeof session.createdAt === 'number' &&
    typeof session.updatedAt === 'number'
  )
}

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

function emptyStore(): CatGptStore {
  return { sessions: [] }
}

export function subscribeCatGptStore(listener: () => void): () => void {
  return registryStore.subscribe(listener)
}

export async function readCatGptStore(): Promise<CatGptStore> {
  return registryStore.read()
}

export async function writeCatGptStore(store: CatGptStore): Promise<void> {
  await registryStore.write(store)
}

export function createSessionId(): string {
  return `catgpt-${osNowMs()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createMessageId(): string {
  return `catgpt-msg-${osNowMs()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createSession(title = '新对话'): CatGptSession {
  const now = osNowMs()
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
    createdAt: osNowMs(),
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
