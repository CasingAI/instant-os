import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import { isMonacoEditorTheme, type MonacoEditorTheme } from '../../monaco/monaco-themes.ts'
import { normalizeVscodeAiMode, type VscodeAiMode } from './vscode-ai-mode.ts'

export type VscodePanelTab = 'problems' | 'terminal' | 'logs'

export type VscodeSearchPrefs = {
  isCaseSensitive: boolean
  matchWholeWord: boolean
  isRegex: boolean
  preserveCase: boolean
  showReplace: boolean
  showDetails: boolean
  useExcludeSettingsAndIgnoreFiles: boolean
  onlyOpenEditors: boolean
  onlyChangedFiles: boolean
  searchHistory: string[]
  replaceHistory: string[]
  searchEditorContextLines: number
}

/** VS Code 本地覆盖的上下文窗口；缺省视为跟随系统（钥匙串）配置 */
export type VscodeAiContextWindowPref = 'system' | 64000 | 128000

export type VscodeAiModelOptionPrefs = {
  thinkingEnabled?: boolean
  /** 上下文窗口覆盖；缺省 / system = 跟随钥匙串解析 */
  contextWindow?: VscodeAiContextWindowPref
}

/** 模型来源：副基座首选 / 基座首选 / 用户指定（Agent 与补全共用） */
export type VscodeModelSource = 'text-secondary' | 'text' | 'custom'
/** @deprecated 使用 VscodeModelSource */
export type VscodeCompletionModelSource = VscodeModelSource

/** 内置 Sub Agent（explore/general）的 VS Code 侧 override：仅 enabled + 模型 */
export type VscodeSubAgentBuiltinOverride = {
  enabled?: boolean
  modelSource?: VscodeModelSource
  modelKey?: string
}

/** 用户自定义 Sub Agent（全局，不随工作区） */
export type VscodeCustomSubAgent = {
  id: string
  description: string
  prompt: string
  access: 'readonly' | 'full'
  enabled?: boolean
  modelSource?: VscodeModelSource
  modelKey?: string
}

export type VscodePrefs = {
  theme: MonacoEditorTheme
  fontSize: number
  minimap: boolean
  wordWrap: boolean
  sidebarVisible: boolean
  terminalVisible: boolean
  /** 底部面板当前页：问题 / 终端 / 日志 */
  panelTab: VscodePanelTab
  terminalHeight: number
  sidebarWidth: number
  /** 当前工作区文件夹绝对路径；未打开时为 undefined */
  workspaceFolder: string | undefined
  search: VscodeSearchPrefs
  aiMode: VscodeAiMode
  /** Agent 模型来源；默认基座 */
  aiModelSource: VscodeModelSource
  /** Agent 指定模型（仅 aiModelSource === 'custom' 时使用） */
  aiModelKey: string | undefined
  /** 按模型键覆盖供应商级 thinking 等选项 */
  aiModelOptions: Record<string, VscodeAiModelOptionPrefs>
  /** Debug：在聊天气泡旁显示本轮注入的 <system-reminder> */
  aiDebugSystemReminder: boolean
  /** AI 内联代码补全（幽灵文本）；默认关闭，需用户主动开启 */
  completionEnabled: boolean
  /** 补全模型来源；默认副基座 */
  completionModelSource: VscodeModelSource
  /** 补全指定模型（仅 completionModelSource === 'custom' 时使用） */
  completionModelKey: string | undefined
  /** 停止输入后触发补全的防抖毫秒数 */
  completionDebounceMs: number
  /** 是否启用 Sub Agent（VS Code 默认开启；系统层无总开关） */
  subAgentsEnabled: boolean
  /** 同时运行的 Sub Agent 上限 */
  subAgentsMaxConcurrent: number
  /** 内置 explore/general 的 enabled + 模型 override（不可改 prompt） */
  subAgentBuiltinOverrides: {
    explore?: VscodeSubAgentBuiltinOverride
    general?: VscodeSubAgentBuiltinOverride
  }
  /** 自定义 Sub Agent 列表（全局） */
  customSubAgents: VscodeCustomSubAgent[]
}

