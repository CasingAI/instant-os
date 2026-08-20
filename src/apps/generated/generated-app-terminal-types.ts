import type { ExtAppId, GeneratedAppId } from '../../os/types.ts'
import type { TerminalLine, TerminalSessionSnapshot } from '../../terminal/terminal-types.ts'

export type BridgeAppId = GeneratedAppId | ExtAppId

export const GENERATED_APP_TERMINAL_REQUEST_MESSAGE_TYPE =
  'instant-generated-app-terminal-request' as const
export const GENERATED_APP_TERMINAL_RESPONSE_MESSAGE_TYPE =
  'instant-generated-app-terminal-response' as const
export const GENERATED_APP_TERMINAL_EVENT_MESSAGE_TYPE =
  'instant-generated-app-terminal-event' as const

export type GeneratedAppTerminalOp =
  | 'createSession'
  | 'destroySession'
  | 'exec'
  | 'write'
  | 'abort'
  | 'clear'
  | 'getCwd'
  | 'cd'

export type GeneratedAppTerminalRequestMessage = {
  type: typeof GENERATED_APP_TERMINAL_REQUEST_MESSAGE_TYPE
  appId: BridgeAppId
  requestId: string
  op: GeneratedAppTerminalOp
  sessionId?: string
  line?: string
  text?: string
  path?: string
  initialCwd?: string
  thinkingEnabled?: boolean
}

export type GeneratedAppTerminalResult =
  | { sessionId: string }
  | { cwd: string }
  | null

export type GeneratedAppTerminalResponseMessage = {
  type: typeof GENERATED_APP_TERMINAL_RESPONSE_MESSAGE_TYPE
  appId: BridgeAppId
  requestId: string
  ok: boolean
  result?: GeneratedAppTerminalResult
  error?: string
}

export type GeneratedAppTerminalEventPayload = {
  type: 'snapshot'
  snapshot: {
    cwd: string
    busy: boolean
    lines: TerminalLine[]
  }
}

export type GeneratedAppTerminalEventMessage = {
  type: typeof GENERATED_APP_TERMINAL_EVENT_MESSAGE_TYPE
  appId: BridgeAppId
  sessionId: string
  event: GeneratedAppTerminalEventPayload
}

const TERMINAL_OPS = new Set<string>([
  'createSession',
  'destroySession',
  'exec',
  'write',
  'abort',
  'clear',
  'getCwd',
  'cd',
])

export function isGeneratedAppTerminalRequestMessage(
  data: unknown,
): data is GeneratedAppTerminalRequestMessage {
  if (!data || typeof data !== 'object') return false
  const message = data as GeneratedAppTerminalRequestMessage
  return (
    message.type === GENERATED_APP_TERMINAL_REQUEST_MESSAGE_TYPE &&
    typeof message.appId === 'string' &&
    typeof message.requestId === 'string' &&
    typeof message.op === 'string' &&
    TERMINAL_OPS.has(message.op)
  )
}

export function toTerminalEventSnapshot(
  snapshot: TerminalSessionSnapshot,
): GeneratedAppTerminalEventPayload {
  return {
    type: 'snapshot',
    snapshot: {
      cwd: snapshot.cwd,
      busy: snapshot.busy,
      lines: snapshot.lines.map((line) => ({ ...line })),
    },
  }
}
