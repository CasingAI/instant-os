import { showMountDisconnectedNotification } from '../../os/mount-disconnected.ts'
import {
  getMount,
  listMounts,
  removeMount,
  type FilesMountRecord,
} from './files-mount-store.ts'
import type { MountFilesLocationId } from './files-types.ts'

export type MountPermissionPending = {
  mountId: MountFilesLocationId
  label: string
}

type GateWaiter = {
  resolve: () => void
  reject: (error: Error) => void
}

type GateEntry = {
  mountId: MountFilesLocationId
  label: string
  handle: FileSystemDirectoryHandle
  waiters: GateWaiter[]
}

const PERMISSION_OPTIONS = { mode: 'readwrite' as const }

let current: GateEntry | undefined
const queue: GateEntry[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function permissionError(message: string): Error {
  return new Error(message)
}

export function getPendingMountPermission(): MountPermissionPending | undefined {
  if (!current) return undefined
  return { mountId: current.mountId, label: current.label }
}

export function subscribeMountPermissionGate(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

async function queryReadWritePermission(
  handle: FileSystemDirectoryHandle,
): Promise<'granted' | 'denied' | 'prompt' | 'unsupported'> {
  if (typeof handle.queryPermission !== 'function') {
    return 'unsupported'
  }
  return handle.queryPermission(PERMISSION_OPTIONS)
}

async function yankMount(mountId: MountFilesLocationId, label: string): Promise<void> {
  try {
    await removeMount(mountId)
  } catch {
    // 记录可能已被移除；仍通知用户
  }
  showMountDisconnectedNotification(label)
}

function rejectWaiters(entry: GateEntry, error: Error): void {
  for (const waiter of entry.waiters) {
    waiter.reject(error)
  }
  entry.waiters = []
}

function resolveWaiters(entry: GateEntry): void {
  for (const waiter of entry.waiters) {
    waiter.resolve()
  }
  entry.waiters = []
}

function findEntry(mountId: MountFilesLocationId): GateEntry | undefined {
  if (current?.mountId === mountId) return current
  return queue.find((item) => item.mountId === mountId)
}

function promoteNext(): void {
  current = queue.shift()
  emit()
  if (!current) return

  void (async () => {
    const entry = current
    if (!entry) return
    const status = await queryReadWritePermission(entry.handle)
    if (current !== entry) return

    if (status === 'granted' || status === 'unsupported') {
      resolveWaiters(entry)
      promoteNext()
      return
    }

    if (status === 'denied') {
      await yankMount(entry.mountId, entry.label)
      rejectWaiters(
        entry,
        permissionError('外部文件夹未获授权，系统已卸载该容器'),
      )
      promoteNext()
    }
    // prompt：保持当前项，等待 UI
  })()
}

/** 将挂载加入权限确认队列；可选 waiter 会在授权成功/失败时结算。 */
function enqueueGate(
  mountId: MountFilesLocationId,
  label: string,
  handle: FileSystemDirectoryHandle,
  waiter?: GateWaiter,
): void {
  const existing = findEntry(mountId)
  if (existing) {
    existing.label = label
    existing.handle = handle
    if (waiter) existing.waiters.push(waiter)
    return
  }

  const next: GateEntry = {
    mountId,
    label,
    handle,
    waiters: waiter ? [waiter] : [],
  }

  if (!current) {
    current = next
    emit()
  } else {
    queue.push(next)
  }
}

/**
 * 确保挂载卷可读写。若需用户确认，入队等待全屏提示中的授权手势；
 * 拒绝或 Chrome 未授予则卸卷并通知。
 */
export async function ensureMountPermission(
  mountId: MountFilesLocationId,
  label: string,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const status = await queryReadWritePermission(handle)

  if (status === 'granted' || status === 'unsupported') {
    return
  }

  if (status === 'denied') {
    await yankMount(mountId, label)
    throw permissionError('外部文件夹未获授权，系统已卸载该容器')
  }

  if (typeof handle.requestPermission !== 'function') {
    await yankMount(mountId, label)
    throw permissionError('外部文件夹未获授权，系统已卸载该容器')
  }

  return new Promise<void>((resolve, reject) => {
    enqueueGate(mountId, label, handle, { resolve, reject })
  })
}

/** 用户点击「授权」时调用；必须在用户手势同步链中触发 requestPermission。 */
export async function grantPendingMountPermission(): Promise<void> {
  const entry = current
  if (!entry) return

  if (typeof entry.handle.requestPermission !== 'function') {
    await yankMount(entry.mountId, entry.label)
    rejectWaiters(
      entry,
      permissionError('外部文件夹未获授权，系统已卸载该容器'),
    )
    promoteNext()
    return
  }

  const status = await entry.handle.requestPermission(PERMISSION_OPTIONS)
  if (current !== entry) return

  if (status === 'granted') {
    resolveWaiters(entry)
    promoteNext()
    return
  }

  await yankMount(entry.mountId, entry.label)
  rejectWaiters(
    entry,
    permissionError('外部文件夹未获授权，系统已卸载该容器'),
  )
  promoteNext()
}

/** 用户关闭提示或点「不允许」。 */
export async function denyPendingMountPermission(): Promise<void> {
  const entry = current
  if (!entry) return

  await yankMount(entry.mountId, entry.label)
  rejectWaiters(
    entry,
    permissionError('外部文件夹未获授权，系统已卸载该容器'),
  )
  promoteNext()
}

async function enqueueIfPrompt(mount: FilesMountRecord): Promise<void> {
  const status = await queryReadWritePermission(mount.handle)
  if (status === 'prompt') {
    enqueueGate(mount.id, mount.label, mount.handle)
    return
  }
  if (status === 'denied') {
    await yankMount(mount.id, mount.label)
  }
}

/** 壳层启动时扫描已保存挂载；仅入队，不调用 requestPermission。 */
export async function scanMountPermissionsNeedingPrompt(): Promise<void> {
  const mounts = await listMounts()
  for (const mount of mounts) {
    await enqueueIfPrompt(mount)
  }
}

/** 若挂载记录仍在且需确认，则入队（供外部在获知 id 后补扫）。 */
export async function enqueueMountPermissionIfNeeded(
  mountId: MountFilesLocationId,
): Promise<void> {
  const mount = await getMount(mountId)
  if (!mount) return
  await enqueueIfPrompt(mount)
}