const STORAGE_KEY = DEVICE_STORAGE_KEYS.vscodePrefs
const MAX_SEARCH_HISTORY = 20

export const DEFAULT_SEARCH_PREFS: VscodeSearchPrefs = {
  isCaseSensitive: false,
  matchWholeWord: false,
  isRegex: false,
  preserveCase: false,
  showReplace: false,
  showDetails: false,
  useExcludeSettingsAndIgnoreFiles: true,
  onlyOpenEditors: false,
  onlyChangedFiles: false,
  searchHistory: [],
  replaceHistory: [],
  searchEditorContextLines: 1,
}

const DEFAULT_COMPLETION_DEBOUNCE_MS = 400
const DEFAULT_SUB_AGENTS_MAX_CONCURRENT = 5
const MIN_SUB_AGENTS_MAX_CONCURRENT = 1
const MAX_SUB_AGENTS_MAX_CONCURRENT = 20

const DEFAULT_PREFS: VscodePrefs = {
  theme: 'light-plus',
  fontSize: 13,
  minimap: true,
  wordWrap: true,
  sidebarVisible: true,
  terminalVisible: true,
  panelTab: 'terminal',
  terminalHeight: 220,
  sidebarWidth: 240,
  workspaceFolder: undefined,
  search: { ...DEFAULT_SEARCH_PREFS },
  aiMode: 'ask',
  aiModelSource: 'text',
  aiModelKey: undefined,
  aiModelOptions: {},
  aiDebugSystemReminder: false,
  completionEnabled: false,
  completionModelSource: 'text-secondary',
  completionModelKey: undefined,
  completionDebounceMs: DEFAULT_COMPLETION_DEBOUNCE_MS,
  subAgentsEnabled: true,
  subAgentsMaxConcurrent: DEFAULT_SUB_AGENTS_MAX_CONCURRENT,
  subAgentBuiltinOverrides: {},
  customSubAgents: [],
}

function normalizeContextWindowPref(
  value: unknown,
): VscodeAiContextWindowPref | undefined {
  if (value === 'system' || value === 64000 || value === 128000) return value
  return undefined
}

function normalizeModelSource(
  value: unknown,
  hasCustomKey: boolean,
  fallback: VscodeModelSource,
): VscodeModelSource {
  if (value === 'text-secondary' || value === 'text' || value === 'custom') {
    return value
  }
  // 旧偏好：已有自定义 key 视为指定模型；否则用场景默认
  return hasCustomKey ? 'custom' : fallback
}

function normalizeAiModelOptions(value: unknown): Record<string, VscodeAiModelOptionPrefs> {
  if (!value || typeof value !== 'object') return {}
  const result: Record<string, VscodeAiModelOptionPrefs> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const trimmedKey = key.trim()
    if (!trimmedKey || !entry || typeof entry !== 'object') continue
    const raw = entry as { thinkingEnabled?: unknown; contextWindow?: unknown }
    const next: VscodeAiModelOptionPrefs = {}
    if (typeof raw.thinkingEnabled === 'boolean') {
      next.thinkingEnabled = raw.thinkingEnabled
    }
    const contextWindow = normalizeContextWindowPref(raw.contextWindow)
    if (contextWindow !== undefined) {
      next.contextWindow = contextWindow
    }
    if (next.thinkingEnabled !== undefined || next.contextWindow !== undefined) {
      result[trimmedKey] = next
    }
  }
  return result
}

function normalizePanelTab(value: unknown): VscodePanelTab {
  if (value === 'problems' || value === 'logs') return value
  return 'terminal'
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

function normalizeHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, MAX_SEARCH_HISTORY)
}

