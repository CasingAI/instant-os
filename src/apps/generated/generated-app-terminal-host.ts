import { createTerminalSession, type TerminalSession } from '../../terminal/terminal-session.ts'
import type { BridgeAppId } from './generated-app-terminal-types.ts'
import {
  GENERATED_APP_TERMINAL_EVENT_MESSAGE_TYPE,
  toTerminalEventSnapshot,
  type GeneratedAppTerminalEventMessage,
  type GeneratedAppTerminalRequestMessage,
  type GeneratedAppTerminalResult,
} from './generated-app-terminal-types.ts'

type ReplyTarget = {
  postMessage: (message: unknown, targetOrigin: string) => void
}

type HostSessionEntry = {
  session: TerminalSession
  unsubscribe: () => void
}

const hostSessions = new Map<string, HostSessionEntry>()

function sessionKey(appId: BridgeAppId, sessionId: string): string {
  return `${appId}::${sessionId}`
}

let sessionSeq = 0

function nextSessionId(): string {
  sessionSeq += 1
  return `term-${sessionSeq}-${Date.now()}`
}

function pushEvent(
  source: ReplyTarget,
  appId: BridgeAppId,
  sessionId: string,
  session: TerminalSession,
): void {
  const message: GeneratedAppTerminalEventMessage = {
    type: GENERATED_APP_TERMINAL_EVENT_MESSAGE_TYPE,
    appId,
    sessionId,
    event: toTerminalEventSnapshot(session.getSnapshot()),
  }
  source.postMessage(message, '*')
}

export function destroyGeneratedAppTerminalSessions(appId: BridgeAppId): void {
  const prefix = `${appId}::`
  for (const [key, entry] of [...hostSessions.entries()]) {
    if (!key.startsWith(prefix)) continue
    entry.unsubscribe()
    entry.session.destroy()
    hostSessions.delete(key)
  }
}

function getEntry(appId: BridgeAppId, sessionId: string | undefined): HostSessionEntry {
  if (!sessionId) {
    throw new Error('缺少 sessionId')
  }
  const entry = hostSessions.get(sessionKey(appId, sessionId))
  if (!entry) {
    throw new Error('终端会话不存在')
  }
  return entry
}

export async function dispatchGeneratedAppTerminalRequest(
  message: GeneratedAppTerminalRequestMessage,
  source: ReplyTarget,
): Promise<GeneratedAppTerminalResult> {
  switch (message.op) {
    case 'createSession': {
      const sessionId = nextSessionId()
      const session = createTerminalSession({
        usageActor: message.appId,
        initialCwd: message.initialCwd,
        thinkingEnabled: message.thinkingEnabled,
      })
      const unsubscribe = session.subscribe(() => {
        pushEvent(source, message.appId, sessionId, session)
      })
      hostSessions.set(sessionKey(message.appId, sessionId), { session, unsubscribe })
      pushEvent(source, message.appId, sessionId, session)
      return { sessionId }
    }
    case 'destroySession': {
      const entry = getEntry(message.appId, message.sessionId)
      entry.unsubscribe()
      entry.session.destroy()
      hostSessions.delete(sessionKey(message.appId, message.sessionId!))
      return null
    }
    case 'exec': {
      if (typeof message.line !== 'string') throw new Error('缺少 line')
      const entry = getEntry(message.appId, message.sessionId)
      await entry.session.submit(message.line, { source: 'program' })
      return null
    }
    case 'write': {
      if (typeof message.text !== 'string') throw new Error('缺少 text')
      const entry = getEntry(message.appId, message.sessionId)
      entry.session.write(message.text)
      return null
    }
    case 'abort': {
      const entry = getEntry(message.appId, message.sessionId)
      entry.session.abort()
      return null
    }
    case 'clear': {
      const entry = getEntry(message.appId, message.sessionId)
      entry.session.clear()
      return null
    }
    case 'getCwd': {
      const entry = getEntry(message.appId, message.sessionId)
      return { cwd: entry.session.getCwd() }
    }
    case 'cd': {
      if (typeof message.path !== 'string') throw new Error('缺少 path')
      const entry = getEntry(message.appId, message.sessionId)
      await entry.session.cd(message.path)
      return { cwd: entry.session.getCwd() }
    }
    default: {
      const _exhaustive: never = message.op
      throw new Error(`未知操作：${String(_exhaustive)}`)
    }
  }
}
