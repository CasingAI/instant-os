import { dispatchGeneratedAppTerminalRequest } from './generated-app-terminal-host.ts'
import {
  GENERATED_APP_TERMINAL_RESPONSE_MESSAGE_TYPE,
  type GeneratedAppTerminalRequestMessage,
  type GeneratedAppTerminalResponseMessage,
} from './generated-app-terminal-types.ts'

type ReplyTarget = {
  postMessage: (message: unknown, targetOrigin: string) => void
}

function reply(source: ReplyTarget, message: GeneratedAppTerminalResponseMessage): void {
  source.postMessage(message, '*')
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '终端操作失败'
}

export async function handleGeneratedAppTerminalRequest(
  message: GeneratedAppTerminalRequestMessage,
  source: ReplyTarget,
  options?: { allowed?: boolean },
): Promise<void> {
  if (options?.allowed === false) {
    reply(source, {
      type: GENERATED_APP_TERMINAL_RESPONSE_MESSAGE_TYPE,
      appId: message.appId,
      requestId: message.requestId,
      ok: false,
      error: '应用未获得终端能力，请先授予 terminal 能力',
    })
    return
  }

  try {
    const result = await dispatchGeneratedAppTerminalRequest(message, source)
    reply(source, {
      type: GENERATED_APP_TERMINAL_RESPONSE_MESSAGE_TYPE,
      appId: message.appId,
      requestId: message.requestId,
      ok: true,
      result,
    })
  } catch (error) {
    reply(source, {
      type: GENERATED_APP_TERMINAL_RESPONSE_MESSAGE_TYPE,
      appId: message.appId,
      requestId: message.requestId,
      ok: false,
      error: formatError(error),
    })
  }
}
