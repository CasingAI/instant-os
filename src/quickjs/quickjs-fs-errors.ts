/** Node 风格文件系统错误（宿主侧）；注入 guest 时带上 code / path / syscall。 */

export type QuickJsFsErrorCode =
  | 'ENOENT'
  | 'EACCES'
  | 'EISDIR'
  | 'ENOTDIR'
  | 'EEXIST'
  | 'ENOTEMPTY'
  | 'EINVAL'
  | 'EPERM'
  | 'ERR_FS_FILE_TOO_LARGE'
  | 'ERR_INVALID_ARG_TYPE'
  | 'ERR_INVALID_ARG_VALUE'

export class QuickJsFsError extends Error {
  readonly code: QuickJsFsErrorCode
  readonly path: string | undefined
  readonly syscall: string | undefined
  readonly errno: number | undefined

  constructor(
    code: QuickJsFsErrorCode,
    message: string,
    options?: { path?: string; syscall?: string; errno?: number; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'ErrnoException'
    this.code = code
    this.path = options?.path
    this.syscall = options?.syscall
    this.errno = options?.errno
  }
}

export function isQuickJsFsError(error: unknown): error is QuickJsFsError {
  return error instanceof QuickJsFsError
}

export function toQuickJsFsError(error: unknown, fallbackSyscall?: string): QuickJsFsError {
  if (isQuickJsFsError(error)) {
    return error
  }

  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()

  if (lower.includes('不存在') || lower.includes('not found') || lower.includes('enoent')) {
    return new QuickJsFsError('ENOENT', message, { syscall: fallbackSyscall })
  }
  if (lower.includes('已存在') || lower.includes('already exists') || lower.includes('eexist')) {
    return new QuickJsFsError('EEXIST', message, { syscall: fallbackSyscall })
  }
  if (lower.includes('不是文件夹') || lower.includes('not a directory')) {
    return new QuickJsFsError('ENOTDIR', message, { syscall: fallbackSyscall })
  }
  if (lower.includes('是文件夹') || lower.includes('is a directory') || lower.includes('eisdir')) {
    return new QuickJsFsError('EISDIR', message, { syscall: fallbackSyscall })
  }
  if (
    lower.includes('不能写入') ||
    lower.includes('不能删除') ||
    lower.includes('不能') ||
    lower.includes('writable') ||
    lower.includes('permission')
  ) {
    return new QuickJsFsError('EACCES', message, { syscall: fallbackSyscall })
  }

  return new QuickJsFsError('EINVAL', message, { syscall: fallbackSyscall })
}
