import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'

/**
 * 背景刷新：系统级背景刷新机制。
 * 同一开关与刷新间隔驱动一组已注册的刷新任务；新增数据源只需在
 * BACKGROUND_REFRESH_TASKS 中登记一项（状态字段 / 执行函数 / 展示行），
 * 设置页与调度服务会自动纳入，无需改动。
 */
export type BackgroundRefreshTaskId = 'model-pricing' | 'openrouter-model-pricing'

/** 单个任务最近一次刷新的状态（写入存储） */
export type BackgroundRefreshTaskState = {
  /** 上次成功刷新的时间戳；0 表示从未刷新 */
  lastSuccessAt: number
  /** 最近一次尝试的结果；undefined 表示从未尝试 */
  lastResult: 'success' | 'failure' | undefined
}

/** 任务定义：调度所需的静态信息。存储字段名固定为 `task-state:${id}` */
export type BackgroundRefreshTaskDef = {
  id: BackgroundRefreshTaskId
  label: string
  /** 距下次到期还有多少毫秒；已到期返回 0，未启用返回 Infinity */
  msUntilDue: (now: number) => number
}

export type BackgroundRefreshSettings = {
  version: 2
  /** 总开关。关闭后不再进行任何后台拉取。 */
  enabled: boolean
  /** 刷新间隔（小时）。只允许 REFRESH_INTERVAL_OPTIONS 中的值。 */
  intervalHours: number
} & Record<`task-state:${BackgroundRefreshTaskId}`, BackgroundRefreshTaskState>

export const BACKGROUND_REFRESH_SETTINGS_CHANGED_EVENT =
  'instant-os:background-refresh-settings-changed'

export const REFRESH_INTERVAL_OPTIONS = [
  { hours: 1, label: '每小时' },
  { hours: 6, label: '每 6 小时' },
  { hours: 12, label: '每 12 小时' },
  { hours: 24, label: '每天' },
  { hours: 48, label: '每 2 天' },
  { hours: 168, label: '每周' },
] as const

const STORAGE_KEY = DEVICE_STORAGE_KEYS.backgroundRefreshSettings

const EMPTY_TASK_STATE: BackgroundRefreshTaskState = {
  lastSuccessAt: 0,
  lastResult: undefined,
}

export function taskStateStorageKey(
  taskId: BackgroundRefreshTaskId,
): `task-state:${BackgroundRefreshTaskId}` {
  return `task-state:${taskId}`
}

export function loadTaskState(
  settings: BackgroundRefreshSettings,
  taskId: BackgroundRefreshTaskId,
): BackgroundRefreshTaskState {
  return settings[taskStateStorageKey(taskId)] ?? { ...EMPTY_TASK_STATE }
}

/** 写入某个任务的最新状态（合并存储中的其余设置） */
export function patchBackgroundRefreshTaskState(
  taskId: BackgroundRefreshTaskId,
  patch: Partial<BackgroundRefreshTaskState>,
): boolean {
  const settings = loadBackgroundRefreshSettings()
  const key = taskStateStorageKey(taskId)
  return saveBackgroundRefreshSettings({
    ...settings,
    [key]: { ...loadTaskState(settings, taskId), ...patch },
  })
}

function msUntilTaskDue(taskId: BackgroundRefreshTaskId, now: number): number {
  const settings = loadBackgroundRefreshSettings()
  if (!settings.enabled) {
    return Number.POSITIVE_INFINITY
  }
  const intervalMs = settings.intervalHours * 60 * 60 * 1000
  const dueAt = loadTaskState(settings, taskId).lastSuccessAt + intervalMs
  return Math.max(0, dueAt - now)
}

export const BACKGROUND_REFRESH_TASKS: readonly BackgroundRefreshTaskDef[] = [
  {
    id: 'model-pricing',
    label: '模型定价',
    msUntilDue: (now) => msUntilTaskDue('model-pricing', now),
  },
  {
    id: 'openrouter-model-pricing',
    label: 'OpenRouter 模型定价',
    msUntilDue: (now) => msUntilTaskDue('openrouter-model-pricing', now),
  },
]

const DEFAULT_SETTINGS = {
  version: 2,
  enabled: true,
  intervalHours: 24,
} satisfies Partial<BackgroundRefreshSettings>

