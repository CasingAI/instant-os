import { isStreamAbortError } from '../../ai/stream-abort.ts'

export const ICODE_GENERATION_ABORTED = 'ICODE_GENERATION_ABORTED' as const

export class IcodeGenerationAbortedError extends Error {
  constructor() {
    super('已停止生成')
    this.name = ICODE_GENERATION_ABORTED
  }
}

export function isIcodeGenerationAbortedError(
  error: unknown,
  signal?: AbortSignal,
): boolean {
  if (error instanceof IcodeGenerationAbortedError) {
    return true
  }

  return isStreamAbortError(error, signal)
}

export function throwIfIcodeGenerationAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new IcodeGenerationAbortedError()
  }
}