function normalizeSearchPrefs(value: unknown): VscodeSearchPrefs {
  const raw = value && typeof value === 'object' ? (value as Partial<VscodeSearchPrefs>) : {}
  return {
    isCaseSensitive: raw.isCaseSensitive === true,
    matchWholeWord: raw.matchWholeWord === true,
    isRegex: raw.isRegex === true,
    preserveCase: raw.preserveCase === true,
    showReplace: raw.showReplace === true,
    showDetails: raw.showDetails === true,
    useExcludeSettingsAndIgnoreFiles: raw.useExcludeSettingsAndIgnoreFiles !== false,
    onlyOpenEditors: raw.onlyOpenEditors === true,
    onlyChangedFiles: raw.onlyChangedFiles === true,
    searchHistory: normalizeHistory(raw.searchHistory),
    replaceHistory: normalizeHistory(raw.replaceHistory),
    searchEditorContextLines:
      typeof raw.searchEditorContextLines === 'number'
        ? clamp(raw.searchEditorContextLines, 0, 10)
        : DEFAULT_SEARCH_PREFS.searchEditorContextLines,
  }
}

function normalizeOptionalModelSource(value: unknown): VscodeModelSource | undefined {
  if (value === 'text-secondary' || value === 'text' || value === 'custom') return value
  return undefined
}

function normalizeSubAgentBuiltinOverride(
  value: unknown,
): VscodeSubAgentBuiltinOverride | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as {
    enabled?: unknown
    modelSource?: unknown
    modelKey?: unknown
  }
  const next: VscodeSubAgentBuiltinOverride = {}
  if (typeof raw.enabled === 'boolean') next.enabled = raw.enabled
  const modelSource = normalizeOptionalModelSource(raw.modelSource)
  if (modelSource) next.modelSource = modelSource
  if (typeof raw.modelKey === 'string' && raw.modelKey.trim()) {
    next.modelKey = raw.modelKey.trim()
  }
  if (
    next.enabled === undefined &&
    next.modelSource === undefined &&
    next.modelKey === undefined
  ) {
    return undefined
  }
  return next
}

function normalizeSubAgentBuiltinOverrides(value: unknown): VscodePrefs['subAgentBuiltinOverrides'] {
  if (!value || typeof value !== 'object') return {}
  const raw = value as {
    explore?: unknown
    general?: unknown
  }
  const result: VscodePrefs['subAgentBuiltinOverrides'] = {}
  const explore = normalizeSubAgentBuiltinOverride(raw.explore)
  const general = normalizeSubAgentBuiltinOverride(raw.general)
  if (explore) result.explore = explore
  if (general) result.general = general
  return result
}

function normalizeCustomSubAgents(value: unknown): VscodeCustomSubAgent[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: VscodeCustomSubAgent[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const raw = entry as {
      id?: unknown
      description?: unknown
      prompt?: unknown
      access?: unknown
      enabled?: unknown
      modelSource?: unknown
      modelKey?: unknown
    }
    const id =
      typeof raw.id === 'string'
        ? raw.id
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '')
        : ''
    if (!id || id === 'explore' || id === 'general' || seen.has(id)) continue
    const prompt = typeof raw.prompt === 'string' ? raw.prompt : ''
    if (!prompt.trim()) continue
    seen.add(id)
    const modelSource = normalizeOptionalModelSource(raw.modelSource)
    result.push({
      id,
      description:
        typeof raw.description === 'string' && raw.description.trim()
          ? raw.description.trim()
          : id,
      prompt,
      access: raw.access === 'readonly' ? 'readonly' : 'full',
      enabled: raw.enabled !== false,
      modelSource,
      modelKey:
        typeof raw.modelKey === 'string' && raw.modelKey.trim()
          ? raw.modelKey.trim()
          : undefined,
    })
  }
  return result
}

export function pushSearchHistory(history: string[], query: string): string[] {
  const trimmed = query.trim()
  if (!trimmed) return history
  const next = [trimmed, ...history.filter((item) => item !== trimmed)]
  return next.slice(0, MAX_SEARCH_HISTORY)
}

