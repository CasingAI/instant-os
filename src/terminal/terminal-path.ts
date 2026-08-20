import { parseFilesAbsolutePath } from '../apps/files/files-path.ts'

const DEFAULT_CWD = '/user'

/** 规范化绝对路径：去掉尾部 `/`（根卷保留） */
export function normalizeTerminalAbsolutePath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed.startsWith('/')) {
    throw new Error('路径必须是以 / 开头的绝对路径')
  }
  const collapsed = trimmed.replace(/\/{2,}/g, '/')
  if (collapsed === '/') {
    return '/'
  }
  return collapsed.replace(/\/+$/, '') || '/'
}

/**
 * 将 cwd + 用户输入解析为绝对路径。
 * 支持 `.` / `..`；卷根之上的 `..` 回到命名空间根 `/`。
 */
export function resolveTerminalPath(cwd: string, input: string): string {
  const raw = input.trim()
  const base = normalizeTerminalAbsolutePath(cwd || DEFAULT_CWD)

  if (!raw || raw === '.') {
    return base
  }

  const absolute = raw.startsWith('/')
    ? normalizeTerminalAbsolutePath(raw)
    : normalizeTerminalAbsolutePath(`${base}/${raw}`)

  const parts = absolute.split('/').filter(Boolean)
  const stack: string[] = []
  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }

  if (stack.length === 0) {
    return '/'
  }
  return `/${stack.join('/')}`
}

/** 是否为某一卷的根（不含命名空间根 `/`） */
export function isTerminalVolumeRoot(path: string): boolean {
  const normalized = normalizeTerminalAbsolutePath(path)
  if (normalized === '/') return false
  const parsed = parseFilesAbsolutePath(normalized)
  return Boolean(parsed && parsed.segments.length === 0)
}

export function getDefaultTerminalCwd(): string {
  return DEFAULT_CWD
}
