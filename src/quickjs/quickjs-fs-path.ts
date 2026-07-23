import { createPosixPathApi } from './quickjs-path.ts'
import { QuickJsFsError } from './quickjs-fs-errors.ts'
import type { QuickJsHostPermissions } from './quickjs-instance-types.ts'

function normalizeRoot(root: string): string {
  const trimmed = root.trim()
  if (!trimmed.startsWith('/')) {
    throw new QuickJsFsError('EINVAL', `Invalid fs root (must be absolute): ${root}`)
  }
  const collapsed = trimmed.replace(/\/+$/, '')
  return collapsed === '' ? '/' : collapsed
}

/** 路径是否落在某个根下（根自身或其子孙）。 */
export function isPathUnderFsRoot(absolutePath: string, root: string): boolean {
  const path = normalizeRoot(absolutePath)
  const base = normalizeRoot(root)
  if (base === '/') {
    return path.startsWith('/')
  }
  return path === base || path.startsWith(`${base}/`)
}

export function assertFsPermission(
  absolutePath: string,
  mode: 'read' | 'write',
  permissions: QuickJsHostPermissions,
  syscall: string,
): void {
  const roots = mode === 'read' ? permissions.fsReadRoots : permissions.fsWriteRoots
  if (roots.length === 0) {
    throw new QuickJsFsError(
      'EACCES',
      `permission denied, ${syscall} '${absolutePath}' (no ${mode} roots; set workspaceRoot or permissions)`,
      { path: absolutePath, syscall },
    )
  }
  const allowed = roots.some((root) => isPathUnderFsRoot(absolutePath, root))
  if (!allowed) {
    throw new QuickJsFsError(
      'EACCES',
      `permission denied, ${syscall} '${absolutePath}'`,
      { path: absolutePath, syscall },
    )
  }
}

/**
 * 将 guest 路径解析为 Instant VFS 全局绝对路径。
 * 相对路径相对 process.cwd；结果须以 / 开头。
 */
export function resolveGuestFsPath(rawPath: unknown, getCwd: () => string): string {
  if (typeof rawPath !== 'string') {
    throw new QuickJsFsError(
      'ERR_INVALID_ARG_TYPE',
      `The "path" argument must be of type string. Received ${typeof rawPath}`,
    )
  }
  const pathApi = createPosixPathApi(getCwd)
  const resolved = pathApi.resolve(rawPath)
  if (!resolved.startsWith('/')) {
    throw new QuickJsFsError(
      'EINVAL',
      `Resolved path must be absolute in Instant VFS: ${resolved}`,
      { path: resolved },
    )
  }
  // Instant 卷路径：去掉尾部斜杠（根 `/` 除外）
  if (resolved !== '/' && resolved.endsWith('/')) {
    return resolved.replace(/\/+$/, '')
  }
  return resolved
}

export function assertMaxFileBytes(
  byteLength: number,
  maxFileBytes: number,
  path: string,
  syscall: string,
): void {
  if (byteLength > maxFileBytes) {
    throw new QuickJsFsError(
      'ERR_FS_FILE_TOO_LARGE',
      `File size ${byteLength} exceeds maxFileBytes ${maxFileBytes}`,
      { path, syscall },
    )
  }
}
