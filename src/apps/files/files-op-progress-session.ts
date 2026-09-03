/**
 * 文件长操作进度会话：把进度态推到一扇系统迷你窗
 * （openApp + chromeKind:'mini'，尺寸由内容撑起）。
 */
import type { FilesOpProgressUiState } from './files-run-with-op-progress.ts'

export const FILES_OP_PROGRESS_APP_ID = 'files-op-progress' as const

type FilesOpProgressHost = {
  open: (documentId: string) => string | undefined
  setTitle: (windowId: string, title: string) => void
  close: (windowId: string) => void
}

const sessions = new Map<string, FilesOpProgressUiState>()
const windowBySession = new Map<string, string>()
const listeners = new Set<() => void>()
let host: FilesOpProgressHost | undefined
let sessionSeq = 0

export function createFilesOpProgressSessionId(): string {
  sessionSeq += 1
  return `files-op-${sessionSeq}`
}

export function registerFilesOpProgressHost(next: FilesOpProgressHost): () => void {
  host = next
  return () => {
    if (host === next) host = undefined
  }
}

export function subscribeFilesOpProgress(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getFilesOpProgressSession(sessionId: string): FilesOpProgressUiState | undefined {
  return sessions.get(sessionId)
}

function notify(): void {
  for (const listener of listeners) listener()
}

/** 把一次操作的进度推到系统迷你窗；state 为 undefined 时关窗。 */
export function publishFilesOpProgress(
  sessionId: string,
  state: FilesOpProgressUiState | undefined,
): void {
  if (state) {
    sessions.set(sessionId, state)
    let windowId = windowBySession.get(sessionId)
    if (windowId === undefined) {
      windowId = host?.open(sessionId)
      if (windowId !== undefined) {
        windowBySession.set(sessionId, windowId)
        host?.setTitle(windowId, state.title)
      }
    } else {
      host?.setTitle(windowId, state.title)
    }
  } else {
    sessions.delete(sessionId)
    const windowId = windowBySession.get(sessionId)
    windowBySession.delete(sessionId)
    if (windowId !== undefined) host?.close(windowId)
  }
  notify()
}
