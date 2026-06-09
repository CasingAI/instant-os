import {
  ICODE_CONSOLE_MESSAGE_TYPE,
  type ICodeConsoleEntry,
  type ICodeConsoleLevel,
  type ICodeConsoleMessage,
} from './icode-types.ts'

const CONSOLE_LEVELS: readonly ICodeConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug']
export const ICODE_CONSOLE_MAX_ENTRIES = 500

export function isIcodeConsoleMessage(value: unknown): value is ICodeConsoleMessage {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }

  const message = value as Record<string, unknown>
  return (
    message.type === ICODE_CONSOLE_MESSAGE_TYPE &&
    typeof message.appId === 'string' &&
    message.appId.startsWith('gen:') &&
    typeof message.level === 'string' &&
    CONSOLE_LEVELS.includes(message.level as ICodeConsoleLevel) &&
    typeof message.text === 'string' &&
    typeof message.timestamp === 'number'
  )
}

export function appendConsoleEntry(
  entries: ICodeConsoleEntry[],
  message: ICodeConsoleMessage,
): ICodeConsoleEntry[] {
  const entry: ICodeConsoleEntry = {
    id: `console-${message.timestamp}-${entries.length}`,
    level: message.level,
    text: message.text,
    timestamp: message.timestamp,
  }

  const next = [...entries, entry]
  if (next.length <= ICODE_CONSOLE_MAX_ENTRIES) {
    return next
  }

  return next.slice(next.length - ICODE_CONSOLE_MAX_ENTRIES)
}
