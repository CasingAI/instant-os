import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import type { MonacoEditorTheme } from '../../monaco/monaco-editor.tsx'

export type VscodePrefs = {
  theme: MonacoEditorTheme
  fontSize: number
  minimap: boolean
  wordWrap: boolean
  sidebarVisible: boolean
  terminalVisible: boolean
  terminalHeight: number
  sidebarWidth: number
  /** 当前工作区文件夹绝对路径；未打开时为 undefined */
  workspaceFolder: string | undefined
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.vscodePrefs

const DEFAULT_PREFS: VscodePrefs = {
  theme: 'vs-dark',
  fontSize: 13,
  minimap: true,
  wordWrap: true,
  sidebarVisible: true,
  terminalVisible: true,
  terminalHeight: 220,
  sidebarWidth: 240,
  workspaceFolder: undefined,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeWorkspaceFolder(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) return undefined
  return trimmed.replace(/\/+$/, '') || '/'
}

export function loadVscodePrefs(): VscodePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const parsed = JSON.parse(raw) as Partial<VscodePrefs>
    return {
      theme: parsed.theme === 'vs' || parsed.theme === 'hc-black' ? parsed.theme : 'vs-dark',
      fontSize: typeof parsed.fontSize === 'number' ? clamp(parsed.fontSize, 10, 24) : DEFAULT_PREFS.fontSize,
      minimap: parsed.minimap !== false,
      wordWrap: parsed.wordWrap !== false,
      sidebarVisible: parsed.sidebarVisible !== false,
      terminalVisible: parsed.terminalVisible !== false,
      terminalHeight:
        typeof parsed.terminalHeight === 'number'
          ? clamp(parsed.terminalHeight, 120, 480)
          : DEFAULT_PREFS.terminalHeight,
      sidebarWidth:
        typeof parsed.sidebarWidth === 'number'
          ? clamp(parsed.sidebarWidth, 160, 420)
          : DEFAULT_PREFS.sidebarWidth,
      workspaceFolder: normalizeWorkspaceFolder(parsed.workspaceFolder),
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function saveVscodePrefs(prefs: VscodePrefs): void {
  writeLocalStorageItem(STORAGE_KEY, JSON.stringify(prefs))
}
