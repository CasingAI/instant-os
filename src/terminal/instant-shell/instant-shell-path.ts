import { createPosixPathApi } from '../../quickjs/quickjs-path.ts'

/** 将客侧路径解析为 VFS 绝对路径（相对路径相对 cwd）。 */
export function resolveInstantShellPath(cwd: string, path: string): string {
  const trimmed = path.trim()
  if (!trimmed) {
    throw new Error('路径不能为空')
  }
  const api = createPosixPathApi(() => cwd)
  const resolved = api.resolve(trimmed)
  if (!api.isAbsolute(resolved)) {
    throw new Error(`无法解析为绝对路径: ${path}`)
  }
  return resolved
}

export function basenameInstantShellPath(absolutePath: string): string {
  const parts = absolutePath.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? absolutePath
}
