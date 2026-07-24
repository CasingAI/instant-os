/**
 * @deprecated 随模拟终端弃用。此文件实现模拟终端的本地特权命令（mount / umount / storage / account 等），
 * 这些命令通过特权确认对话框实现敏感操作，是模拟终端本地快路径的一部分。
 * 真终端（terminal-app）通过 terminal-repl-panel.tsx 的 .reset / .clear 等命令处理，
 * 特权操作走向不同路径。
 * 保留仅为过渡，新功能不要加在这里。
 */
import { getLocalStorageKeyLabel } from '../ai/storage-inspection.ts'
import { getLocalStorageKeyBytes } from '../os/device-storage.ts'
import { formatStorageSize } from '../os/format-storage-size.ts'
import {
  createTerminalPrivilegeId,
  type TerminalPrivilegeRequest,
  type TerminalPrivilegeSource,
} from './terminal-privilege-types.ts'
import {
  listTerminalMountSummaries,
  getTerminalStorageKeyDenial,
  runTerminalPrivilege,
  TERMINAL_ACCOUNT_STORAGE_DENIED,
} from './terminal-privilege.ts'

function sourceFromSubmit(source: TerminalPrivilegeSource | undefined): TerminalPrivilegeSource {
  return source ?? 'user'
}

export async function runTerminalLocalPrivilegeCommand(
  head: string,
  rest: string,
  options?: { source?: TerminalPrivilegeSource; actorLabel?: string },
): Promise<{ handled: boolean; message?: string; error?: string }> {
  const source = sourceFromSubmit(options?.source)
  const actorLabel = options?.actorLabel?.trim() || undefined

  if (head === 'mount') {
    const request: TerminalPrivilegeRequest = {
      id: createTerminalPrivilegeId(),
      kind: 'mount',
      source,
      actorLabel,
      summary: '',
    }
    const result = await runTerminalPrivilege(request)
    if (result.cancelled) {
      return { handled: true, message: '已取消挂载' }
    }
    return {
      handled: true,
      message: result.ok ? result.message : undefined,
      error: result.ok ? undefined : result.message,
    }
  }

  if (head === 'umount' || head === 'unmount') {
    if (!rest) {
      const mounts = await listTerminalMountSummaries()
      if (mounts.length === 0) {
        return { handled: true, message: '当前没有已挂载卷。用法：umount /mount/文件夹名' }
      }
      return {
        handled: true,
        message: [
          '用法：umount <路径|标签>',
          '已挂载：',
          ...mounts.map((item) => `  ${item.path}\t${item.label}`),
        ].join('\n'),
      }
    }

    const mounts = await listTerminalMountSummaries()
    const match =
      mounts.find((item) => item.path === rest) ||
      mounts.find((item) => item.label === rest) ||
      mounts.find((item) => item.id === rest)

    const request: TerminalPrivilegeRequest = {
      id: createTerminalPrivilegeId(),
      kind: 'unmount',
      source,
      actorLabel,
      summary: '',
      args: match
        ? { mountId: match.id, mountLabel: match.label, mountPath: match.path }
        : { mountPath: rest },
    }
    const result = await runTerminalPrivilege(request)
    if (result.cancelled) {
      return { handled: true, message: '已取消卸载' }
    }
    return {
      handled: true,
      message: result.ok ? result.message : undefined,
      error: result.ok ? undefined : result.message,
    }
  }

  if (head === 'storage') {
    const subSpace = rest.search(/\s/)
    const sub = (subSpace === -1 ? rest : rest.slice(0, subSpace)).toLowerCase()
    const subRest = subSpace === -1 ? '' : rest.slice(subSpace + 1).trim()

    if (!sub || sub === 'ls' || sub === 'list') {
      const keys: string[] = []
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index)
        if (key) keys.push(key)
      }
      keys.sort((a, b) => a.localeCompare(b))
      if (keys.length === 0) {
        return { handled: true, message: '(localStorage 为空)' }
      }
      const lines = keys.map((key) => {
        const bytes = getLocalStorageKeyBytes(key)
        return `${formatStorageSize(bytes)}\t${key}\t${getLocalStorageKeyLabel(key)}`
      })
      return { handled: true, message: lines.join('\n') }
    }

    if (sub === 'rm' || sub === 'remove' || sub === 'delete') {
      if (!subRest) {
        return { handled: true, error: '用法：storage rm <key>' }
      }
      const request: TerminalPrivilegeRequest = {
        id: createTerminalPrivilegeId(),
        kind: 'storage.removeKey',
        source,
        actorLabel,
        summary: '',
        args: { storageKey: subRest },
      }
      const result = await runTerminalPrivilege(request)
      if (result.cancelled) {
        return { handled: true, message: '已取消删除' }
      }
      return {
        handled: true,
        message: result.ok ? result.message : undefined,
        error: result.ok ? undefined : result.message,
      }
    }

    if (sub === 'get' || sub === 'read' || sub === 'cat') {
      if (!subRest) {
        return { handled: true, error: '用法：storage get <key>' }
      }
      const denial = getTerminalStorageKeyDenial(subRest)
      if (denial) {
        return { handled: true, error: denial }
      }
      const value = localStorage.getItem(subRest)
      if (value === null) {
        return { handled: true, error: `键不存在: ${subRest}` }
      }
      return { handled: true, message: value }
    }

    if (sub === 'set' || sub === 'put' || sub === 'write') {
      const keySpace = subRest.search(/\s/)
      if (keySpace === -1) {
        return { handled: true, error: '用法：storage set <key> <value>' }
      }
      const key = subRest.slice(0, keySpace).trim()
      const value = subRest.slice(keySpace + 1)
      if (!key) {
        return { handled: true, error: '用法：storage set <key> <value>' }
      }
      const request: TerminalPrivilegeRequest = {
        id: createTerminalPrivilegeId(),
        kind: 'storage.setKey',
        source,
        actorLabel,
        summary: '',
        args: { storageKey: key, storageValue: value },
      }
      const result = await runTerminalPrivilege(request)
      if (result.cancelled) {
        return { handled: true, message: '已取消写入' }
      }
      return {
        handled: true,
        message: result.ok ? result.message : undefined,
        error: result.ok ? undefined : result.message,
      }
    }

    return {
      handled: true,
      error: '用法：storage ls | storage get <key> | storage set <key> <value> | storage rm <key>',
    }
  }

  if (head === 'account') {
    return {
      handled: true,
      error: TERMINAL_ACCOUNT_STORAGE_DENIED,
    }
  }

  return { handled: false }
}

export async function runTerminalPrivilegeRequest(
  request: TerminalPrivilegeRequest,
): Promise<{ message?: string; error?: string; cancelled?: boolean }> {
  const result = await runTerminalPrivilege(request)
  if (result.cancelled) {
    return { cancelled: true, message: '已取消' }
  }
  if (result.ok) {
    return { message: result.message }
  }
  return { error: result.message }
}
