import { getLocalStorageKeyLabel, isLocalStorageValueBlocked } from '../ai/storage-inspection.ts'
import { filesRemove } from '../apps/files/files-api.ts'
import {
  addMount,
  canMountDirectories,
  getCachedMount,
  listMounts,
  removeMount,
} from '../apps/files/files-mount-store.ts'
import { filesLocationPathRoot } from '../apps/files/files-path.ts'
import { isMountLocationId, type MountFilesLocationId } from '../apps/files/files-types.ts'
import { requestTerminalPrivilegeConfirm } from './terminal-privilege-confirm-store.ts'
import type {
  TerminalPrivilegeCopy,
  TerminalPrivilegeRequest,
  TerminalPrivilegeResult,
} from './terminal-privilege-types.ts'
import { resolveTerminalPrivilegeActorLabel } from './terminal-privilege-types.ts'

/** 终端不得直接读写/删除账户与 API Key 存储；请使用「钥匙串」管理 */
export const TERMINAL_ACCOUNT_STORAGE_DENIED =
  '账户与 API Key 配置不可由终端读写、删除或清空。请使用「钥匙串」管理。'

export function getTerminalStorageKeyDenial(key: string): string | undefined {
  if (isLocalStorageValueBlocked(key)) {
    return TERMINAL_ACCOUNT_STORAGE_DENIED
  }
  return undefined
}

function privilegeActionPhrase(request: TerminalPrivilegeRequest): string {
  switch (request.kind) {
    case 'mount':
      return '挂载本机文件夹到虚拟文件系统'
    case 'unmount': {
      const label = request.args?.mountLabel ?? request.args?.mountPath
      return label ? `卸载已挂载文件夹「${label}」` : '卸载已挂载的本机文件夹'
    }
    case 'fs.remove': {
      const path = request.args?.fsPath?.trim()
      const kind = request.args?.fsKind === 'folder' ? '文件夹' : '文件'
      return path ? `删除${kind}「${path}」` : `删除${kind}`
    }
    case 'storage.removeKey': {
      const key = request.args?.storageKey?.trim()
      return key ? `删除本地存储键「${key}」` : '删除本地存储键'
    }
    case 'storage.setKey': {
      const key = request.args?.storageKey?.trim()
      if (!key) return '写入本地存储键'
      const existed = localStorage.getItem(key) !== null
      return `${existed ? '覆盖' : '写入'}本地存储键「${key}」`
    }
  }
}

function privilegeWarning(request: TerminalPrivilegeRequest): string {
  switch (request.kind) {
    case 'mount':
      return '对该文件夹的改动会实时同步到真实的文件上且不可以撤销'
    case 'unmount':
      return '卸载后，本系统将无法再访问和修改目标文件夹'
    case 'fs.remove':
      return request.args?.fsKind === 'folder'
        ? '文件夹及其内容将被永久删除，不可恢复。'
        : '文件将被永久删除，不可恢复。'
    case 'storage.removeKey':
      return '删除 Storage 键可能会改变系统和程序的行为，并且此操作不可撤销！'
    case 'storage.setKey': {
      return '修改 Storage 可能会改变系统和程序的行为'
    }
  }
}

