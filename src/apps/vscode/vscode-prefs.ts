import { DEVICE_STORAGE_KEYS, writeLocalStorageItem } from '../../os/device-storage.ts'
import { isMonacoEditorTheme, type MonacoEditorTheme } from '../../monaco/monaco-themes.ts'
import { normalizeVscodeAiMode, type VscodeAiMode } from './vscode-ai-mode.ts'

export type VscodePanelTab = 'problems' | 'terminal' | 'logs'

export type VscodeSidebarView = 'explorer' | 'search' | 'settings'

const MAX_EXPLORER_EXPANDED_PATHS = 500

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

/** VS Code 本地可选手动上下文档位（token）；覆盖系统预设时选用 */
export const VSCODE_AI_CONTEXT_WINDOW_PRESETS = [
  64_000, 128_000, 200_000, 256_000, 400_000, 512_000, 1_000_000, 1_050_000,
] as const

export type VscodeAiContextWindowPreset =
  (typeof VSCODE_AI_CONTEXT_WINDOW_PRESETS)[number]

/** VS Code 本地覆盖的上下文窗口；缺省视为跟随系统（钥匙串）配置 */
export type VscodeAiContextWindowPref = 'system' | VscodeAiContextWindowPreset

/** 思考深度档位全集；default = 不传参数。实际可选集按模型过滤 */
export const VSCODE_AI_THINKING_EFFORT_PRESETS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export type VscodeAiThinkingEffortPreset =
  (typeof VSCODE_AI_THINKING_EFFORT_PRESETS)[number]

export type VscodeAiThinkingEffortPref = 'default' | VscodeAiThinkingEffortPreset

export type VscodeAiModelOptionPrefs = {
  thinkingEnabled?: boolean
  /** 思考深度（reasoning_effort）；缺省 / default = 不传 */
  thinkingEffort?: VscodeAiThinkingEffortPref
  /** 上下文窗口覆盖；缺省 / system = 跟随钥匙串解析 */
  contextWindow?: VscodeAiContextWindowPref
}

/** 模型来源：副基座首选 / 基座首选 / 用户指定（Agent 与补全共用） */
export type VscodeModelSource = 'text-secondary' | 'text' | 'custom'
/** @deprecated 使用 VscodeModelSource */
export type VscodeCompletionModelSource = VscodeModelSource

/** Sub Agent 模型来源；vision 仅内置识图 Agent */
export type VscodeSubAgentModelSource = VscodeModelSource | 'vision'

