import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../os/device-storage.ts'

const STORAGE_KEY = DEVICE_STORAGE_KEYS.terminalCommandHistory

export const TERMINAL_COMMAND_HISTORY_LIMIT = 200

export type TerminalCommandHistory = {
  version: 1
  /** 旧 → 新 */
  commands: string[]
}

function normalizeCommands(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const commands: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const command = item.replace(/\r$/, '')
    if (!command.trim()) continue
    if (commands[commands.length - 1] === command) continue
    commands.push(command)
  }
  return commands.length > TERMINAL_COMMAND_HISTORY_LIMIT
    ? commands.slice(-TERMINAL_COMMAND_HISTORY_LIMIT)
    : commands
}

export function loadTerminalCommandHistory(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Partial<TerminalCommandHistory>
    return normalizeCommands(parsed.commands)
  } catch {
    return []
  }
}

export function saveTerminalCommandHistory(commands: string[]): void {
  const payload: TerminalCommandHistory = {
    version: 1,
    commands: normalizeCommands(commands),
  }
  writeLocalStorageItem(STORAGE_KEY, JSON.stringify(payload))
}

export function pushTerminalCommandHistory(history: string[], raw: string): string[] {
  const command = raw.replace(/\r$/, '')
  if (!command.trim()) return history
  if (history[history.length - 1] === command) return history
  const next = [...history, command]
  return next.length > TERMINAL_COMMAND_HISTORY_LIMIT
    ? next.slice(-TERMINAL_COMMAND_HISTORY_LIMIT)
    : next
}
