import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from './device-storage.ts'

export type StartupItem = {
  id: string
  /** 是否在系统启动时执行 */
  enabled: boolean
  /** 可选显示名称；为空时 UI 用命令摘要 */
  label: string
  /** 与终端相同的 JavaScript（可使用 instant.* / fs 等） */
  command: string
}

export type StartupItemsSettings = {
  version: 1
  items: StartupItem[]
}

export const STARTUP_ITEMS_SETTINGS_CHANGED_EVENT = 'instant-os:startup-items-settings-changed'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.startupItemsSettings

function createStartupItemId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `startup-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function createStartupItem(partial?: Partial<Omit<StartupItem, 'id'>>): StartupItem {
  return {
    id: createStartupItemId(),
    enabled: partial?.enabled ?? true,
    label: partial?.label ?? '',
    command: partial?.command ?? '',
  }
}

/** 列表与日志用的显示名：优先名称，否则命令摘要。 */
export function startupItemDisplayLabel(item: Pick<StartupItem, 'label' | 'command'>): string {
  const label = item.label.trim()
  if (label) {
    return label
  }
  const command = item.command.trim().replace(/\s+/g, ' ')
  if (!command) {
    return '未命名启动项'
  }
  return command.length > 48 ? `${command.slice(0, 48)}…` : command
}

/** 列表副行：单行命令预览。 */
export function startupItemCommandPreview(item: Pick<StartupItem, 'command'>): string {
  const command = item.command.trim().replace(/\s+/g, ' ')
  if (!command) {
    return '未填写命令'
  }
  return command
}

function normalizeStartupItem(raw: unknown): StartupItem | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const record = raw as Record<string, unknown>
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : createStartupItemId()
  const command = typeof record.command === 'string' ? record.command : ''
  const label = typeof record.label === 'string' ? record.label : ''
  return {
    id,
    enabled: record.enabled !== false,
    label,
    command,
  }
}

function normalizeStartupItemsSettings(raw: unknown): StartupItemsSettings {
  if (!raw || typeof raw !== 'object') {
    return { version: 1, items: [] }
  }
  const record = raw as Record<string, unknown>
  const itemsRaw = Array.isArray(record.items) ? record.items : []
  const items: StartupItem[] = []
  for (const entry of itemsRaw) {
    const item = normalizeStartupItem(entry)
    if (item) {
      items.push(item)
    }
  }
  return { version: 1, items }
}

export function loadStartupItemsSettings(): StartupItemsSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { version: 1, items: [] }
    }
    return normalizeStartupItemsSettings(JSON.parse(raw))
  } catch {
    return { version: 1, items: [] }
  }
}

/** 已启用且命令非空的启动项（按保存顺序）。 */
export function getEnabledStartupItems(): StartupItem[] {
  return loadStartupItemsSettings().items.filter(
    (item) => item.enabled && item.command.trim().length > 0,
  )
}

export function saveStartupItemsSettings(settings: StartupItemsSettings): boolean {
  const normalized = normalizeStartupItemsSettings(settings)
  const serialized = JSON.stringify(normalized)
  if (!writeLocalStorageItem(STORAGE_KEY, serialized)) {
    return false
  }
  window.dispatchEvent(new CustomEvent(STARTUP_ITEMS_SETTINGS_CHANGED_EVENT))
  return true
}

export function subscribeStartupItemsSettings(listener: () => void): () => void {
  window.addEventListener(STARTUP_ITEMS_SETTINGS_CHANGED_EVENT, listener)
  return () => {
    window.removeEventListener(STARTUP_ITEMS_SETTINGS_CHANGED_EVENT, listener)
  }
}
