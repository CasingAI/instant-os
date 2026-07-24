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

const STORAGE_KEY = DEVICE_STORAGE_KEYS.vscodeAiChat
const MAX_MESSAGES = 80
const MAX_CONTENT_CHARS = 48_000

export type VscodeAiChatThread = {
  workspaceKey: string
  messages: VscodeAiChatMessage[]
}

function workspaceKey(folder: string | undefined): string {
  const trimmed = folder?.trim() || ''
  return trimmed || '__no_workspace__'
}

export function vscodeAiChatWorkspaceKey(folder: string | undefined): string {
  return workspaceKey(folder)
}

export function loadVscodeAiChatThread(workspaceFolder: string | undefined): VscodeAiChatThread {
  const key = workspaceKey(workspaceFolder)
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { workspaceKey: key, messages: [] }
    const parsed = JSON.parse(raw) as { workspaceKey?: string; messages?: VscodeAiChatMessage[] }
    if (parsed.workspaceKey !== key || !Array.isArray(parsed.messages)) {
      return { workspaceKey: key, messages: [] }
    }
    return {
      workspaceKey: key,
      messages: parsed.messages.slice(-MAX_MESSAGES),
    }
  } catch {
    return { workspaceKey: key, messages: [] }
  }
}

export function saveVscodeAiChatThread(thread: VscodeAiChatThread): void {
  let total = 0
  const messages: VscodeAiChatMessage[] = []
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index]
    if (!message) continue
    const len = message.content.length
    if (total + len > MAX_CONTENT_CHARS) break
    total += len
    messages.unshift(message)
  }
  writeLocalStorageItem(
    STORAGE_KEY,
    JSON.stringify({
      workspaceKey: thread.workspaceKey,
      messages: messages.slice(-MAX_MESSAGES),
    }),
  )
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