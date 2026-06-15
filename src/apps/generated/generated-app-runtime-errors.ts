import {
  GENERATED_APP_RUNTIME_ERROR_MAX_ENTRIES,
  GENERATED_APP_RUNTIME_ERROR_MESSAGE_TYPE,
  type GeneratedAppRuntimeErrorEntry,
  type GeneratedAppRuntimeErrorKind,
  type GeneratedAppRuntimeErrorMessage,
} from './generated-app-runtime-error-types.ts'

const RUNTIME_ERROR_KINDS: readonly GeneratedAppRuntimeErrorKind[] = ['error', 'unhandledrejection']

export function isGeneratedAppRuntimeErrorMessage(value: unknown): value is GeneratedAppRuntimeErrorMessage {
  if (typeof value !== 'object' || value === undefined) {
    return false
  }

  const message = value as Record<string, unknown>
  return (
    message.type === GENERATED_APP_RUNTIME_ERROR_MESSAGE_TYPE &&
    typeof message.appId === 'string' &&
    message.appId.startsWith('gen:') &&
    typeof message.kind === 'string' &&
    RUNTIME_ERROR_KINDS.includes(message.kind as GeneratedAppRuntimeErrorKind) &&
    typeof message.text === 'string' &&
    typeof message.timestamp === 'number'
  )
}

export function appendRuntimeErrorEntry(
  entries: GeneratedAppRuntimeErrorEntry[],
  message: GeneratedAppRuntimeErrorMessage,
): GeneratedAppRuntimeErrorEntry[] {
  const entry: GeneratedAppRuntimeErrorEntry = {
    id: `runtime-error-${message.timestamp}-${entries.length}`,
    kind: message.kind,
    text: message.text,
    timestamp: message.timestamp,
  }

  const next = [...entries, entry]
  if (next.length <= GENERATED_APP_RUNTIME_ERROR_MAX_ENTRIES) {
    return next
  }

  return next.slice(next.length - GENERATED_APP_RUNTIME_ERROR_MAX_ENTRIES)
}

export function logRuntimeErrorToHostConsole(appLabel: string, text: string): void {
  console.error(`[${appLabel}]`, text)
}