export function describeTerminalPrivilege(request: TerminalPrivilegeRequest): TerminalPrivilegeCopy {
  const actorLabel = resolveTerminalPrivilegeActorLabel(request)
  const action = privilegeActionPhrase(request)
  const warning = privilegeWarning(request)
  const note = request.summary.trim() || undefined
  const intentLine = `「${actorLabel}」想要${action}。`

  switch (request.kind) {
    case 'mount':
      return {
        title: '挂载本机文件夹',
        actorLabel,
        intentLine,
        warning,
        note,
        confirmLabel: '选择文件夹…',
        danger: false,
      }
    case 'unmount':
      return {
        title: '卸载文件夹',
        actorLabel,
        intentLine,
        warning,
        note,
        confirmLabel: '卸载',
        danger: false,
      }
    case 'fs.remove':
      return {
        title: request.args?.fsKind === 'folder' ? '删除文件夹' : '删除文件',
        actorLabel,
        intentLine,
        warning,
        note,
        confirmLabel: '删除',
        danger: true,
      }
    case 'storage.removeKey':
      return {
        title: '删除本地存储键',
        actorLabel,
        intentLine,
        warning,
        note,
        confirmLabel: '删除',
        danger: true,
      }
    case 'storage.setKey': {
      const key = request.args?.storageKey ?? ''
      const existed = key ? localStorage.getItem(key) !== null : false
      return {
        title: existed ? '覆盖本地存储键' : '写入本地存储键',
        actorLabel,
        intentLine,
        warning,
        note,
        confirmLabel: existed ? '覆盖' : '写入',
        danger: false,
      }
    }
    default: {
      const _exhaustive: never = request.kind
      return {
        title: '确认操作',
        actorLabel,
        intentLine: `「${actorLabel}」想要执行特权操作。`,
        warning: String(_exhaustive),
        note,
        confirmLabel: '确认',
        danger: true,
      }
    }
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

async function resolveUnmountTarget(
  request: TerminalPrivilegeRequest,
): Promise<{ id: MountFilesLocationId; label: string; path: string }> {
  const mountId = request.args?.mountId
  const mountPath = request.args?.mountPath?.trim()

  if (mountId && isMountLocationId(mountId)) {
    const mounts = await listMounts()
    const found = mounts.find((item) => item.id === mountId) ?? getCachedMount(mountId)
    if (!found) throw new Error(`挂载不存在: ${mountId}`)
    return {
      id: found.id,
      label: found.label,
      path: filesLocationPathRoot(found.id),
    }
  }

  if (mountPath) {
    const mounts = await listMounts()
    const byPath = mounts.find((item) => filesLocationPathRoot(item.id) === mountPath)
    if (byPath) {
      return {
        id: byPath.id,
        label: byPath.label,
        path: filesLocationPathRoot(byPath.id),
      }
    }
    const byLabel = mounts.find((item) => item.label === mountPath)
    if (byLabel) {
      return {
        id: byLabel.id,
        label: byLabel.label,
        path: filesLocationPathRoot(byLabel.id),
      }
    }
    throw new Error(`找不到挂载: ${mountPath}`)
  }

  throw new Error('卸载需要指定 mountId 或路径')
}

/**
 * 经 OS 确认后执行特权操作。
 * mount：确认对话框在用户点击手势内调起目录选择器并回传 handle。
 */
export async function runTerminalPrivilege(
  request: TerminalPrivilegeRequest,
): Promise<TerminalPrivilegeResult> {
  if (request.kind === 'mount' && !canMountDirectories()) {
    return {
      ok: false,
      message:
        '当前浏览器不支持挂载本机文件夹。请使用支持 File System Access API 的浏览器（如 Chrome、Edge）。',
    }
  }

  if (request.kind === 'fs.remove') {
    const path = request.args?.fsPath?.trim()
    if (!path) {
      return { ok: false, message: '缺少要删除的路径' }
    }
  }

  if (request.kind === 'storage.setKey' || request.kind === 'storage.removeKey') {
    const key = request.args?.storageKey?.trim()
    if (!key) {
      return { ok: false, message: '缺少 storageKey' }
    }
    const denial = getTerminalStorageKeyDenial(key)
    if (denial) {
      return { ok: false, message: denial }
    }
  }

  const outcome = await requestTerminalPrivilegeConfirm(request)
  if (!outcome.confirmed) {
    return { ok: false, cancelled: true, message: '用户取消' }
  }

  try {
    switch (request.kind) {
      case 'mount': {
        const handle = outcome.mountHandle
        if (!handle) {
          throw new Error('未选择文件夹')
        }
        const mount = await addMount(handle)
        const path = filesLocationPathRoot(mount.id)
        return {
          ok: true,
          message: `已挂载「${mount.label}」→ ${path}`,
        }
      }
      case 'unmount': {
        const target = await resolveUnmountTarget(request)
        await removeMount(target.id)
        return {
          ok: true,
          message: `已卸载「${target.label}」（${target.path}）`,
        }
      }
      case 'fs.remove': {
        const path = request.args?.fsPath?.trim()
        if (!path) throw new Error('缺少要删除的路径')
        await filesRemove(path)
        return {
          ok: true,
          message: `已删除 ${path}`,
        }
      }
      case 'storage.removeKey': {
        const key = request.args?.storageKey?.trim()
        if (!key) throw new Error('缺少 storageKey')
        if (localStorage.getItem(key) === null) {
          throw new Error(`键不存在: ${key}`)
        }
        localStorage.removeItem(key)
        return {
          ok: true,
          message: `已删除本地存储键 ${key}（${getLocalStorageKeyLabel(key)}）`,
        }
      }
      case 'storage.setKey': {
        const key = request.args?.storageKey?.trim()
        if (!key) throw new Error('缺少 storageKey')
        const value = request.args?.storageValue ?? ''
        const existed = localStorage.getItem(key) !== null
        localStorage.setItem(key, value)
        return {
          ok: true,
          message: `已${existed ? '覆盖' : '写入'}本地存储键 ${key}（${getLocalStorageKeyLabel(key)}，${value.length} 字符）`,
        }
      }
      default: {
        const _exhaustive: never = request.kind
        throw new Error(`未知特权操作: ${String(_exhaustive)}`)
      }
    }
  } catch (error) {
    if (isAbortError(error)) {
      return { ok: false, cancelled: true, message: '用户取消' }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message }
  }
}

export async function listTerminalMountSummaries(): Promise<
  Array<{ id: MountFilesLocationId; label: string; path: string }>
> {
  const mounts = await listMounts()
  return mounts.map((item) => ({
    id: item.id,
    label: item.label,
    path: filesLocationPathRoot(item.id),
  }))
}
