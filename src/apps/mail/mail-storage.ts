import { osNowMs } from '../../os/os-clock.ts'
import {
  DEVICE_STORAGE_KEYS,
  getLocalStorageKeyBytes,
  writeLocalStorageItem,
} from '../../os/device-storage.ts'
import type { MailAddress, MailMessage, MailStore, MailThread } from './types.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.mail

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

function loadStore(): MailStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return emptyStore()
    }
    const parsed = JSON.parse(raw) as MailStore
    if (!Array.isArray(parsed.threads)) {
      return emptyStore()
    }
    return {
      initialized: Boolean(parsed.initialized),
      userAddress: parsed.userAddress ?? USER_ADDRESS,
      threads: parsed.threads,
    }
  } catch {
    return emptyStore()
  }
}

function saveStore(store: MailStore): boolean {
  return writeLocalStorageItem(STORAGE_KEY, JSON.stringify(store))
}

export function readMailStore(): MailStore {
  return loadStore()
}

export function writeMailStore(store: MailStore): boolean {
  return saveStore(store)
}

export function markStoreInitialized(threads: MailThread[]): MailStore {
  const store: MailStore = {
    initialized: true,
    userAddress: USER_ADDRESS,
    threads,
  }
  saveStore(store)
  return store
}

export function createMessageId(): string {
  return `msg-${osNowMs()}-${Math.random().toString(36).slice(2, 9)}`
}

export function createThreadId(): string {
  return `thread-${osNowMs()}-${Math.random().toString(36).slice(2, 9)}`
}

export function appendMessageToThread(
  store: MailStore,
  threadId: string,
  message: MailMessage,
): MailStore {
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
  saveStore(next)
  return next
}

export function addThread(store: MailStore, thread: MailThread): MailStore {
  const next = {
    ...store,
    threads: [thread, ...store.threads],
  }
  saveStore(next)
  return next
}

export function markThreadRead(store: MailStore, threadId: string): MailStore {
  const threads = store.threads.map((thread) =>
    thread.id === threadId ? { ...thread, unread: false } : thread,
  )
  const next = { ...store, threads }
  saveStore(next)
  return next
}

export function deleteThread(store: MailStore, threadId: string): MailStore {
  const threads = store.threads.filter((thread) => thread.id !== threadId)
  const next = { ...store, threads }
  saveStore(next)
  return next
}

export function deleteMessageFromThread(
  store: MailStore,
  threadId: string,
  messageId: string,
): MailStore {
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
  saveStore(next)
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

export function getMailStorageBytes(): number {
  return getLocalStorageKeyBytes(STORAGE_KEY)
}
