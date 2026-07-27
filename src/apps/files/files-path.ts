import { getCachedMount } from './files-mount-store.ts'
import {
  isMountLocationId,
  makeMountLocationId,
  type FilesLocationId,
} from './files-types.ts'

/** 内置卷在全局路径中的根前缀 */
export const FILES_PATH_ROOT = {
  local: '/user',
  applications: '/Applications',
  dev: '/dev',
  models3d: '/models',
  source: '/system',
} as const

export type ParsedFilesAbsolutePath = {
  locationId: FilesLocationId
  /** 卷根之后的路径段（已 sanitize） */
  segments: string[]
}

/**
 * 位置 → 全局路径根。
 * - 用户文件 `/user`
 * - 应用程序 `/Applications`
 * - 开发者数据 `/dev`
 * - 3D 模型 `/models`
 * - 系统文件 `/system`
 * - 外部挂载 `/mount/{文件夹名}`
 *
 * 另有命名空间根 `/`（见 `isFilesNamespaceRoot`）：不对应任何 location，仅用于列举各卷。
 */
export function filesLocationPathRoot(locationId: FilesLocationId): string {
  if (isMountLocationId(locationId)) {
    const key = locationId.slice('mount:'.length)
    return key ? `/mount/${key}` : '/mount'
  }
  return FILES_PATH_ROOT[locationId]
}

/** 是否为命名空间虚拟根 `/`（下列出各卷，不可作为真实存储节点） */
export function isFilesNamespaceRoot(path: string): boolean {
  const trimmed = path.trim().replace(/\/+$/, '') || '/'
  return trimmed === '/'
}

/** 作为 QuickJS `fsReadRoots` 时允许读取各卷内任意路径 */
export const FILES_VFS_READ_ROOT = '/' as const

/** 是否为 Instant OS 虚拟文件系统中可读取的绝对路径 */
export function isReadableVfsAbsolutePath(path: string): boolean {
  const normalized = path.trim().replace(/\/+$/, '') || '/'
  if (isFilesNamespaceRoot(normalized)) {
    return true
  }
  return parseFilesAbsolutePath(normalized) !== undefined
}

export function isFilesAbsolutePath(ref: string): boolean {
  return ref.startsWith('/')
}

const FILES_NAME_FORBIDDEN = /[/\\:\u0000-\u001f\u007f]/

/**
 * 规范化并校验文件/文件夹名（路径句柄安全）。
 * 禁止：空名、`.` / `..`、`/` `\` `:`、控制字符。
 */
export function normalizeFilesNodeName(raw: string): string {
  const name = raw.trim()
  if (!name) {
    throw new Error('名称不能为空')
  }
  if (name === '.' || name === '..') {
    throw new Error('名称无效')
  }
  if (FILES_NAME_FORBIDDEN.test(name)) {
    throw new Error('名称不能包含 / \\ : 或控制字符')
  }
  if (name.length > 255) {
    throw new Error('名称过长（最多 255 个字符）')
  }
  return name
}

/** 路径段中的 `/` 会破坏层级，显示与解析时统一替换 */
export function sanitizeFilesPathSegment(segment: string): string {
  return segment.replaceAll('/', '∕')
}

export function joinFilesAbsolutePath(root: string, ...segments: string[]): string {
  const parts = segments.map((item) => sanitizeFilesPathSegment(item.trim())).filter(Boolean)
  if (parts.length === 0) return root
  return `${root}/${parts.join('/')}`
}

/**
 * 解析全局绝对路径 → 卷 + 相对段。
 * 例：`/user/a/b.txt` → `{ locationId: 'local', segments: ['a', 'b.txt'] }`
 */
export function parseFilesAbsolutePath(absolutePath: string): ParsedFilesAbsolutePath | undefined {
  const normalized = absolutePath.replace(/\/+$/, '') || '/'

  for (const [id, root] of Object.entries(FILES_PATH_ROOT) as [
    keyof typeof FILES_PATH_ROOT,
    string,
  ][]) {
    if (normalized === root) {
      return { locationId: id, segments: [] }
    }
    if (normalized.startsWith(`${root}/`)) {
      return {
        locationId: id,
        segments: normalized
          .slice(root.length + 1)
          .split('/')
          .filter(Boolean)
          .map((segment) => sanitizeFilesPathSegment(segment)),
      }
    }
  }

  if (normalized === '/mount' || normalized.startsWith('/mount/')) {
    const after =
      normalized === '/mount'
        ? []
        : normalized
            .slice('/mount/'.length)
            .split('/')
            .filter(Boolean)
            .map((segment) => sanitizeFilesPathSegment(segment))
    const key = after[0]
    if (!key) return undefined
    const locationId = makeMountLocationId(key)
    if (!isMountLocationId(locationId)) return undefined
    return { locationId, segments: after.slice(1) }
  }

  return undefined
}

/** 卷根本身的展示名（侧栏位置名 / 挂载文件夹名） */
export function filesLocationDisplayName(locationId: FilesLocationId): string {
  if (isMountLocationId(locationId)) {
    return getCachedMount(locationId)?.label ?? locationId
  }
  if (locationId === 'local') return '用户文件'
  if (locationId === 'applications') return '应用程序'
  if (locationId === 'dev') return '开发者数据'
  if (locationId === 'models3d') return '3D 模型'
  return '系统'
}

export function formatFilesByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} 字节`
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  }
  const mb = bytes / (1024 * 1024)
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

export function formatFilesTimestamp(ms: number): string {
  if (!ms) return '—'
  try {
    return new Date(ms).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return '—'
  }
}