export function loadVscodePrefs(): VscodePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PREFS, search: { ...DEFAULT_SEARCH_PREFS } }
    const parsed = JSON.parse(raw) as Partial<VscodePrefs>
    return {
      theme: isMonacoEditorTheme(parsed.theme) ? parsed.theme : DEFAULT_PREFS.theme,
      fontSize: typeof parsed.fontSize === 'number' ? clamp(parsed.fontSize, 10, 24) : DEFAULT_PREFS.fontSize,
      minimap: parsed.minimap !== false,
      wordWrap: parsed.wordWrap !== false,
      sidebarVisible: parsed.sidebarVisible !== false,
      terminalVisible: parsed.terminalVisible !== false,
      panelTab: normalizePanelTab(parsed.panelTab),
      terminalHeight:
        typeof parsed.terminalHeight === 'number'
          ? clamp(parsed.terminalHeight, 120, 720)
          : DEFAULT_PREFS.terminalHeight,
      sidebarWidth:
        typeof parsed.sidebarWidth === 'number' && Number.isFinite(parsed.sidebarWidth)
          ? Math.max(0, parsed.sidebarWidth)
          : DEFAULT_PREFS.sidebarWidth,
      workspaceFolder: normalizeWorkspaceFolder(parsed.workspaceFolder),
      search: normalizeSearchPrefs(parsed.search),
      aiMode: normalizeVscodeAiMode(parsed.aiMode),
      aiModelKey:
        typeof parsed.aiModelKey === 'string' && parsed.aiModelKey.trim()
          ? parsed.aiModelKey.trim()
          : undefined,
      aiModelSource: normalizeModelSource(
        (parsed as { aiModelSource?: unknown }).aiModelSource,
        typeof parsed.aiModelKey === 'string' && parsed.aiModelKey.trim().length > 0,
        'text',
      ),
      aiModelOptions: normalizeAiModelOptions(parsed.aiModelOptions),
      aiDebugSystemReminder: parsed.aiDebugSystemReminder === true,
      completionEnabled: parsed.completionEnabled === true,
      completionModelKey:
        typeof parsed.completionModelKey === 'string' && parsed.completionModelKey.trim()
          ? parsed.completionModelKey.trim()
          : undefined,
      completionModelSource: normalizeModelSource(
        (parsed as { completionModelSource?: unknown }).completionModelSource,
        typeof parsed.completionModelKey === 'string' &&
          parsed.completionModelKey.trim().length > 0,
        'text-secondary',
      ),
      completionDebounceMs:
        typeof parsed.completionDebounceMs === 'number' && Number.isFinite(parsed.completionDebounceMs)
          ? clamp(Math.round(parsed.completionDebounceMs), 100, 2000)
          : DEFAULT_PREFS.completionDebounceMs,
      subAgentsEnabled: parsed.subAgentsEnabled !== false,
      subAgentsMaxConcurrent:
        typeof parsed.subAgentsMaxConcurrent === 'number' &&
        Number.isFinite(parsed.subAgentsMaxConcurrent)
          ? clamp(
              Math.round(parsed.subAgentsMaxConcurrent),
              MIN_SUB_AGENTS_MAX_CONCURRENT,
              MAX_SUB_AGENTS_MAX_CONCURRENT,
            )
          : DEFAULT_PREFS.subAgentsMaxConcurrent,
      subAgentBuiltinOverrides: normalizeSubAgentBuiltinOverrides(
        parsed.subAgentBuiltinOverrides,
      ),
      customSubAgents: normalizeCustomSubAgents(parsed.customSubAgents),
    }
  } catch {
    return { ...DEFAULT_PREFS, search: { ...DEFAULT_SEARCH_PREFS } }
  }
}

export function saveVscodePrefs(prefs: VscodePrefs): void {
  writeLocalStorageItem(STORAGE_KEY, JSON.stringify(prefs))
}