function defaultSettings(): BackgroundRefreshSettings {
  const settings = { ...DEFAULT_SETTINGS } as BackgroundRefreshSettings
  for (const task of BACKGROUND_REFRESH_TASKS) {
    settings[taskStateStorageKey(task.id)] = { ...EMPTY_TASK_STATE }
  }
  return settings
}

function normalizeIntervalHours(raw: unknown): number {
  const allowed = new Set<number>(REFRESH_INTERVAL_OPTIONS.map((option) => option.hours))
  if (typeof raw === 'number' && allowed.has(raw)) {
    return raw
  }
  return DEFAULT_SETTINGS.intervalHours
}

function normalizeTaskState(raw: unknown): BackgroundRefreshTaskState {
  if (!raw || typeof raw !== 'object') {
    return { ...EMPTY_TASK_STATE }
  }
  const record = raw as Record<string, unknown>
  return {
    lastSuccessAt:
      typeof record.lastSuccessAt === 'number' && record.lastSuccessAt > 0
        ? record.lastSuccessAt
        : 0,
    lastResult:
      record.lastResult === 'success' || record.lastResult === 'failure'
        ? record.lastResult
        : undefined,
  }
}

function normalizeBackgroundRefreshSettings(raw: unknown): BackgroundRefreshSettings {
  const settings = defaultSettings()
  if (!raw || typeof raw !== 'object') {
    return settings
  }

  const record = raw as Record<string, unknown>
  // 仅当存储里显式写了 enabled 时才覆盖默认开启
  if ('enabled' in record) {
    settings.enabled = record.enabled === true
  }
  settings.intervalHours = normalizeIntervalHours(record.intervalHours)
  for (const task of BACKGROUND_REFRESH_TASKS) {
    settings[taskStateStorageKey(task.id)] = normalizeTaskState(
      record[taskStateStorageKey(task.id)],
    )
  }

  // 兼容 v1：全局 lastRefreshTimestamp / lastRefreshResult 迁移为模型定价任务的状态
  const legacyTimestamp =
    typeof record.lastRefreshTimestamp === 'number' && record.lastRefreshTimestamp > 0
      ? record.lastRefreshTimestamp
      : 0
  const legacyResult =
    record.lastRefreshResult === 'success' || record.lastRefreshResult === 'failure'
      ? record.lastRefreshResult
      : undefined
  if (legacyTimestamp > 0 || legacyResult !== undefined) {
    const key = taskStateStorageKey('model-pricing')
    settings[key] = {
      lastSuccessAt: settings[key].lastSuccessAt || legacyTimestamp,
      lastResult: settings[key].lastResult ?? legacyResult,
    }
  }
  return settings
}

export function loadBackgroundRefreshSettings(): BackgroundRefreshSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return defaultSettings()
    }
    return normalizeBackgroundRefreshSettings(JSON.parse(raw))
  } catch {
    return defaultSettings()
  }
}

export function saveBackgroundRefreshSettings(settings: BackgroundRefreshSettings): boolean {
  const payload = normalizeBackgroundRefreshSettings(settings)
  if (!writeLocalStorageItem(STORAGE_KEY, JSON.stringify(payload))) {
    return false
  }
  window.dispatchEvent(new CustomEvent(BACKGROUND_REFRESH_SETTINGS_CHANGED_EVENT))
  return true
}

export function patchBackgroundRefreshSettings(
  patch: Partial<Pick<BackgroundRefreshSettings, 'enabled' | 'intervalHours'>>,
): boolean {
  return saveBackgroundRefreshSettings({ ...loadBackgroundRefreshSettings(), ...patch })
}

export function subscribeBackgroundRefreshSettings(listener: () => void): () => void {
  window.addEventListener(BACKGROUND_REFRESH_SETTINGS_CHANGED_EVENT, listener)
  return () =>
    window.removeEventListener(BACKGROUND_REFRESH_SETTINGS_CHANGED_EVENT, listener)
}

/** 全部已注册任务中最近的一次到期等待时长；未启用返回 Infinity */
export function msUntilNextScheduledRefresh(): number {
  const now = Date.now()
  return Math.min(...BACKGROUND_REFRESH_TASKS.map((task) => task.msUntilDue(now)))
}