/** 内置 Sub Agent（explore/general/vision）的 VS Code 侧 override：仅 enabled + 模型 */
export type VscodeSubAgentBuiltinOverride = {
  enabled?: boolean
  modelSource?: VscodeSubAgentModelSource
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
  /** 侧栏当前视图：工作区 / 搜索 / 设置 */
  sidebarView: VscodeSidebarView
  terminalVisible: boolean
  /** 底部面板当前页：问题 / 终端 / 日志 */
  panelTab: VscodePanelTab
  terminalHeight: number
  sidebarWidth: number
  /** 当前工作区文件夹绝对路径；未打开时为 undefined */
  workspaceFolder: string | undefined
  /**
   * 各工作区已展开的文件夹路径。
   * 缺省键表示尚未记住（打开时默认展开根）；空数组表示用户已全部收起。
   */
  explorerExpandedPathsByWorkspace: Record<string, string[]>
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
  /**
   * Agent 单轮流式空闲超时秒数：多久无新数据视为超时。
   * 默认 60；最小 5。
   */
  aiIdleTimeoutSeconds: number
  /**
   * Agent 单轮流式空闲超时后的额外重试次数（不含首次）。
   * 默认 10；0 表示超时后不重试。
   */
  aiIdleRetryCount: number
  /**
   * Agent 任务完成且发送队列为空时播放系统完成提示音。
   * 默认开启；用户中止或还有排队任务时不播放。
   */
  aiPlayCompletionSound: boolean
  /** 是否启用 Sub Agent（VS Code 默认开启；系统层无总开关） */
  subAgentsEnabled: boolean
  /** 同时运行的 Sub Agent 上限 */
  subAgentsMaxConcurrent: number
  /** 内置 explore/general/vision 的 enabled + 模型 override（不可改 prompt） */
  subAgentBuiltinOverrides: {
    explore?: VscodeSubAgentBuiltinOverride
    general?: VscodeSubAgentBuiltinOverride
    vision?: VscodeSubAgentBuiltinOverride
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
const DEFAULT_AI_IDLE_TIMEOUT_SECONDS = 60
const MIN_AI_IDLE_TIMEOUT_SECONDS = 5
const MAX_AI_IDLE_TIMEOUT_SECONDS = 600
const DEFAULT_AI_IDLE_RETRY_COUNT = 10
const MIN_AI_IDLE_RETRY_COUNT = 0
const MAX_AI_IDLE_RETRY_COUNT = 50
const DEFAULT_SUB_AGENTS_MAX_CONCURRENT = 5
const MIN_SUB_AGENTS_MAX_CONCURRENT = 1
const MAX_SUB_AGENTS_MAX_CONCURRENT = 20

const DEFAULT_PREFS: VscodePrefs = {
  theme: 'light-plus',
  fontSize: 13,
  minimap: true,
  wordWrap: true,
  sidebarVisible: true,
  sidebarView: 'explorer',
  terminalVisible: true,
  panelTab: 'terminal',
  terminalHeight: 220,
  sidebarWidth: 240,
  workspaceFolder: undefined,
  explorerExpandedPathsByWorkspace: {},
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
  aiIdleTimeoutSeconds: DEFAULT_AI_IDLE_TIMEOUT_SECONDS,
  aiIdleRetryCount: DEFAULT_AI_IDLE_RETRY_COUNT,
  aiPlayCompletionSound: true,
  subAgentsEnabled: true,
  subAgentsMaxConcurrent: DEFAULT_SUB_AGENTS_MAX_CONCURRENT,
  subAgentBuiltinOverrides: {},
  customSubAgents: [],
}

function isThinkingEffortPreset(
  value: unknown,
): value is VscodeAiThinkingEffortPreset {
  return (
    typeof value === 'string' &&
    (VSCODE_AI_THINKING_EFFORT_PRESETS as readonly string[]).includes(value)
  )
}

function normalizeThinkingEffortPref(
  value: unknown,
): VscodeAiThinkingEffortPref | undefined {
  if (value === 'default' || isThinkingEffortPreset(value)) return value
  return undefined
}

function isContextWindowPreset(value: unknown): value is VscodeAiContextWindowPreset {
  return (
    typeof value === 'number' &&
    (VSCODE_AI_CONTEXT_WINDOW_PRESETS as readonly number[]).includes(value)
  )
}

function normalizeContextWindowPref(
  value: unknown,
): VscodeAiContextWindowPref | undefined {
  if (value === 'system' || isContextWindowPreset(value)) return value
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
    const raw = entry as {
      thinkingEnabled?: unknown
      thinkingEffort?: unknown
      contextWindow?: unknown
    }
    const next: VscodeAiModelOptionPrefs = {}
    if (typeof raw.thinkingEnabled === 'boolean') {
      next.thinkingEnabled = raw.thinkingEnabled
    }
    const thinkingEffort = normalizeThinkingEffortPref(raw.thinkingEffort)
    if (thinkingEffort !== undefined) {
      next.thinkingEffort = thinkingEffort
    }
    const contextWindow = normalizeContextWindowPref(raw.contextWindow)
    if (contextWindow !== undefined) {
      next.contextWindow = contextWindow
    }
    if (
      next.thinkingEnabled !== undefined ||
      next.thinkingEffort !== undefined ||
      next.contextWindow !== undefined
    ) {
      result[trimmedKey] = next
    }
  }
  return result
}

function normalizePanelTab(value: unknown): VscodePanelTab {
  if (value === 'problems' || value === 'logs') return value
  return 'terminal'
}

function normalizeSidebarView(value: unknown): VscodeSidebarView {
  if (value === 'search' || value === 'settings' || value === 'explorer') return value
  return 'explorer'
}

function normalizeExplorerExpandedPathsByWorkspace(
  value: unknown,
): Record<string, string[]> {
  if (!value || typeof value !== 'object') return {}
  const result: Record<string, string[]> = {}
  for (const [key, paths] of Object.entries(value as Record<string, unknown>)) {
    const folder = key.trim()
    if (!folder || !Array.isArray(paths)) continue
    const normalized: string[] = []
    const seen = new Set<string>()
    for (const path of paths) {
      if (typeof path !== 'string') continue
      const trimmed = path.trim()
      if (!trimmed || seen.has(trimmed)) continue
      seen.add(trimmed)
      normalized.push(trimmed)
      if (normalized.length >= MAX_EXPLORER_EXPANDED_PATHS) break
    }
    result[folder] = normalized
  }
  return result
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

function normalizeOptionalSubAgentModelSource(
  value: unknown,
): VscodeSubAgentModelSource | undefined {
  if (value === 'vision') return 'vision'
  return normalizeOptionalModelSource(value)
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
  const modelSource = normalizeOptionalSubAgentModelSource(raw.modelSource)
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
    vision?: unknown
  }
  const result: VscodePrefs['subAgentBuiltinOverrides'] = {}
  const explore = normalizeSubAgentBuiltinOverride(raw.explore)
  const general = normalizeSubAgentBuiltinOverride(raw.general)
  const vision = normalizeSubAgentBuiltinOverride(raw.vision)
  if (explore) result.explore = explore
  if (general) result.general = general
  if (vision) result.vision = vision
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
    if (!id || id === 'explore' || id === 'general' || id === 'vision' || seen.has(id)) continue
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
      sidebarView: normalizeSidebarView(parsed.sidebarView),
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
      explorerExpandedPathsByWorkspace: normalizeExplorerExpandedPathsByWorkspace(
        parsed.explorerExpandedPathsByWorkspace,
      ),
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
      aiIdleTimeoutSeconds:
        typeof parsed.aiIdleTimeoutSeconds === 'number' &&
        Number.isFinite(parsed.aiIdleTimeoutSeconds)
          ? clamp(
              Math.round(parsed.aiIdleTimeoutSeconds),
              MIN_AI_IDLE_TIMEOUT_SECONDS,
              MAX_AI_IDLE_TIMEOUT_SECONDS,
            )
          : DEFAULT_PREFS.aiIdleTimeoutSeconds,
      aiIdleRetryCount:
        typeof parsed.aiIdleRetryCount === 'number' && Number.isFinite(parsed.aiIdleRetryCount)
          ? clamp(
              Math.round(parsed.aiIdleRetryCount),
              MIN_AI_IDLE_RETRY_COUNT,
              MAX_AI_IDLE_RETRY_COUNT,
            )
          : DEFAULT_PREFS.aiIdleRetryCount,
      aiPlayCompletionSound: parsed.aiPlayCompletionSound !== false,
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
