import {
  DATA_CAPACITY_BYTES,
  DATA_STORAGE_CHANGED_EVENT,
  getCombinedDataStorageBytes,
} from './device-data-storage.ts'
import {
  DEVICE_CAPACITY_BYTES,
  getTotalLocalStorageBytes,
  STORAGE_CHANGED_EVENT,
} from './device-storage.ts'
import { osOpenApp } from './os-open-app-bridge.ts'

export { STORAGE_CHANGED_EVENT, DATA_STORAGE_CHANGED_EVENT }
export const OPEN_SETTINGS_USAGE_EVENT = 'instant-os:open-settings-usage'
export const STORAGE_WARNING_SLUG = 'system:storage-warning'

const COOLDOWN_MS = 5 * 60 * 1000

export type StorageWarningScope = 'system' | 'data'
export type StorageWarningLevel = 10 | 20

export type StorageWarningNotification = {
  scope: StorageWarningScope
  level: StorageWarningLevel
  availablePercent: number
}

type ScopeWarningState = {
  recoveredAbove20: boolean
  recoveredAbove10: boolean
}

const warningStateByScope: Record<StorageWarningScope, ScopeWarningState> = {
  system: { recoveredAbove20: true, recoveredAbove10: true },
  data: { recoveredAbove20: true, recoveredAbove10: true },
}

function lastSentKey(scope: StorageWarningScope): string {
  return `instant-os-storage-warning-last-sent-at:${scope}`
}

export function getAvailableSystemStoragePercent(): number {
  const used = getTotalLocalStorageBytes()
  const available = Math.max(0, DEVICE_CAPACITY_BYTES - used)
  return (available / DEVICE_CAPACITY_BYTES) * 100
}

/** 系统空间剩余百分比（兼容旧调用）。 */
export function getAvailableStoragePercent(): number {
  return getAvailableSystemStoragePercent()
}

export async function getAvailableDataStoragePercent(): Promise<number> {
  const used = await getCombinedDataStorageBytes()
  const available = Math.max(0, DATA_CAPACITY_BYTES - used)
  return (available / DATA_CAPACITY_BYTES) * 100
}

export async function areAllStorageWarningsRecovered(): Promise<boolean> {
  const dataPercent = await getAvailableDataStoragePercent()
  return getAvailableSystemStoragePercent() >= 20 && dataPercent >= 20
}

let pendingOpenSettingsUsageView = false

export function openSettingsUsageView() {
  try {
    osOpenApp('settings')
  } catch {
    // 系统尚未挂载 openApp（极少见）；仍保留 pending，设置打开后会 consume
  }
  pendingOpenSettingsUsageView = true
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_USAGE_EVENT))
}

export function consumePendingOpenSettingsUsageView(): boolean {
  if (!pendingOpenSettingsUsageView) {
    return false
  }
  pendingOpenSettingsUsageView = false
  return true
}

function canSendNotification(scope: StorageWarningScope): boolean {
  try {
    const raw = sessionStorage.getItem(lastSentKey(scope))
    if (!raw) {
      return true
    }
    return Date.now() - Number(raw) >= COOLDOWN_MS
  } catch {
    return true
  }
}

function markNotificationSent(scope: StorageWarningScope) {
  try {
    sessionStorage.setItem(lastSentKey(scope), String(Date.now()))
  } catch {
    // ignore
  }
}

function peekScopeWarning(
  scope: StorageWarningScope,
  availablePercent: number,
): StorageWarningNotification | undefined {
  const warningState = warningStateByScope[scope]

  if (availablePercent >= 20) {
    warningState.recoveredAbove20 = true
    warningState.recoveredAbove10 = true
    return undefined
  }

  if (availablePercent >= 10) {
    warningState.recoveredAbove10 = true
  }

  if (!canSendNotification(scope)) {
    return undefined
  }

  if (availablePercent < 10 && warningState.recoveredAbove10) {
    return { scope, level: 10, availablePercent }
  }

  if (availablePercent < 20 && warningState.recoveredAbove20) {
    return { scope, level: 20, availablePercent }
  }

  return undefined
}

function commitScopeWarning(warning: StorageWarningNotification): void {
  const warningState = warningStateByScope[warning.scope]
  if (warning.level === 10) {
    warningState.recoveredAbove10 = false
    warningState.recoveredAbove20 = false
  } else {
    warningState.recoveredAbove20 = false
  }
  markNotificationSent(warning.scope)
}

function isWorseWarning(
  candidate: StorageWarningNotification,
  current: StorageWarningNotification,
): boolean {
  if (candidate.level !== current.level) {
    return candidate.level < current.level
  }
  return candidate.availablePercent < current.availablePercent
}

export async function evaluateStorageWarning(): Promise<StorageWarningNotification | undefined> {
  const systemPercent = getAvailableSystemStoragePercent()
  const dataPercent = await getAvailableDataStoragePercent()

  const systemWarning = peekScopeWarning('system', systemPercent)
  const dataWarning = peekScopeWarning('data', dataPercent)

  let chosen: StorageWarningNotification | undefined
  if (systemWarning && dataWarning) {
    chosen = isWorseWarning(dataWarning, systemWarning) ? dataWarning : systemWarning
  } else {
    chosen = systemWarning ?? dataWarning
  }

  if (chosen) {
    commitScopeWarning(chosen)
  }
  return chosen
}

export function messageForStorageWarning(
  level: StorageWarningLevel,
  scope: StorageWarningScope,
): {
  title: string
  subtitle: string
} {
  const spaceLabel = scope === 'data' ? '数据空间' : '系统空间'

  if (level === 10) {
    return {
      title: `${spaceLabel}严重不足`,
      subtitle: '可用空间已不足 10%，请尽快清理',
    }
  }

  return {
    title: `${spaceLabel}不足`,
    subtitle: '可用空间已不足 20%，建议查看用量',
  }
}
