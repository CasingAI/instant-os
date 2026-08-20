import { createRegistryStore } from '../../os/registry-store.ts'
import { osNowMs } from '../../os/os-clock.ts'
import type { MailAddress, MailMessage, MailStore, MailThread } from './types.ts'

export const USER_ADDRESS: MailAddress = {
  name: '我',
  email: 'me@instant.os',
}

function emptyStore(): MailStore {
  return {
    initialized: false,
    userAddress: USER_ADDRESS,
    threads: [],
  }
}

function normalizeUserAddress(value: unknown): MailAddress {
  if (typeof value !== 'object' || value === undefined) {
    return USER_ADDRESS
  }
  const address = value as Record<string, unknown>
  if (typeof address.name !== 'string' || typeof address.email !== 'string') {
    return USER_ADDRESS
  }
  return { name: address.name, email: address.email }
}

function normalizeThreads(value: unknown): MailThread[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter(isThreadLike)
}

function isThreadLike(value: unknown): value is MailThread {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }
  const thread = value as Record<string, unknown>
  return (
    typeof thread.id === 'string' &&
    typeof thread.subject === 'string' &&
    Array.isArray(thread.messages) &&
    typeof thread.lastMessageAt === 'number' &&
    typeof thread.unread === 'boolean'
  )
}

const registryStore = createRegistryStore<MailStore>({
  appId: 'mail',
  defaultValue: emptyStore,
  legacyKey: 'store',
  fields: [
    {
      key: 'initialized',
      read: (store) => store.initialized,
      write: (value, draft) => ({ ...draft, initialized: value }),
      serialize: (value) => String(value),
      deserialize: (raw) => raw === 'true',
    },
    {
      key: 'userAddress',
      valueType: 'json',
      read: (store) => store.userAddress,
      write: (value, draft) => ({ ...draft, userAddress: value }),
      normalize: normalizeUserAddress,
    },
    {
      key: 'threads',
      valueType: 'json',
      read: (store) => store.threads,
      write: (value, draft) => ({ ...draft, threads: value }),
      normalize: normalizeThreads,
    },
  ],
})

export function subscribeMailStore(listener: () => void): () => void {
  return registryStore.subscribe(listener)
}

export async function readMailStore(): Promise<MailStore> {
  return registryStore.read()
}

export async function writeMailStore(store: MailStore): Promise<void> {
  await registryStore.write(store)
}

export async function markStoreInitialized(threads: MailThread[]): Promise<MailStore> {
  const store: MailStore = {
    initialized: true,
    userAddress: USER_ADDRESS,
    threads,
  }
  await writeMailStore(store)
  return store
}

export function createMessageId(): string {
  return `msg-${osNowMs()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createThreadId(): string {
  return `thread-${osNowMs()}-${Math.random().toString(36).slice(2, 9)}`
}

export async function appendMessageToThread(
  store: MailStore,
  threadId: string,
  message: MailMessage,
): Promise<MailStore> {
  const threads = store.threads.map((thread) => {
    if (thread.id !== threadId) {
      return thread
    }
    return {
      ...thread,
      messages: [...thread.messages, message],
      lastMessageAt: message.sentAt,
      unread: message.from.email !== store.userAddress.email,
    }
  })
  const next = { ...store, threads }
  await writeMailStore(next)
  return next
}

export async function addThread(store: MailStore, thread: MailThread): Promise<MailStore> {
  const next = {
    ...store,
    threads: [thread, ...store.threads],
  }
  await writeMailStore(next)
  return next
}

export async function markThreadRead(store: MailStore, threadId: string): Promise<MailStore> {
  const threads = store.threads.map((thread) =>
    thread.id === threadId ? { ...thread, unread: false } : thread,
  )
  const next = { ...store, threads }
  await writeMailStore(next)
  return next
}

export async function deleteThread(store: MailStore, threadId: string): Promise<MailStore> {
  const threads = store.threads.filter((thread) => thread.id !== threadId)
  const next = { ...store, threads }
  await writeMailStore(next)
  return next
}

export async function deleteMessageFromThread(
  store: MailStore,
  threadId: string,
  messageId: string,
): Promise<MailStore> {
  const threads = store.threads.flatMap((thread) => {
    if (thread.id !== threadId) {
      return [thread]
    }

    const messages = thread.messages.filter((message) => message.id !== messageId)
    if (messages.length === 0) {
      return []
    }

    const lastMessage = messages[messages.length - 1]
    return [
      {
        ...thread,
        messages,
        lastMessageAt: lastMessage.sentAt,
      },
    ]
  })

  const next = { ...store, threads }
  await writeMailStore(next)
  return next
}

export function isFromUser(store: MailStore, message: MailMessage): boolean {
  return message.from.email === store.userAddress.email
}

export function threadHasUserMessage(store: MailStore, thread: MailThread): boolean {
  return thread.messages.some((message) => isFromUser(store, message))
}

export function getOtherParty(store: MailStore, thread: MailThread): MailAddress | undefined {
  for (const message of thread.messages) {
    if (!isFromUser(store, message)) {
      return message.from
    }
    for (const recipient of message.to) {
      if (recipient.email !== store.userAddress.email) {
        return recipient
      }
    }
  }
  return undefined
}
