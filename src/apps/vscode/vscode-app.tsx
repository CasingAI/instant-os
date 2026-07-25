import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { flushSync } from 'preact/compat'
import { disposeMonacoModelForPath, type MonacoRevealPosition } from '../../monaco/monaco-editor.tsx'
import {
  MONACO_SELECTABLE_LANGUAGES,
  monacoLanguageLabel,
  parentDirFromPath,
  fileNameFromPath,
  monacoLanguageFromFileName,
} from '../../monaco/monaco-language.ts'
import { monacoEditorBackgroundForTheme } from '../../monaco/monaco-themes.ts'
import {
  buildMonacoProblemTreeDecorations,
  subscribeMonacoProblems,
  summarizeMonacoProblems,
  type MonacoProblem,
} from '../../monaco/monaco-markers.ts'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { registerFileOpenHandler } from '../../os/file-open-registry.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs, useWindowCloseGuard } from '../../os/os-context.tsx'
import {
  TERMINAL_COLORS_DARK,
  TERMINAL_COLORS_HIGH_CONTRAST,
  TERMINAL_COLORS_LIGHT,
  type TerminalColors,
} from '../../terminal/terminal-public.ts'
import {
  TerminalReplPanel,
  type TerminalReplHandle,
} from '../terminal/terminal-repl-panel.tsx'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import { SettingsChoiceField } from '../../ui/settings-choice-field.tsx'
import { VscodeIcon } from '../../icons/app-icons.tsx'
import { WindowModal } from '../../window/window-modal.tsx'
import { useWindowModal } from '../../window/window-modal-context.tsx'
import { FilesStorageFullError } from '../files/files-storage.ts'
import { isFilesNodeWritable } from '../files/files-types.ts'
import { filesCreateText } from '../files/files-api.ts'
import { isBinaryFile } from '../files/is-binary-file.ts'
import { requestFilesReveal } from '../files/files-reveal-request.ts'
import {
  FILES_VFS_CHANGED_EVENT,
  readTextFile,
  resolveFilesAbsolutePath,
  resolveNodeByAbsolutePath,
  writeTextFile,
} from '../files/files-vfs.ts'
import { VscodeEditorArea } from './vscode-editor-area.tsx'
import {
  addFileTabToFocusedGroup,
  createEditorLayoutWithTabs,
  createEmptyEditorLayout,
  findAiChatItem,
  focusEditorGroup,
  focusEditorItem,
  focusEditorTab,
  getFocusedCloseTarget,
  getGroupActiveItem,
  countOtherItemsInGroup,
  moveEditorItemToGroup,
  openAiChatInFocusedGroup,
  openMarkdownPreviewToSide,
  openSearchEditorInFocusedGroup,
  openWelcomeInFocusedGroup,
  removeEditorItem,
  removeFileTabFromLayout,
  removeWelcomeFromLayout,
  setBranchRatio,
  splitEditorWithItem,
  type VscodeEditorLayoutState,
} from './vscode-editor-layout.ts'
import { VscodeExplorer } from './vscode-explorer.tsx'
import { loadVscodePrefs, saveVscodePrefs, type VscodePrefs } from './vscode-prefs.ts'
import { VscodeProblemsPanel } from './vscode-problems-panel.tsx'
import { VscodeLogPanel } from './vscode-log-panel.tsx'
import { VscodeQuickPick } from './vscode-quick-pick.tsx'
import { VscodeQuickSearch } from './vscode-quick-search.tsx'
import { VscodeSearchPanel } from './vscode-search-panel.tsx'
import {
  buildSearchEditorSession,
  type VscodeSearchEditorSession,
} from './vscode-search-editor-session.ts'
import {
  buildVscodeSessionFromTabs,
  loadVscodeSession,
  lookupVscodeDraft,
  saveVscodeSession,
  type VscodeDraftEntry,
} from './vscode-session.ts'
import {
  syncVscodeTypescriptAll,
  type VscodeTypescriptSyncEntry,
} from './vscode-typescript-workspace.ts'
import {
  buildDeletedVscodeTab,
  buildVscodeTab,
  isVscodeTabDirty,
  VSCODE_OPEN_EXTENSIONS,
  VSCODE_OPTIONAL_OPEN_EXTENSIONS,
  type VscodeTab,
} from './vscode-tabs.ts'
import {
  matchVscodeOpenFiles,
  searchVscodeWorkspaceFilesDetailed,
  type VscodeWorkspaceSearchHit,
} from './vscode-workspace-search.ts'
import type { VscodeAiContextInput } from './vscode-ai-context.ts'
import {
  buildVscodeAiChatSession,
  loadVscodeAiChatStore,
  pushClosedVscodeAiChatSession,
  saveVscodeAiChatStore,
  titleFromVscodeAiMessages,
  vscodeAiChatWorkspaceKey,
  type VscodeAiChatSession,
  type VscodeAiClosedChatSession,
  type VscodeAiPendingEdit,
} from './vscode-ai-chat-storage.ts'
import {
  formatVscodeAiModelRefKey,
  labelForVscodeAiModel,
  useVscodeAiTextModels,
} from './vscode-ai-models.ts'
import { ensureMonacoPathModel } from '../../monaco/monaco-editor.tsx'
import './vscode.css'

const SESSION_PERSIST_DEBOUNCE_MS = 400

const APP_ID = 'vscode' as const
const THEME = '#2f87e2'
const DEFAULT_TITLE = 'Virtual Studio Code Desktop'

registerFileOpenHandler({
  appId: APP_ID,
  extensions: [...VSCODE_OPEN_EXTENSIONS, ...VSCODE_OPTIONAL_OPEN_EXTENSIONS],
  rank: 10,
})

type DirtyChoice = 'save' | 'discard' | 'cancel'

type DirtyPromptState = {
  fileName: string
  writable: boolean
  resolve: (choice: DirtyChoice) => void
}

type SidebarView = 'explorer' | 'search' | 'settings'

const VSCODE_THEME_OPTIONS = [
  { id: 'vs-dark', label: '深色' },
  { id: 'vs', label: '浅色' },
  { id: 'hc-black', label: '高对比' },
  { id: 'dark-plus', label: '深色+' },
  { id: 'light-plus', label: '浅色+' },
  { id: 'dark-modern', label: '现代深色' },
  { id: 'light-modern', label: '现代浅色' },
] as const

type VscodeAppProps = {
  windowId?: string
}

function formatError(error: unknown): string {
  if (error instanceof FilesStorageFullError) return error.message
  if (error instanceof Error && error.message) return error.message
  return '操作失败'
}

function menuCheckPrefix(active: boolean): string {
  return active ? '✓ ' : ''
}

function terminalColorsForTheme(theme: VscodePrefs['theme']): TerminalColors {
  if (theme === 'vs' || theme === 'light-plus' || theme === 'light-modern') {
    return TERMINAL_COLORS_LIGHT
  }
  if (theme === 'hc-black') return TERMINAL_COLORS_HIGH_CONTRAST
  return TERMINAL_COLORS_DARK
}

function isVscodeChromeDark(theme: VscodePrefs['theme']): boolean {
  return (
    theme === 'vs-dark' ||
    theme === 'hc-black' ||
    theme === 'dark-plus' ||
    theme === 'dark-modern'
  )
}

type VscodeCursorPos = { line: number; column: number }

/** 行列状态隔离在状态栏按钮内，避免每次点击光标触发整页重渲 */
function VscodeStatusCursorButton({
  expanded,
  onOpenGoto,
  registerSetter,
}: {
  expanded: boolean
  onOpenGoto: () => void
  registerSetter: (setter: (line: number, column: number) => void) => void
}) {
  const [cursor, setCursor] = useState<VscodeCursorPos>({ line: 1, column: 1 })

  useEffect(() => {
    registerSetter((line, column) => {
      setCursor({ line, column })
    })
    return () => registerSetter(() => undefined)
  }, [registerSetter])

  return (
    <button
      type="button"
      class="vscode__status-goto-btn"
      title="跳转到指定行和列"
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={onOpenGoto}
    >
      第 {cursor.line} 行，第 {cursor.column} 列
    </button>
  )
}

export function VscodeApp({ windowId }: VscodeAppProps) {
  const {
    windows,
    activeWindowId,
    setWindowTitle,
    setWindowDocumentId,
    setWindowDocumentEdited,
    setWindowDocumentReadOnly,
    closeWindowsForApp,
    minimizeWindow,
    openApp,
  } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const modal = useWindowModal()
  const { showSystemOpenDialog, dialog: openDialog, isOpen: openDialogOpen } = useSystemOpenDialog()

  const appWindow = windowId
    ? windows.find((window) => window.id === windowId && !window.closing)
    : undefined
  const pendingDocumentId = appWindow?.documentId
  const isActiveWindow = windowId !== undefined && activeWindowId === windowId

  const [prefs, setPrefs] = useState<VscodePrefs>(() => loadVscodePrefs())
  const textModels = useVscodeAiTextModels()
  const completionModelOptions = useMemo(
    () =>
      textModels.map((model) => ({
        id: formatVscodeAiModelRefKey({
          providerEntryId: model.providerEntryId,
          modelId: model.modelId,
        }),
        label: labelForVscodeAiModel(model),
      })),
    [textModels],
  )
  const [sidebarView, setSidebarView] = useState<SidebarView>('explorer')
  const [activityCaretTop, setActivityCaretTop] = useState(78)
  const [caretReady, setCaretReady] = useState(false)
  const activityRailRef = useRef<HTMLElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const explorerBtnRef = useRef<HTMLButtonElement>(null)
  const searchBtnRef = useRef<HTMLButtonElement>(null)
  const settingsBtnRef = useRef<HTMLButtonElement>(null)
  const [tabs, setTabs] = useState<VscodeTab[]>([])
  const [sessionReady, setSessionReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [searchFocusNonce, setSearchFocusNonce] = useState(0)
  const [searchExpandReplaceNonce, setSearchExpandReplaceNonce] = useState(0)
  const [searchSeedInclude, setSearchSeedInclude] = useState<string | undefined>(undefined)
  const [searchSeedIncludeNonce, setSearchSeedIncludeNonce] = useState(0)
  const [searchEditorSessions, setSearchEditorSessions] = useState<
    Map<string, VscodeSearchEditorSession>
  >(() => new Map())
  const [aiChatSessions, setAiChatSessions] = useState<Map<string, VscodeAiChatSession>>(
    () => new Map(),
  )
  const [closedAiChats, setClosedAiChats] = useState<VscodeAiClosedChatSession[]>(() => {
    const store = loadVscodeAiChatStore(loadVscodePrefs().workspaceFolder)
    let closed = [...store.closedSessions]
    for (const session of store.openSessions) {
      closed = pushClosedVscodeAiChatSession(closed, session)
    }
    if (store.openSessions.length > 0) {
      saveVscodeAiChatStore({
        workspaceKey: store.workspaceKey,
        openSessions: [],
        closedSessions: closed,
      })
    }
    return closed
  })
  const aiChatSessionsRef = useRef(aiChatSessions)
  const closedAiChatsRef = useRef(closedAiChats)
  const aiWorkspaceFolderRef = useRef(prefs.workspaceFolder)
  aiChatSessionsRef.current = aiChatSessions
  closedAiChatsRef.current = closedAiChats
  const [quickSearchOpen, setQuickSearchOpen] = useState(false)
  const cursorRef = useRef<VscodeCursorPos>({ line: 1, column: 1 })
  const selectionTextRef = useRef<string | undefined>(undefined)
  const cursorSetterRef = useRef<(line: number, column: number) => void>(() => undefined)
  const [gotoLineOpen, setGotoLineOpen] = useState(false)
  const [gotoLineInput, setGotoLineInput] = useState('1')
  const [gotoColumnInput, setGotoColumnInput] = useState('1')
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false)
  const [dirtyPrompt, setDirtyPrompt] = useState<DirtyPromptState | undefined>(undefined)
  const [problems, setProblems] = useState<MonacoProblem[]>([])
  const [revealPath, setRevealPath] = useState<string | undefined>(undefined)
  const [revealNonce, setRevealNonce] = useState(0)
  const [revealPosition, setRevealPosition] = useState<
    (MonacoRevealPosition & { path: string }) | undefined
  >(undefined)
  const [editorLayout, setEditorLayout] = useState<VscodeEditorLayoutState>(() =>
    createEmptyEditorLayout(),
  )

  const terminalReplRef = useRef<TerminalReplHandle | null>(null)
  const [terminalRepl, setTerminalRepl] = useState<TerminalReplHandle | null>(null)
  const bindTerminalRepl = useCallback((handle: TerminalReplHandle | null) => {
    terminalReplRef.current = handle
    setTerminalRepl(handle)
  }, [])
  const terminalWorkspaceRoot = prefs.workspaceFolder?.trim() || '/user'
  const terminalReplWelcome = useMemo(
    () => [
    '终端 · InstantREPL',
      // `工作区 ${terminalWorkspaceRoot} · 回车执行 JavaScript`,
    ],
    [terminalWorkspaceRoot],
  )
  const terminalReplPanel = (
    <TerminalReplPanel
      key={terminalWorkspaceRoot}
      workspaceRoot={terminalWorkspaceRoot}
      handleRef={bindTerminalRepl}
      className="vscode__terminal-panel"
      colors={terminalColorsForTheme(prefs.theme)}
      welcomeLines={terminalReplWelcome}
      ariaLabel="VS Code 终端"
    />
  )
  const mainPaneRef = useRef<HTMLDivElement>(null)
  const terminalHeightRef = useRef(prefs.terminalHeight)
  terminalHeightRef.current = prefs.terminalHeight
  const sidebarWidthRef = useRef(prefs.sidebarWidth)
  sidebarWidthRef.current = prefs.sidebarWidth

  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef<string | undefined>(undefined)
  const editorLayoutRef = useRef(editorLayout)
  const loadingPathRef = useRef<string | undefined>(undefined)
  const lastOpenedPendingDocumentIdRef = useRef<string | undefined>(undefined)
  const mountedRef = useRef(true)
  const skipSessionPersistRef = useRef(false)
  const sessionReadyRef = useRef(false)
  const typescriptWorkspaceAbortRef = useRef<AbortController | undefined>(undefined)
  const typescriptSyncEntriesRef = useRef<VscodeTypescriptSyncEntry[]>([])

  tabsRef.current = tabs
  editorLayoutRef.current = editorLayout
  sessionReadyRef.current = sessionReady

  // 管理欢迎tab：空布局时自动补欢迎页；欢迎页与真实标签共存时自动关闭欢迎页
  useEffect(() => {
    setEditorLayout((current) => {
      let hasWelcome = false
      let hasOther = false
      for (const group of Object.values(current.groups)) {
        for (const item of group.items) {
          if (item.kind === 'welcome') hasWelcome = true
          else hasOther = true
        }
        if (hasWelcome && hasOther) break
      }
      if (hasWelcome && hasOther) {
        return removeWelcomeFromLayout(current)
      }
      if (!hasWelcome && !hasOther) {
        return openWelcomeInFocusedGroup(current)
      }
      return current
    })
  }, [editorLayout])

  const focusedGroup = editorLayout.groups[editorLayout.focusedGroupId]
  const focusedItem =
    focusedGroup?.items.find((item) => item.id === focusedGroup.activeItemId) ??
    focusedGroup?.items[0]

  const activeTab = (() => {
    if (focusedItem?.kind === 'file') {
      return tabs.find((tab) => tab.id === focusedItem.tabId)
    }
    if (focusedItem?.kind === 'preview') {
      return tabs.find((tab) => tab.path === focusedItem.sourcePath)
    }
    return tabs[0]
  })()

  const activeTabId = activeTab?.id
  activeTabIdRef.current = activeTabId

  const dirty = activeTab ? isVscodeTabDirty(activeTab) : false
  const writable = activeTab?.writable ?? false
  const showMarkdownPreviewAction =
    focusedItem?.kind === 'file' && activeTab?.language === 'markdown'
  const hasOtherTabsInFocusedGroup =
    focusedItem !== undefined &&
    countOtherItemsInGroup(editorLayout, editorLayout.focusedGroupId, focusedItem.id) > 0
  const problemSummary = useMemo(() => summarizeMonacoProblems(problems), [problems])
  const problemDecorations = useMemo(
    () => buildMonacoProblemTreeDecorations(problems),
    [problems],
  )

  useEffect(() => {
    return subscribeMonacoProblems(setProblems)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      if (!skipSessionPersistRef.current && sessionReadyRef.current) {
        saveVscodeSession(
          buildVscodeSessionFromTabs(tabsRef.current, activeTabIdRef.current),
        )
      }
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    saveVscodePrefs(prefs)
  }, [prefs])

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    void (async () => {
      const session = loadVscodeSession()
      const restored: VscodeTab[] = []
      const keptPaths: string[] = []
      const keptDrafts: Record<string, VscodeDraftEntry> = {}

      for (const path of session.openPaths) {
        if (cancelled || !mountedRef.current) return
        const draft = lookupVscodeDraft(session.drafts, path)
        try {
          const result = await readTextFile(path)
          if (cancelled || !mountedRef.current) return
          const absolutePath = await resolveFilesAbsolutePath(result.node)
          if (cancelled || !mountedRef.current) return
          const draftEntry = draft ?? lookupVscodeDraft(session.drafts, absolutePath)

          let text = result.text
          let conflict: VscodeTab['conflict']
          let keepDraft: VscodeDraftEntry | undefined

          if (draftEntry && draftEntry.text !== result.text) {
            const baseline = draftEntry.baseline
            const diskChangedFromBaseline =
              baseline !== undefined && baseline !== result.text
            if (diskChangedFromBaseline) {
              // 真冲突：先显示草稿，由该标签内横幅选择，不阻塞其它标签恢复
              text = draftEntry.text
              conflict = { diskText: result.text, baseline }
              keepDraft = { text: draftEntry.text, baseline }
            } else {
              text = draftEntry.text
              keepDraft = { text: draftEntry.text, baseline: result.text }
            }
          }

          const tab = buildVscodeTab({
            path: absolutePath,
            text,
            savedText: result.text,
            node: result.node,
            writable: isFilesNodeWritable(result.node),
            conflict,
          })
          restored.push(tab)
          keptPaths.push(absolutePath)
          if (keepDraft) keptDrafts[absolutePath] = keepDraft
        } catch {
          if (cancelled || !mountedRef.current) return
          const text = draft?.text ?? ''
          const tab = buildDeletedVscodeTab(path, text)
          restored.push(tab)
          keptPaths.push(path)
          keptDrafts[path] = { text, baseline: '' }
        }
      }

      if (cancelled || !mountedRef.current) return

      let nextActiveId: string | undefined
      if (restored.length > 0) {
        const activeRestored =
          restored.find((tab) => tab.path === session.activePath) ?? restored[0]
        nextActiveId = activeRestored?.id
      }

      tabsRef.current = restored
      activeTabIdRef.current = nextActiveId
      setTabs(restored)
      setEditorLayout(createEditorLayoutWithTabs(
        restored.map((tab) => tab.id),
        nextActiveId,
      ))
      saveVscodeSession({
        openPaths: keptPaths,
        activePath: restored.find((tab) => tab.id === nextActiveId)?.path ?? keptPaths[0],
        drafts: keptDrafts,
      })
      setSessionReady(true)
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!sessionReady || skipSessionPersistRef.current) return
    const timer = window.setTimeout(() => {
      if (skipSessionPersistRef.current || !mountedRef.current) return
      saveVscodeSession(buildVscodeSessionFromTabs(tabsRef.current, activeTabIdRef.current))
    }, SESSION_PERSIST_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [tabs, activeTabId, sessionReady])

  const updatePrefs = useCallback((patch: Partial<VscodePrefs>) => {
    setPrefs((current) => ({ ...current, ...patch }))
  }, [])

  const toggleBottomPanelTab = useCallback((tab: VscodePrefs['panelTab']) => {
    setPrefs((current) => {
      if (current.terminalVisible && current.panelTab === tab) {
        return { ...current, terminalVisible: false }
      }
      return { ...current, terminalVisible: true, panelTab: tab }
    })
  }, [])

  const onTerminalSashPointerDown = useCallback(
    (event: PointerEvent) => {
      const sash = event.currentTarget as HTMLElement
      const main = mainPaneRef.current
      if (!main) return
      event.preventDefault()
      sash.setPointerCapture(event.pointerId)
      const startY = event.clientY
      const startHeight = terminalHeightRef.current
      const mainRect = main.getBoundingClientRect()
      const maxHeight = Math.max(120, Math.floor(mainRect.height - 160))

      const onMove = (moveEvent: PointerEvent) => {
        const next = Math.min(
          maxHeight,
          Math.max(120, Math.round(startHeight + (startY - moveEvent.clientY))),
        )
        updatePrefs({ terminalHeight: next })
      }
      const onUp = (upEvent: PointerEvent) => {
        sash.releasePointerCapture(upEvent.pointerId)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [updatePrefs],
  )

  const onSidebarSashPointerDown = useCallback(
    (event: PointerEvent) => {
      const sash = event.currentTarget as HTMLElement
      event.preventDefault()
      sash.setPointerCapture(event.pointerId)
      const startX = event.clientX
      const startWidth = sidebarWidthRef.current

      const onMove = (moveEvent: PointerEvent) => {
        const next = Math.max(0, Math.round(startWidth + (moveEvent.clientX - startX)))
        updatePrefs({ sidebarWidth: next })
      }
      const onUp = (upEvent: PointerEvent) => {
        sash.releasePointerCapture(upEvent.pointerId)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [updatePrefs],
  )

  const syncWindowToTab = useCallback(
    (tab: VscodeTab | undefined) => {
      if (!windowId) return
      if (!tab) {
        setWindowTitle(windowId, DEFAULT_TITLE)
        setWindowDocumentId(windowId, undefined)
        setWindowDocumentEdited(windowId, false)
        setWindowDocumentReadOnly(windowId, false)
        return
      }
      setWindowTitle(windowId, tab.name)
      setWindowDocumentId(windowId, tab.path)
      // 未保存状态只靠标签上的色点提示，不在窗口标题栏重复显示「已编辑」
      setWindowDocumentEdited(windowId, false)
      setWindowDocumentReadOnly(windowId, !tab.writable)
    },
    [setWindowDocumentEdited, setWindowDocumentId, setWindowDocumentReadOnly, setWindowTitle, windowId],
  )

  useEffect(() => {
    // 会话恢复完成前不要同步窗口 documentId：冷启动时 OS 传入的待打开路径
    // 会挂在 window.documentId 上，若此时按「无标签」清空，后续打开 effect 就读不到了。
    if (!sessionReady) return
    // 异步打开尚未完成时，tabs/layout 可能短暂不一致；若用旧 activeTab 回写 documentId，
    // 会清掉 pending 并在后续 effect 里把焦点抢回旧标签。
    if (
      pendingDocumentId &&
      activeTab?.path !== pendingDocumentId &&
      loadingPathRef.current === pendingDocumentId
    ) {
      return
    }
    syncWindowToTab(activeTab)
  }, [activeTab, pendingDocumentId, sessionReady, syncWindowToTab])

  useEffect(() => {
    if (!activeTab) return
    const dir = parentDirFromPath(activeTab.path)
    const terminal = terminalReplRef.current
    if (!terminal || terminal.getCwd() === dir) return
    void terminal.chdir(dir).catch(() => undefined)
  }, [activeTab])

  useEffect(() => {
    const folder = prefs.workspaceFolder
    if (!folder || activeTab) return
    const terminal = terminalReplRef.current
    if (!terminal || terminal.getCwd() === folder) return
    void terminal.chdir(folder).catch(() => undefined)
  }, [activeTab, prefs.workspaceFolder])

  const openDocument = useCallback(
    async (
      documentRef: string,
      options?: { reveal?: MonacoRevealPosition },
    ): Promise<boolean> => {
      const existing = tabsRef.current.find((tab) => tab.path === documentRef)
      if (existing) {
        setEditorLayout((current) => focusEditorTab(current, existing.id))
        setRevealPath(documentRef)
        if (options?.reveal) {
          setRevealPosition({
            path: existing.path,
            line: options.reveal.line,
            column: options.reveal.column,
          })
        }
        return true
      }

      if (loadingPathRef.current === documentRef) {
        return true
      }

      loadingPathRef.current = documentRef
      setLoading(true)
      try {
        const result = await readTextFile(documentRef)
        const path = await resolveFilesAbsolutePath(result.node)
        if (!mountedRef.current) return false

        if (
          isBinaryFile({
            fileName: result.node.name || path,
            mimeType: result.node.mimeType,
            text: result.text,
          })
        ) {
          const tab = buildVscodeTab({
            path,
            text: result.text,
            node: result.node,
            writable: isFilesNodeWritable(result.node),
            binaryPrompt: true,
          })
          const nextTabs = [...tabsRef.current, tab]
          tabsRef.current = nextTabs
          activeTabIdRef.current = tab.id
          // await 之后的 setState 可能拆成两次渲染；必须同帧更新 tabs+layout，否则中间帧会用旧标签回写 documentId 并抢走焦点
          flushSync(() => {
            setTabs(nextTabs)
            setEditorLayout((current) => addFileTabToFocusedGroup(current, tab.id))
          })
          setRevealPath(path)
          return true
        }

        const tab = buildVscodeTab({
          path,
          text: result.text,
          node: result.node,
          writable: isFilesNodeWritable(result.node),
        })
        const nextTabs = [...tabsRef.current, tab]
        tabsRef.current = nextTabs
        activeTabIdRef.current = tab.id
        flushSync(() => {
          setTabs(nextTabs)
          setEditorLayout((current) => addFileTabToFocusedGroup(current, tab.id))
        })
        setRevealPath(path)
        if (options?.reveal) {
          setRevealPosition({
            path,
            line: options.reveal.line,
            column: options.reveal.column,
          })
        }
        if (sessionReadyRef.current && !skipSessionPersistRef.current) {
          saveVscodeSession(buildVscodeSessionFromTabs(nextTabs, tab.id))
        }
        return true
      } catch (err) {
        await modal.alert({
          title: '无法打开',
          message: formatError(err),
          themeColor: THEME,
        })
        return false
      } finally {
        if (loadingPathRef.current === documentRef) {
          loadingPathRef.current = undefined
        }
        setLoading(false)
      }
    },
    [modal],
  )

  const handleEditorOpenPath = useCallback(
    async (path: string, position?: MonacoRevealPosition): Promise<boolean> => {
      return openDocument(path, position ? { reveal: position } : undefined)
    },
    [openDocument],
  )

  const openProblem = useCallback(
    (problem: MonacoProblem) => {
      if (!problem.path) return
      void openDocument(problem.path, {
        reveal: { line: problem.startLineNumber, column: problem.startColumn },
      })
    },
    [openDocument],
  )

  const openGotoLineDialog = useCallback(() => {
    if (!activeTab) return
    setGotoLineInput(String(cursorRef.current.line))
    setGotoColumnInput(String(cursorRef.current.column))
    setGotoLineOpen(true)
  }, [activeTab])

  const registerCursorSetter = useCallback((setter: (line: number, column: number) => void) => {
    cursorSetterRef.current = (line, column) => {
      cursorRef.current = { line, column }
      setter(line, column)
    }
  }, [])

  const applyCursor = useCallback((line: number, column: number) => {
    cursorRef.current = { line, column }
    cursorSetterRef.current(line, column)
  }, [])

  const applySelection = useCallback((selectionText: string | undefined) => {
    selectionTextRef.current = selectionText
  }, [])

  const getVscodeAiContext = useCallback((): VscodeAiContextInput => {
    const activeId = activeTabIdRef.current
    const active = tabsRef.current.find((tab) => tab.id === activeId)
    return {
      workspaceFolder: prefs.workspaceFolder,
      tabs: tabsRef.current,
      activeTabId: activeId,
      editor: {
        activePath: active?.path,
        cursorLine: cursorRef.current.line,
        cursorColumn: cursorRef.current.column,
        selectionText: selectionTextRef.current,
      },
      problems,
    }
  }, [prefs.workspaceFolder, problems])

  const applyVscodeAiEdit = useCallback(
    async (edit: VscodeAiPendingEdit) => {
      const existing = tabsRef.current.find((tab) => tab.path === edit.path)
      if (existing) {
        setTabs((current) =>
          current.map((tab) =>
            tab.id === existing.id
              ? { ...tab, text: edit.nextText, savedText: edit.nextText }
              : tab,
          ),
        )
        ensureMonacoPathModel(
          edit.path,
          edit.nextText,
          monacoLanguageFromFileName(fileNameFromPath(edit.path)),
          { overwrite: true },
        )
      }
      try {
        const node = await resolveNodeByAbsolutePath(edit.path)
        if (node && node.kind === 'file') {
          await writeTextFile(edit.path, edit.nextText)
        } else {
          await filesCreateText(edit.path, edit.nextText)
        }
      } catch {
        await filesCreateText(edit.path, edit.nextText)
      }
      if (!existing) {
        await openDocument(edit.path)
      }
    },
    [openDocument],
  )

  const confirmGotoLine = useCallback(() => {
    if (!activeTab) {
      setGotoLineOpen(false)
      return
    }
    const line = Math.max(1, Number.parseInt(gotoLineInput.trim(), 10) || 1)
    const column = Math.max(1, Number.parseInt(gotoColumnInput.trim(), 10) || 1)
    setRevealPosition({ path: activeTab.path, line, column })
    applyCursor(line, column)
    setGotoLineOpen(false)
  }, [activeTab, applyCursor, gotoColumnInput, gotoLineInput])

  const saveTab = useCallback(
    async (tabId: string): Promise<boolean> => {
      const tab = tabsRef.current.find((item) => item.id === tabId)
      if (!tab || !tab.writable) return false
      setLoading(true)
      try {
        let updated
        if (tab.deleted) {
          const existing = await resolveNodeByAbsolutePath(tab.path)
          if (existing && existing.kind === 'file') {
            updated = await writeTextFile(tab.path, tab.text)
          } else {
            await filesCreateText(tab.path, tab.text)
            const created = await readTextFile(tab.path)
            updated = created.node
          }
        } else {
          // 已有未解决冲突时，Cmd+S 视为强制用编辑器内容覆盖磁盘
          if (!tab.conflict) {
            const onDisk = await readTextFile(tab.path)
            if (!mountedRef.current) return false
            if (onDisk.text !== tab.savedText && onDisk.text !== tab.text) {
              const nextTabs = tabsRef.current.map((item) =>
                item.id === tabId
                  ? {
                      ...item,
                      savedText: onDisk.text,
                      node: onDisk.node,
                      writable: isFilesNodeWritable(onDisk.node),
                      conflict: {
                        diskText: onDisk.text,
                        baseline: item.savedText,
                      },
                    }
                  : item,
              )
              tabsRef.current = nextTabs
              setTabs(nextTabs)
              if (sessionReadyRef.current && !skipSessionPersistRef.current) {
                saveVscodeSession(
                  buildVscodeSessionFromTabs(nextTabs, activeTabIdRef.current),
                )
              }
              return false
            }
            if (onDisk.text === tab.text) {
              const nextPath = await resolveFilesAbsolutePath(onDisk.node)
              if (!mountedRef.current) return false
              const nextTabs = tabsRef.current.map((item) =>
                item.id === tabId
                  ? {
                      ...item,
                      path: nextPath,
                      name: onDisk.node.name,
                      savedText: item.text,
                      node: onDisk.node,
                      writable: isFilesNodeWritable(onDisk.node),
                      deleted: false,
                      conflict: undefined,
                    }
                  : item,
              )
              tabsRef.current = nextTabs
              setTabs(nextTabs)
              if (sessionReadyRef.current && !skipSessionPersistRef.current) {
                saveVscodeSession(
                  buildVscodeSessionFromTabs(nextTabs, activeTabIdRef.current),
                )
              }
              return true
            }
          }
          updated = await writeTextFile(tab.path, tab.text)
        }
        const nextPath = await resolveFilesAbsolutePath(updated)
        if (!mountedRef.current) return false
        const nextTabs = tabsRef.current.map((item) =>
          item.id === tabId
            ? {
                ...item,
                path: nextPath,
                name: updated.name,
                savedText: item.text,
                node: updated,
                writable: isFilesNodeWritable(updated),
                deleted: false,
                conflict: undefined,
              }
            : item,
        )
        tabsRef.current = nextTabs
        setTabs(nextTabs)
        if (sessionReadyRef.current && !skipSessionPersistRef.current) {
          saveVscodeSession(buildVscodeSessionFromTabs(nextTabs, activeTabIdRef.current))
        }
        return true
      } catch (err) {
        await modal.alert({
          title: '无法保存',
          message: formatError(err),
          themeColor: THEME,
        })
        return false
      } finally {
        setLoading(false)
      }
    },
    [modal],
  )

  const handleSave = useCallback(async () => {
    const tabId = activeTabIdRef.current
    if (!tabId) return
    await saveTab(tabId)
  }, [saveTab])

  const askDirtyChoice = useCallback((tab: VscodeTab): Promise<DirtyChoice> => {
    if (!isVscodeTabDirty(tab)) return Promise.resolve('discard')
    return new Promise((resolve) => {
      setDirtyPrompt({
        fileName: tab.name,
        writable: tab.writable,
        resolve,
      })
    })
  }, [])

  const resolveDirtyPrompt = useCallback((choice: DirtyChoice) => {
    setDirtyPrompt((current) => {
      current?.resolve(choice)
      return undefined
    })
  }, [])

  const resolveTabConflict = useCallback((tabId: string, choice: 'draft' | 'disk') => {
    const current = tabsRef.current
    const tab = current.find((item) => item.id === tabId)
    if (!tab?.conflict) return
    const diskText = tab.conflict.diskText
    const nextTabs = current.map((item) => {
      if (item.id !== tabId || !item.conflict) return item
      if (choice === 'disk') {
        return {
          ...item,
          text: diskText,
          savedText: diskText,
          conflict: undefined,
        }
      }
      return {
        ...item,
        // 保留编辑器中的草稿，以当前磁盘为新的 saved 基准
        savedText: diskText,
        conflict: undefined,
      }
    })
    tabsRef.current = nextTabs
    setTabs(nextTabs)
    if (sessionReadyRef.current && !skipSessionPersistRef.current) {
      saveVscodeSession(buildVscodeSessionFromTabs(nextTabs, activeTabIdRef.current))
    }
  }, [])

  const ensureTabCleanOrConfirm = useCallback(
    async (tabId: string): Promise<boolean> => {
      const tab = tabsRef.current.find((item) => item.id === tabId)
      if (!tab) return true
      const choice = await askDirtyChoice(tab)
      if (choice === 'cancel') return false
      if (choice === 'save') return saveTab(tabId)
      return true
    },
    [askDirtyChoice, saveTab],
  )

  const pickAndOpen = useCallback(async (): Promise<boolean> => {
    const path = await showSystemOpenDialog({
      title: '打开文件',
      acceptExtensions: [...VSCODE_OPEN_EXTENSIONS, ...VSCODE_OPTIONAL_OPEN_EXTENSIONS],
      allowCreate: true,
      createExtension: 'ts',
      presentation: 'modal',
    })
    if (!path) return false
    return openDocument(path)
  }, [openDocument, showSystemOpenDialog])

  const openWorkspaceFolderAtPath = useCallback(
    (path: string): void => {
      updatePrefs({ workspaceFolder: path, sidebarVisible: true })
      setSidebarView('explorer')
      setRevealPath(path)
      if (terminalReplRef.current?.getCwd() !== path) {
        void terminalReplRef.current?.chdir(path).catch(() => undefined)
      }
    },
    [updatePrefs],
  )

  const pickAndOpenFolder = useCallback(async (): Promise<boolean> => {
    const path = await showSystemOpenDialog({
      title: '打开文件夹',
      selectionMode: 'folder',
      presentation: 'modal',
    })
    if (!path) return false
    openWorkspaceFolderAtPath(path)
    return true
  }, [openWorkspaceFolderAtPath, showSystemOpenDialog])

  const closeWorkspaceFolder = useCallback(() => {
    updatePrefs({ workspaceFolder: undefined })
  }, [updatePrefs])

  useEffect(() => {
    const previousFolder = aiWorkspaceFolderRef.current
    aiWorkspaceFolderRef.current = prefs.workspaceFolder

    if (previousFolder !== prefs.workspaceFolder && aiChatSessionsRef.current.size > 0) {
      const previousStore = loadVscodeAiChatStore(previousFolder)
      let previousClosed = [...previousStore.closedSessions]
      for (const session of aiChatSessionsRef.current.values()) {
        previousClosed = pushClosedVscodeAiChatSession(previousClosed, session)
      }
      saveVscodeAiChatStore({
        workspaceKey: vscodeAiChatWorkspaceKey(previousFolder),
        openSessions: [],
        closedSessions: previousClosed,
      })
    }

    const store = loadVscodeAiChatStore(prefs.workspaceFolder)
    let closed = [...store.closedSessions]
    for (const session of store.openSessions) {
      closed = pushClosedVscodeAiChatSession(closed, session)
    }
    if (store.openSessions.length > 0) {
      saveVscodeAiChatStore({
        workspaceKey: store.workspaceKey,
        openSessions: [],
        closedSessions: closed,
      })
    }
    setAiChatSessions(new Map())
    setClosedAiChats(closed)
    setEditorLayout((layout) => {
      let next = layout
      for (const group of Object.values(layout.groups)) {
        for (const item of [...group.items]) {
          if (item.kind !== 'aiChat') continue
          next = removeEditorItem(next, item.id)
        }
      }
      editorLayoutRef.current = next
      return next
    })
  }, [prefs.workspaceFolder])

  // 只关心「打开了哪些文件标签」，忽略焦点切换，避免无谓触发 TS sync
  const openFileTabIdKey = useMemo(() => {
    const ids: string[] = []
    for (const group of Object.values(editorLayout.groups)) {
      for (const item of group.items) {
        if (item.kind === 'file') ids.push(item.tabId)
      }
    }
    ids.sort()
    return ids.join('\0')
  }, [editorLayout.groups])

  const typescriptSyncEntries = useMemo((): VscodeTypescriptSyncEntry[] => {
    const openTabIds = new Set(openFileTabIdKey.split('\0').filter(Boolean))
    const next: VscodeTypescriptSyncEntry[] = []
    const seenPaths = new Set<string>()
    for (const tab of tabs) {
      if (!openTabIds.has(tab.id)) continue
      if (tab.binaryPrompt) continue
      if (tab.language !== 'typescript' && tab.language !== 'javascript') continue
      if (seenPaths.has(tab.path)) continue
      seenPaths.add(tab.path)
      next.push({ path: tab.path, text: tab.text })
    }
    const prev = typescriptSyncEntriesRef.current
    if (
      prev.length === next.length &&
      prev.every((entry, index) => {
        const other = next[index]
        return other !== undefined && entry.path === other.path && entry.text === other.text
      })
    ) {
      return prev
    }
    typescriptSyncEntriesRef.current = next
    return next
  }, [tabs, openFileTabIdKey])

  // 工作区切换或卸载时硬取消 dts / workspace sync
  useEffect(() => {
    typescriptWorkspaceAbortRef.current?.abort()
    const controller = new AbortController()
    typescriptWorkspaceAbortRef.current = controller
    return () => {
      controller.abort()
    }
  }, [prefs.workspaceFolder])

  // 会话恢复后与打开中的 TS/JS 标签变化时编排 sync（覆盖全部分屏标签，不只焦点）
  useEffect(() => {
    if (!sessionReady) return

    const folder = prefs.workspaceFolder
    const entries = typescriptSyncEntries
    const timer = window.setTimeout(() => {
      void syncVscodeTypescriptAll({
        workspaceFolder: folder,
        entries,
        signal: typescriptWorkspaceAbortRef.current?.signal,
      }).catch(() => undefined)
    }, 120)
    return () => {
      // 仅清防抖；文本编辑不 abort，由 generation 在入口边界丢弃过期编排
      window.clearTimeout(timer)
    }
  }, [sessionReady, prefs.workspaceFolder, typescriptSyncEntries])

  useEffect(() => {
    if (!sessionReady || !windowId || !pendingDocumentId) return
    if (loadingPathRef.current === pendingDocumentId) return
    if (lastOpenedPendingDocumentIdRef.current === pendingDocumentId) return
    lastOpenedPendingDocumentIdRef.current = pendingDocumentId

    const existing = tabsRef.current.find((tab) => tab.path === pendingDocumentId)
    if (existing) {
      // 始终聚焦：避免异步打开过程中焦点被旧标签抢回后无法恢复
      setEditorLayout((current) => focusEditorTab(current, existing.id))
      return
    }

    void (async () => {
      const node = await resolveNodeByAbsolutePath(pendingDocumentId)
      if (!mountedRef.current) return
      if (node?.kind === 'folder') {
        openWorkspaceFolderAtPath(pendingDocumentId)
        return
      }
      void openDocument(pendingDocumentId)
    })()
  }, [openDocument, openWorkspaceFolderAtPath, pendingDocumentId, sessionReady, windowId])

  useEffect(() => {
    if (!sessionReady) return

    let cancelled = false
    let timer: number | undefined

    const syncDeletedFlags = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void (async () => {
          const current = tabsRef.current
          if (current.length === 0) return
          let changed = false
          const nextTabs: VscodeTab[] = []
          for (const tab of current) {
            if (tab.deleted) {
              try {
                const result = await readTextFile(tab.path)
                if (cancelled || !mountedRef.current) return
                changed = true
                nextTabs.push({
                  ...tab,
                  deleted: false,
                  node: result.node,
                  name: result.node.name || tab.name,
                  writable: isFilesNodeWritable(result.node),
                  savedText: result.text,
                })
              } catch {
                nextTabs.push(tab)
              }
              continue
            }
            const node = await resolveNodeByAbsolutePath(tab.path)
            if (cancelled || !mountedRef.current) return
            if (!node || node.kind !== 'file') {
              changed = true
              nextTabs.push({ ...tab, deleted: true, savedText: '', conflict: undefined })
              continue
            }
            nextTabs.push(tab)
          }
          if (!changed || cancelled || !mountedRef.current) return
          tabsRef.current = nextTabs
          setTabs(nextTabs)
          if (!skipSessionPersistRef.current) {
            saveVscodeSession(buildVscodeSessionFromTabs(nextTabs, activeTabIdRef.current))
          }
        })()
      }, 80)
    }

    window.addEventListener(FILES_VFS_CHANGED_EVENT, syncDeletedFlags)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.removeEventListener(FILES_VFS_CHANGED_EVENT, syncDeletedFlags)
    }
  }, [sessionReady])

  const removeTab = useCallback((tabId: string) => {
    const current = tabsRef.current
    const index = current.findIndex((tab) => tab.id === tabId)
    if (index < 0) return
    const removed = current[index]
    const nextTabs = current.filter((tab) => tab.id !== tabId)
    const nextLayout = removeFileTabFromLayout(
      editorLayoutRef.current,
      tabId,
      removed?.path,
    )
    tabsRef.current = nextTabs
    editorLayoutRef.current = nextLayout
    setTabs(nextTabs)
    setEditorLayout(nextLayout)
    const nextActiveId = (() => {
      const group = nextLayout.groups[nextLayout.focusedGroupId]
      const item =
        group?.items.find((entry) => entry.id === group.activeItemId) ?? group?.items[0]
      if (item?.kind === 'file') return item.tabId
      if (item?.kind === 'preview') {
        return nextTabs.find((tab) => tab.path === item.sourcePath)?.id
      }
      return nextTabs[0]?.id
    })()
    activeTabIdRef.current = nextActiveId
    if (sessionReadyRef.current && !skipSessionPersistRef.current) {
      saveVscodeSession(buildVscodeSessionFromTabs(nextTabs, nextActiveId))
    }
    if (removed) {
      window.setTimeout(() => {
        const stillOpen = tabsRef.current.some((tab) => tab.path === removed.path)
        if (!stillOpen) {
          disposeMonacoModelForPath(removed.path)
        }
      }, 0)
    }
  }, [])

  const confirmBinaryPrompt = useCallback((tabId: string) => {
    const current = tabsRef.current
    const tab = current.find((item) => item.id === tabId)
    if (!tab?.binaryPrompt) return
    const nextTabs = current.map((item) =>
      item.id === tabId ? { ...item, binaryPrompt: undefined } : item,
    )
    tabsRef.current = nextTabs
    setTabs(nextTabs)
    if (sessionReadyRef.current && !skipSessionPersistRef.current) {
      saveVscodeSession(buildVscodeSessionFromTabs(nextTabs, activeTabIdRef.current))
    }
  }, [])

  const openMarkdownPreviewBeside = useCallback((groupId: string) => {
    const group = editorLayoutRef.current.groups[groupId]
    const activeItem =
      group?.items.find((item) => item.id === group.activeItemId) ?? group?.items[0]
    const tabId = activeItem?.kind === 'file' ? activeItem.tabId : activeTabIdRef.current
    const tab = tabId ? tabsRef.current.find((item) => item.id === tabId) : undefined
    if (!tab || tab.language !== 'markdown') return
    setEditorLayout((layout) => openMarkdownPreviewToSide(layout, tab.path, groupId))
  }, [])

  const closePreviewItem = useCallback((itemId: string) => {
    setEditorLayout((layout) => {
      const next = removeEditorItem(layout, itemId)
      editorLayoutRef.current = next
      return next
    })
  }, [])

  const closeWelcomeTab = useCallback(() => {
    setEditorLayout((layout) => {
      const next = removeWelcomeFromLayout(layout)
      editorLayoutRef.current = next
      return next
    })
  }, [])

  const closeTab = useCallback(
    async (tabId: string) => {
      const proceed = await ensureTabCleanOrConfirm(tabId)
      if (!proceed) return
      removeTab(tabId)
    },
    [ensureTabCleanOrConfirm, removeTab],
  )

  const closeSearchEditorItem = useCallback((itemId: string) => {
    let sessionId: string | undefined
    for (const group of Object.values(editorLayoutRef.current.groups)) {
      const item = group.items.find((entry) => entry.id === itemId)
      if (item?.kind === 'searchEditor') {
        sessionId = item.sessionId
        break
      }
    }
    setEditorLayout((layout) => {
      const next = removeEditorItem(layout, itemId)
      editorLayoutRef.current = next
      return next
    })
    if (sessionId) {
      setSearchEditorSessions((prev) => {
        if (!prev.has(sessionId!)) return prev
        const next = new Map(prev)
        next.delete(sessionId!)
        return next
      })
    }
  }, [])

  const persistAiChatStore = useCallback(
    (
      openMap: ReadonlyMap<string, VscodeAiChatSession>,
      closed: readonly VscodeAiClosedChatSession[],
    ) => {
      saveVscodeAiChatStore({
        workspaceKey: vscodeAiChatWorkspaceKey(prefs.workspaceFolder),
        openSessions: [...openMap.values()].sort((a, b) => b.updatedAt - a.updatedAt),
        closedSessions: [...closed],
      })
    },
    [prefs.workspaceFolder],
  )

  const openNewAiChat = useCallback(() => {
    const session = buildVscodeAiChatSession()
    setAiChatSessions((prev) => {
      const next = new Map(prev)
      next.set(session.id, session)
      persistAiChatStore(next, closedAiChatsRef.current)
      return next
    })
    setEditorLayout((layout) => {
      const next = openAiChatInFocusedGroup(layout, session.id)
      editorLayoutRef.current = next
      return next
    })
  }, [persistAiChatStore])

  const openOrFocusAiChat = useCallback(() => {
    const layout = editorLayoutRef.current
    let latest:
      | { groupId: string; itemId: string; updatedAt: number }
      | undefined
    for (const group of Object.values(layout.groups)) {
      for (const item of group.items) {
        if (item.kind !== 'aiChat') continue
        const session = aiChatSessionsRef.current.get(item.sessionId)
        const updatedAt = session?.updatedAt ?? 0
        if (!latest || updatedAt >= latest.updatedAt) {
          latest = { groupId: group.id, itemId: item.id, updatedAt }
        }
      }
    }
    if (latest) {
      setEditorLayout((current) => {
        const next = focusEditorItem(current, latest!.groupId, latest!.itemId)
        editorLayoutRef.current = next
        return next
      })
      return
    }
    openNewAiChat()
  }, [openNewAiChat])

  const closeAiChatItem = useCallback(
    (itemId: string) => {
      let sessionId: string | undefined
      for (const group of Object.values(editorLayoutRef.current.groups)) {
        const item = group.items.find((entry) => entry.id === itemId)
        if (item?.kind === 'aiChat') {
          sessionId = item.sessionId
          break
        }
      }
      setEditorLayout((layout) => {
        const next = removeEditorItem(layout, itemId)
        editorLayoutRef.current = next
        return next
      })
      if (!sessionId) return
      const session = aiChatSessionsRef.current.get(sessionId)
      const nextOpen = new Map(aiChatSessionsRef.current)
      nextOpen.delete(sessionId)
      const nextClosed = session
        ? pushClosedVscodeAiChatSession(closedAiChatsRef.current, session)
        : closedAiChatsRef.current
      setAiChatSessions(nextOpen)
      setClosedAiChats(nextClosed)
      persistAiChatStore(nextOpen, nextClosed)
    },
    [persistAiChatStore],
  )

  const restoreClosedAiChat = useCallback(
    (sessionId: string) => {
      const existingOpen = findAiChatItem(editorLayoutRef.current, sessionId)
      if (existingOpen) {
        setEditorLayout((layout) => {
          const next = focusEditorItem(layout, existingOpen.groupId, existingOpen.item.id)
          editorLayoutRef.current = next
          return next
        })
        return
      }
      const closed = closedAiChatsRef.current.find((session) => session.id === sessionId)
      if (!closed) return
      const session = buildVscodeAiChatSession({
        id: closed.id,
        title: closed.title,
        messages: closed.messages,
        updatedAt: Date.now(),
      })
      const nextClosed = closedAiChatsRef.current.filter((entry) => entry.id !== sessionId)
      setClosedAiChats(nextClosed)
      setAiChatSessions((prev) => {
        const next = new Map(prev)
        next.set(session.id, session)
        persistAiChatStore(next, nextClosed)
        return next
      })
      setEditorLayout((layout) => {
        const next = openAiChatInFocusedGroup(layout, session.id)
        editorLayoutRef.current = next
        return next
      })
    },
    [persistAiChatStore],
  )

  const updateAiChatMessages = useCallback(
    (sessionId: string, messages: VscodeAiChatSession['messages']) => {
      setAiChatSessions((prev) => {
        const current = prev.get(sessionId)
        if (!current) return prev
        const next = new Map(prev)
        next.set(sessionId, {
          ...current,
          messages,
          title: titleFromVscodeAiMessages(messages),
          updatedAt: Date.now(),
        })
        persistAiChatStore(next, closedAiChatsRef.current)
        return next
      })
    },
    [persistAiChatStore],
  )

  const handleCloseTab = useCallback(() => {
    const target = getFocusedCloseTarget(editorLayoutRef.current)
    if (!target) return
    if (target.kind === 'preview') {
      closePreviewItem(target.itemId)
      return
    }
    if (target.kind === 'searchEditor') {
      closeSearchEditorItem(target.itemId)
      return
    }
    if (target.kind === 'aiChat') {
      closeAiChatItem(target.itemId)
      return
    }
    if (target.kind === 'welcome') {
      closeWelcomeTab()
      return
    }
    void closeTab(target.tabId)
  }, [closeAiChatItem, closePreviewItem, closeSearchEditorItem, closeTab, closeWelcomeTab])

  const closeOtherInGroup = useCallback(
    async (groupId: string, keepItemId: string) => {
      const group = editorLayoutRef.current.groups[groupId]
      if (!group) return
      const others = group.items.filter((item) => item.id !== keepItemId)
      if (others.length === 0) return

      setEditorLayout((current) => {
        const next = focusEditorItem(current, groupId, keepItemId)
        editorLayoutRef.current = next
        return next
      })

      for (const item of others) {
        const stillThere = editorLayoutRef.current.groups[groupId]?.items.some(
          (entry) => entry.id === item.id,
        )
        if (!stillThere) continue
        if (item.kind === 'preview') {
          closePreviewItem(item.id)
          continue
        }
        if (item.kind === 'searchEditor') {
          closeSearchEditorItem(item.id)
          continue
        }
        if (item.kind === 'aiChat') {
          closeAiChatItem(item.id)
          continue
        }
        if (item.kind === 'welcome') {
          closeWelcomeTab()
          continue
        }
        await closeTab(item.tabId)
      }
    },
    [closeAiChatItem, closePreviewItem, closeSearchEditorItem, closeTab, closeWelcomeTab],
  )

  const handleCloseOtherTabs = useCallback(() => {
    const layout = editorLayoutRef.current
    const group = layout.groups[layout.focusedGroupId]
    const keepItem = getGroupActiveItem(group)
    if (!group || !keepItem) return
    void closeOtherInGroup(group.id, keepItem.id)
  }, [closeOtherInGroup])

  const requestClose = useCallback(() => {
    if (!windowId) return true
    skipSessionPersistRef.current = true
    saveVscodeSession(buildVscodeSessionFromTabs(tabsRef.current, activeTabIdRef.current))
    setWindowDocumentEdited(windowId, false)
    return true
  }, [setWindowDocumentEdited, windowId])

  useWindowCloseGuard(windowId, requestClose)

  useEffect(() => {
    if (!isActiveWindow) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (openDialogOpen || dirtyPrompt || loading) return

      const key = event.key.toLowerCase()
      if (key === 's' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        const tab = tabsRef.current.find((item) => item.id === activeTabIdRef.current)
        if (!tab || !tab.writable) return
        if (!isVscodeTabDirty(tab) && !tab.conflict) return
        void handleSave()
        return
      }
      if (key === 'w' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        handleCloseTab()
        return
      }
      if (key === 'o' && event.shiftKey && !event.altKey) {
        event.preventDefault()
        void pickAndOpenFolder()
        return
      }
      if (key === 'o' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        void pickAndOpen()
        return
      }
      if (key === 'f' && event.shiftKey && !event.altKey) {
        event.preventDefault()
        setSidebarView('search')
        setPrefs((current) => ({ ...current, sidebarVisible: true }))
        setSearchFocusNonce((value) => value + 1)
        return
      }
      if (key === 'h' && event.shiftKey && !event.altKey) {
        event.preventDefault()
        setSidebarView('search')
        setPrefs((current) => ({
          ...current,
          sidebarVisible: true,
          search: { ...current.search, showReplace: true },
        }))
        setSearchFocusNonce((value) => value + 1)
        setSearchExpandReplaceNonce((value) => value + 1)
        return
      }
      if (key === 'f' && !event.shiftKey && event.altKey) {
        event.preventDefault()
        setQuickSearchOpen(true)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    dirtyPrompt,
    handleCloseTab,
    handleSave,
    isActiveWindow,
    loading,
    openDialogOpen,
    pickAndOpen,
    pickAndOpenFolder,
  ])

  const updateTabText = useCallback((tabId: string, nextText: string) => {
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, text: nextText } : tab)))
  }, [])

  const setActiveLanguage = useCallback((language: string) => {
    const tabId = activeTabIdRef.current
    if (!tabId) return
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, language } : tab)))
    setLanguagePickerOpen(false)
  }, [])

  useEffect(() => {
    setLanguagePickerOpen(false)
  }, [activeTabId])

  const languageQuickPickItems = useMemo(
    () =>
      MONACO_SELECTABLE_LANGUAGES.map((item) => ({
        id: item.id,
        label: item.label,
        keywords: item.keywords,
      })),
    [],
  )

  const openSearchFiles = useMemo(
    () =>
      tabs.map((tab) => ({
        tabId: tab.id,
        path: tab.path,
        name: tab.name,
        text: tab.text,
      })),
    [tabs],
  )

  const dirtyPaths = useMemo(() => {
    const paths = new Set<string>()
    for (const tab of tabs) {
      if (isVscodeTabDirty(tab)) paths.add(tab.path)
    }
    return paths
  }, [tabs])

  const patchSearchPrefs = useCallback((patch: Partial<VscodePrefs['search']>) => {
    setPrefs((current) => ({
      ...current,
      search: { ...current.search, ...patch },
    }))
  }, [])

  const activateSearchSidebar = useCallback(
    (options?: { expandReplace?: boolean }) => {
      setSidebarView('search')
      setPrefs((current) => ({
        ...current,
        sidebarVisible: true,
        ...(options?.expandReplace
          ? { search: { ...current.search, showReplace: true } }
          : {}),
      }))
      setSearchFocusNonce((value) => value + 1)
      if (options?.expandReplace) {
        setSearchExpandReplaceNonce((value) => value + 1)
      }
    },
    [],
  )

  const findInFolder = useCallback(
    (folderPath: string) => {
      const root = prefs.workspaceFolder?.replace(/\/+$/, '') || ''
      const rel =
        root && folderPath.startsWith(`${root}/`)
          ? folderPath.slice(root.length + 1)
          : folderPath === root
            ? ''
            : folderPath
      setSearchSeedInclude(rel || '.')
      setSearchSeedIncludeNonce((value) => value + 1)
      activateSearchSidebar()
    },
    [activateSearchSidebar, prefs.workspaceFolder],
  )

  const openSearchHit = useCallback(
    (hit: VscodeWorkspaceSearchHit) => {
      void openDocument(hit.path, {
        reveal: { line: hit.line, column: hit.column },
      })
    },
    [openDocument],
  )

  const updateOpenFileTextByPath = useCallback((path: string, text: string) => {
    setTabs((prev) =>
      prev.map((tab) => (tab.path === path ? { ...tab, text } : tab)),
    )
  }, [])

  const openSearchEditorFromPanel = useCallback(
    async (payload: {
      query: string
      isCaseSensitive: boolean
      matchWholeWord: boolean
      isRegex: boolean
      filesToInclude: string
      filesToExclude: string
      useExcludeSettingsAndIgnoreFiles: boolean
      hits: VscodeWorkspaceSearchHit[]
    }) => {
      const contextLines = prefs.search.searchEditorContextLines
      let hits = payload.hits
      if (contextLines > 0 && prefs.workspaceFolder && payload.query.trim()) {
        const openMatched = matchVscodeOpenFiles(payload.query, openSearchFiles, {
          isCaseSensitive: payload.isCaseSensitive,
          matchWholeWord: payload.matchWholeWord,
          isRegex: payload.isRegex,
          filesToInclude: payload.filesToInclude,
          filesToExclude: payload.filesToExclude,
          useExcludeSettingsAndIgnoreFiles: payload.useExcludeSettingsAndIgnoreFiles,
          workspaceFolder: prefs.workspaceFolder,
          contextLines,
        })
        const skipPaths = new Set(openSearchFiles.map((file) => file.path))
        const workspaceResult = await searchVscodeWorkspaceFilesDetailed({
          query: payload.query,
          skipPaths,
          workspaceFolder: prefs.workspaceFolder,
          isCaseSensitive: payload.isCaseSensitive,
          matchWholeWord: payload.matchWholeWord,
          isRegex: payload.isRegex,
          filesToInclude: payload.filesToInclude,
          filesToExclude: payload.filesToExclude,
          useExcludeSettingsAndIgnoreFiles: payload.useExcludeSettingsAndIgnoreFiles,
          contextLines,
        })
        const openPaths = new Set(openSearchFiles.map((file) => file.path))
        hits = [
          ...openMatched.hits,
          ...workspaceResult.hits.filter((hit) => !openPaths.has(hit.path)),
        ]
      }

      const session = buildSearchEditorSession({
        query: payload.query,
        isCaseSensitive: payload.isCaseSensitive,
        matchWholeWord: payload.matchWholeWord,
        isRegex: payload.isRegex,
        filesToInclude: payload.filesToInclude,
        filesToExclude: payload.filesToExclude,
        useExcludeSettingsAndIgnoreFiles: payload.useExcludeSettingsAndIgnoreFiles,
        hits,
        contextLines,
      })
      setSearchEditorSessions((prev) => {
        const next = new Map(prev)
        next.set(session.id, session)
        return next
      })
      setEditorLayout((layout) => {
        const next = openSearchEditorInFocusedGroup(layout, session.id)
        editorLayoutRef.current = next
        return next
      })
    },
    [openSearchFiles, prefs.search.searchEditorContextLines, prefs.workspaceFolder],
  )

  const refreshSearchEditorContext = useCallback(
    async (sessionId: string, lines: number) => {
      const session = searchEditorSessions.get(sessionId)
      if (!session) return
      patchSearchPrefs({ searchEditorContextLines: lines })
      if (!prefs.workspaceFolder || !session.query.trim()) {
        setSearchEditorSessions((prev) => {
          const next = new Map(prev)
          const current = next.get(sessionId)
          if (!current) return prev
          next.set(sessionId, { ...current, contextLines: lines })
          return next
        })
        return
      }
      const openMatched = matchVscodeOpenFiles(session.query, openSearchFiles, {
        isCaseSensitive: session.isCaseSensitive,
        matchWholeWord: session.matchWholeWord,
        isRegex: session.isRegex,
        filesToInclude: session.filesToInclude,
        filesToExclude: session.filesToExclude,
        useExcludeSettingsAndIgnoreFiles: session.useExcludeSettingsAndIgnoreFiles,
        workspaceFolder: prefs.workspaceFolder,
        contextLines: lines,
      })
      const skipPaths = new Set(openSearchFiles.map((file) => file.path))
      const workspaceResult = await searchVscodeWorkspaceFilesDetailed({
        query: session.query,
        skipPaths,
        workspaceFolder: prefs.workspaceFolder,
        isCaseSensitive: session.isCaseSensitive,
        matchWholeWord: session.matchWholeWord,
        isRegex: session.isRegex,
        filesToInclude: session.filesToInclude,
        filesToExclude: session.filesToExclude,
        useExcludeSettingsAndIgnoreFiles: session.useExcludeSettingsAndIgnoreFiles,
        contextLines: lines,
      })
      const openPaths = new Set(openSearchFiles.map((file) => file.path))
      const hits = [
        ...openMatched.hits,
        ...workspaceResult.hits.filter((hit) => !openPaths.has(hit.path)),
      ]
      setSearchEditorSessions((prev) => {
        const next = new Map(prev)
        const current = next.get(sessionId)
        if (!current) return prev
        next.set(sessionId, { ...current, contextLines: lines, hits })
        return next
      })
    },
    [openSearchFiles, patchSearchPrefs, prefs.workspaceFolder, searchEditorSessions],
  )

  const menuBar = useMemo((): MenuDefinition[] => {
    return [
      {
        label: 'Virtual Studio Code Desktop',
        items: [
          ...aboutAppMenuPrefix('关于 Virtual Studio Code Desktop', () => showBuiltinAbout(APP_ID)),
          {
            type: 'action',
            label: '隐藏 Virtual Studio Code Desktop',
            shortcut: '⌘H',
            onClick: () => windowId && minimizeWindow(windowId),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出 Virtual Studio Code Desktop',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
      {
        label: '文件',
        items: [
          {
            type: 'action',
            label: '打开…',
            shortcut: '⌘O',
            disabled: loading || openDialogOpen || !!dirtyPrompt,
            onClick: () => void pickAndOpen(),
          },
          {
            type: 'action',
            label: '打开文件夹…',
            shortcut: '⇧⌘O',
            disabled: loading || openDialogOpen || !!dirtyPrompt,
            onClick: () => void pickAndOpenFolder(),
          },
          {
            type: 'action',
            label: '关闭文件夹',
            disabled: !prefs.workspaceFolder,
            onClick: () => closeWorkspaceFolder(),
          },
          {
            type: 'action',
            label: '关闭标签',
            shortcut: '⌘W',
            disabled: !activeTab || loading || openDialogOpen || !!dirtyPrompt,
            onClick: () => handleCloseTab(),
          },
          {
            type: 'action',
            label: '关闭其他标签',
            disabled:
              !hasOtherTabsInFocusedGroup || loading || openDialogOpen || !!dirtyPrompt,
            onClick: () => handleCloseOtherTabs(),
          },
          {
            type: 'action',
            label: '保存',
            shortcut: '⌘S',
            disabled: !activeTab || !writable || !dirty || loading,
            onClick: () => void handleSave(),
          },
        ],
      },
      {
        label: '查看',
        items: [
          {
            type: 'action',
            label: `${menuCheckPrefix(prefs.sidebarVisible)}侧栏`,
            onClick: () => updatePrefs({ sidebarVisible: !prefs.sidebarVisible }),
          },
          {
            type: 'action',
            label: `${menuCheckPrefix(prefs.terminalVisible && prefs.panelTab === 'problems')}问题`,
            onClick: () => toggleBottomPanelTab('problems'),
          },
          {
            type: 'action',
            label: `${menuCheckPrefix(prefs.terminalVisible && prefs.panelTab === 'terminal')}终端`,
            onClick: () => toggleBottomPanelTab('terminal'),
          },
          {
            type: 'action',
            label: `${menuCheckPrefix(prefs.terminalVisible && prefs.panelTab === 'logs')}日志`,
            onClick: () => toggleBottomPanelTab('logs'),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '工作区',
            onClick: () => {
              setSidebarView('explorer')
              updatePrefs({ sidebarVisible: true })
            },
          },
          {
            type: 'action',
            label: '搜索',
            shortcut: '⇧⌘F',
            onClick: () => activateSearchSidebar(),
          },
          {
            type: 'action',
            label: 'AI',
            onClick: () => openOrFocusAiChat(),
          },
          {
            type: 'action',
            label: '在文件中替换',
            shortcut: '⇧⌘H',
            onClick: () => activateSearchSidebar({ expandReplace: true }),
          },
          {
            type: 'action',
            label: '快速搜索',
            shortcut: '⌥⌘F',
            onClick: () => setQuickSearchOpen(true),
          },
          {
            type: 'action',
            label: '设置',
            onClick: () => {
              setSidebarView('settings')
              updatePrefs({ sidebarVisible: true })
            },
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '在侧边打开预览',
            disabled: !showMarkdownPreviewAction || loading || openDialogOpen || !!dirtyPrompt,
            onClick: () => openMarkdownPreviewBeside(editorLayoutRef.current.focusedGroupId),
          },
        ],
      },
    ]
  }, [
    activateSearchSidebar,
    activeTab,
    closeWindowsForApp,
    closeWorkspaceFolder,
    dirty,
    dirtyPrompt,
    handleCloseOtherTabs,
    handleCloseTab,
    handleSave,
    hasOtherTabsInFocusedGroup,
    loading,
    minimizeWindow,
    openDialogOpen,
    openMarkdownPreviewBeside,
    openOrFocusAiChat,
    pickAndOpen,
    pickAndOpenFolder,
    prefs.panelTab,
    prefs.sidebarVisible,
    prefs.terminalVisible,
    prefs.workspaceFolder,
    showBuiltinAbout,
    showMarkdownPreviewAction,
    toggleBottomPanelTab,
    updatePrefs,
    windowId,
    writable,
  ])

  useAppMenuBar(APP_ID, menuBar, isActiveWindow)

  const dirtyPromptActions = useMemo(
    () => [
      {
        key: 'save',
        label: '保存',
        tone: 'primary' as const,
        disabled: !dirtyPrompt?.writable || loading,
        onClick: () => resolveDirtyPrompt('save'),
      },
      {
        key: 'discard',
        label: '不保存',
        tone: 'danger' as const,
        onClick: () => resolveDirtyPrompt('discard'),
      },
      {
        key: 'cancel',
        label: '取消',
        tone: 'secondary' as const,
        onClick: () => resolveDirtyPrompt('cancel'),
      },
    ],
    [dirtyPrompt?.writable, loading, resolveDirtyPrompt],
  )

  const activateSidebar = (view: SidebarView) => {
    if (prefs.sidebarVisible && sidebarView === view) {
      updatePrefs({ sidebarVisible: false })
      return
    }
    setSidebarView(view)
    updatePrefs({ sidebarVisible: true })
  }

  const revealInExplorer = useCallback(
    (path: string) => {
      setSidebarView('explorer')
      updatePrefs({ sidebarVisible: true })
      setRevealPath(path)
      setRevealNonce((value) => value + 1)
    },
    [updatePrefs],
  )

  const openInFiles = useCallback(
    (path: string) => {
      requestFilesReveal(path)
      openApp('files', { documentId: path })
    },
    [openApp],
  )

  // 侧栏（重新）打开或会话恢复完成后，展开并滚到当前编辑文件；同一轮打开内切 Tab 不重复
  const explorerVisible = prefs.sidebarVisible && sidebarView === 'explorer'
  const explorerRevealDoneRef = useRef(false)
  useEffect(() => {
    if (!explorerVisible) {
      explorerRevealDoneRef.current = false
      return
    }
    if (explorerRevealDoneRef.current) return
    // 等会话恢复出 activeTab，避免恢复前空跑后不再揭示
    if (!sessionReady) return
    const path = activeTab?.path
    if (!path || !prefs.workspaceFolder) return
    const root = prefs.workspaceFolder.replace(/\/+$/, '') || '/'
    if (path !== root && !path.startsWith(`${root}/`)) return
    explorerRevealDoneRef.current = true
    setRevealPath(path)
    setRevealNonce((value) => value + 1)
  }, [activeTab?.path, explorerVisible, prefs.workspaceFolder, sessionReady])

  const getActiveActivityButton = useCallback((): HTMLButtonElement | undefined => {
    if (!prefs.sidebarVisible) return undefined
    if (sidebarView === 'explorer') return explorerBtnRef.current ?? undefined
    if (sidebarView === 'search') return searchBtnRef.current ?? undefined
    return settingsBtnRef.current ?? undefined
  }, [prefs.sidebarVisible, sidebarView])

  const syncActivityCaretTop = useCallback(() => {
    if (!windowId || !prefs.sidebarVisible) return false
    const rail = activityRailRef.current
    const sidebar = sidebarRef.current
    const btn = getActiveActivityButton()
    if (!rail || !sidebar || !btn) return false

    let caretY: number
    if (btn.offsetParent === rail) {
      const railRect = rail.getBoundingClientRect()
      const sidebarRect = sidebar.getBoundingClientRect()
      const railSidebarOffset = sidebarRect.top - railRect.top
      caretY = railSidebarOffset + btn.offsetTop + btn.offsetHeight / 2
    } else {
      const sidebarRect = sidebar.getBoundingClientRect()
      const btnRect = btn.getBoundingClientRect()
      caretY = btnRect.top - sidebarRect.top + btnRect.height / 2
    }

    setActivityCaretTop(Math.round(caretY))
    setCaretReady(true)
    return true
  }, [getActiveActivityButton, prefs.sidebarVisible, windowId])

  const syncActivityCaretTopRef = useRef(syncActivityCaretTop)
  syncActivityCaretTopRef.current = syncActivityCaretTop

  const bindSidebarRef = useCallback((node: HTMLElement | null) => {
    sidebarRef.current = node
    if (node) {
      queueMicrotask(() => syncActivityCaretTopRef.current())
    }
  }, [])

  useLayoutEffect(() => {
    if (!windowId) return
    syncActivityCaretTop()

    const rail = activityRailRef.current
    if (!rail || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      syncActivityCaretTop()
    })
    observer.observe(rail)
    return () => observer.disconnect()
  }, [syncActivityCaretTop, sidebarView, windowId, sessionReady, prefs.sidebarVisible])

  useEffect(() => {
    if (!windowId || !prefs.sidebarVisible) return

    let raf2 = 0
    const raf1 = window.requestAnimationFrame(() => {
      syncActivityCaretTop()
      raf2 = window.requestAnimationFrame(() => {
        syncActivityCaretTop()
      })
    })
    const timer = window.setTimeout(() => {
      syncActivityCaretTop()
    }, 320)

    return () => {
      window.cancelAnimationFrame(raf1)
      if (raf2) window.cancelAnimationFrame(raf2)
      window.clearTimeout(timer)
    }
  }, [syncActivityCaretTop, sidebarView, windowId, sessionReady, prefs.sidebarVisible])

  if (!windowId) {
    return <div class="vscode" />
  }

  return (
    <div
      class={`vscode${isVscodeChromeDark(prefs.theme) ? ' vscode--chrome-dark' : ''}`}
      style={{ '--vscode-editor-bg': monacoEditorBackgroundForTheme(prefs.theme) }}
    >
      <div class="vscode__body">
        <aside class="vscode__activity" aria-label="工具栏" ref={activityRailRef}>
          <div class="vscode__activity-brand" aria-hidden="true" title="Virtual Studio Code Desktop">
            <VscodeIcon size={32} />
          </div>
          <button
            type="button"
            ref={explorerBtnRef}
            class={`vscode__activity-btn${sidebarView === 'explorer' && prefs.sidebarVisible ? ' vscode__activity-btn--active' : ''}`}
            title="工作区"
            onClick={() => activateSidebar('explorer')}
          >
            <svg class="vscode__activity-glyph" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3.5 7.2c0-.9.7-1.7 1.7-1.7h5.1l1.4 1.5h7.1c.9 0 1.7.8 1.7 1.7v8.4c0 .9-.8 1.7-1.7 1.7H5.2c-.9 0-1.7-.8-1.7-1.7V7.2z" />
            </svg>
          </button>
          <button
            type="button"
            ref={searchBtnRef}
            class={`vscode__activity-btn${sidebarView === 'search' && prefs.sidebarVisible ? ' vscode__activity-btn--active' : ''}`}
            title="搜索"
            onClick={() => activateSearchSidebar()}
          >
            <svg class="vscode__activity-glyph" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.2" fill="none" stroke="currentColor" stroke-width="2.4" />
              <path
                d="M15.2 15.2 L20.2 20.2"
                fill="none"
                stroke="currentColor"
                stroke-width="2.6"
                stroke-linecap="round"
              />
            </svg>
          </button>
          <div class="vscode__activity-spacer" />
          <button
            type="button"
            ref={settingsBtnRef}
            class={`vscode__activity-btn${sidebarView === 'settings' && prefs.sidebarVisible ? ' vscode__activity-btn--active' : ''}`}
            title="设置"
            onClick={() => activateSidebar('settings')}
          >
            <svg class="vscode__activity-glyph" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97 0-.33-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1 0 .33.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66z" />
            </svg>
          </button>
        </aside>

        {prefs.sidebarVisible ? (
          <>
          <div class="vscode__sidebar-shell" style={{ width: `${prefs.sidebarWidth}px` }}>
            <aside
              class={`vscode__sidebar${caretReady ? '' : ' vscode__sidebar--caret-instant'}`}
              ref={bindSidebarRef}
              style={{
                ['--vscode-caret-y' as string]: `${activityCaretTop}px`,
              }}
            >
            {sidebarView === 'explorer' ? (
              <VscodeExplorer
                workspaceFolder={prefs.workspaceFolder}
                selectedPath={activeTab?.path}
                revealPath={revealPath}
                revealNonce={revealNonce}
                problemDecorations={problemDecorations}
                onOpenFile={(path) => void openDocument(path)}
                onOpenFolder={() => void pickAndOpenFolder()}
                onOpenInFiles={openInFiles}
                onFindInFolder={findInFolder}
              />
            ) : undefined}

            {sidebarView === 'search' ? (
              <VscodeSearchPanel
                workspaceFolder={prefs.workspaceFolder}
                openFiles={openSearchFiles}
                dirtyPaths={dirtyPaths}
                searchPrefs={prefs.search}
                onPatchSearchPrefs={patchSearchPrefs}
                focusNonce={searchFocusNonce}
                expandReplaceNonce={searchExpandReplaceNonce}
                seedInclude={searchSeedInclude}
                seedIncludeNonce={searchSeedIncludeNonce}
                onOpenHit={openSearchHit}
                onUpdateOpenFileText={updateOpenFileTextByPath}
                onOpenSearchEditor={(payload) => void openSearchEditorFromPanel(payload)}
              />
            ) : undefined}

            {sidebarView === 'settings' ? (
              <div class="vscode__settings">
                <div class="vscode__sidebar-header">设置</div>
                <SettingsChoiceField
                  label="主题"
                  value={prefs.theme}
                  options={VSCODE_THEME_OPTIONS}
                  onChange={(value) =>
                    updatePrefs({ theme: value as VscodePrefs['theme'] })
                  }
                  wideLayout
                  presentation="form"
                  fieldClass="vscode__setting"
                  labelClass=""
                  dark={isVscodeChromeDark(prefs.theme)}
                />
                <label class="vscode__setting">
                  <span>字号</span>
                  <input
                    type="number"
                    min={10}
                    max={24}
                    value={prefs.fontSize}
                    onInput={(event) =>
                      updatePrefs({
                        fontSize: Number((event.target as HTMLInputElement).value) || 13,
                      })
                    }
                  />
                </label>
                <div class="vscode__setting vscode__setting--row">
                  <span>小地图</span>
                  <IosSwitch
                    checked={prefs.minimap}
                    onChange={(checked) => updatePrefs({ minimap: checked })}
                    label="小地图"
                  />
                </div>
                <div class="vscode__setting vscode__setting--row">
                  <span>自动换行</span>
                  <IosSwitch
                    checked={prefs.wordWrap}
                    onChange={(checked) => updatePrefs({ wordWrap: checked })}
                    label="自动换行"
                  />
                </div>
                <div class="vscode__setting vscode__setting--row">
                  <span>代码补全</span>
                  <IosSwitch
                    checked={prefs.completionEnabled}
                    onChange={(checked) => updatePrefs({ completionEnabled: checked })}
                    label="代码补全"
                  />
                </div>
                {prefs.completionEnabled ? (
                  <SettingsChoiceField
                    label="补全模型"
                    value={
                      prefs.completionModelKey ??
                      prefs.aiModelKey ??
                      completionModelOptions[0]?.id ??
                      ''
                    }
                    options={
                      completionModelOptions.length === 0
                        ? [{ id: '', label: '未配置文本模型' }]
                        : completionModelOptions
                    }
                    onChange={(value) =>
                      updatePrefs({
                        completionModelKey: value.trim() ? value : undefined,
                      })
                    }
                    disabled={completionModelOptions.length === 0}
                    wideLayout
                    presentation="form"
                    fieldClass="vscode__setting"
                    labelClass=""
                    dark={isVscodeChromeDark(prefs.theme)}
                  />
                ) : undefined}
              </div>
            ) : undefined}
          </aside>
          </div>
          <div
            class="vscode__sidebar-sash"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整侧栏宽度"
            onPointerDown={onSidebarSashPointerDown}
          />
          </>
        ) : undefined}

        <div class="vscode__main" ref={mainPaneRef}>
          <div class="vscode__editor-pane">
            <VscodeEditorArea
              layout={editorLayout}
              tabs={tabs}
              loading={loading}
              dialogBlocked={openDialogOpen || !!dirtyPrompt}
              isActiveWindow={isActiveWindow}
              prefs={{
                theme: prefs.theme,
                fontSize: prefs.fontSize,
                minimap: prefs.minimap,
                wordWrap: prefs.wordWrap,
                completionEnabled: prefs.completionEnabled,
                completionDebounceMs: prefs.completionDebounceMs,
                completionModelKey: prefs.completionModelKey ?? prefs.aiModelKey,
              }}
              revealPosition={revealPosition}
              onRevealPositionApplied={() => setRevealPosition(undefined)}
              onFocusGroup={(groupId) =>
                setEditorLayout((current) => focusEditorGroup(current, groupId))
              }
              onActivateItem={(groupId, itemId) =>
                setEditorLayout((current) => focusEditorItem(current, groupId, itemId))
              }
              onCloseFileTab={(tabId) => void closeTab(tabId)}
              onClosePreview={closePreviewItem}
              onCloseOtherInGroup={(groupId, keepItemId) =>
                void closeOtherInGroup(groupId, keepItemId)
              }
              onRevealInExplorer={revealInExplorer}
              onOpenInFiles={openInFiles}
              workspaceFolder={prefs.workspaceFolder}
              onMoveItemToGroup={(itemId, targetGroupId, targetIndex) =>
                setEditorLayout((current) =>
                  moveEditorItemToGroup(current, itemId, targetGroupId, targetIndex),
                )
              }
              onSplitItemToEdge={(itemId, targetGroupId, edge) =>
                setEditorLayout((current) =>
                  splitEditorWithItem(current, itemId, targetGroupId, edge),
                )
              }
              onOpenMarkdownPreview={openMarkdownPreviewBeside}
              onTabTextChange={updateTabText}
              onCursorChange={applyCursor}
              onSelectionChange={applySelection}
              onOpenPath={handleEditorOpenPath}
              onResolveConflict={resolveTabConflict}
              onConfirmBinaryPrompt={confirmBinaryPrompt}
              onSetBranchRatio={(branchId, ratio) =>
                setEditorLayout((current) => setBranchRatio(current, branchId, ratio))
              }
              searchEditorSessions={searchEditorSessions}
              onCloseSearchEditor={closeSearchEditorItem}
              onSearchEditorOpenHit={openSearchHit}
              onSearchEditorContextLinesChange={(sessionId, lines) =>
                void refreshSearchEditorContext(sessionId, lines)
              }
              aiChatSessions={aiChatSessions}
              closedAiChats={closedAiChats}
              onNewAiChat={openNewAiChat}
              onRestoreAiChat={restoreClosedAiChat}
              onCloseAiChat={closeAiChatItem}
              onAiChatMessagesChange={updateAiChatMessages}
              aiMode={prefs.aiMode}
              onAiModeChange={(aiMode) => updatePrefs({ aiMode })}
              aiModelKey={prefs.aiModelKey}
              onAiModelKeyChange={(key) => updatePrefs({ aiModelKey: key })}
              aiDark={isVscodeChromeDark(prefs.theme)}
              getAiContext={getVscodeAiContext}
              getOpenFilesForSearch={() => openSearchFiles}
              problems={problems}
              terminalRepl={terminalRepl ?? undefined}
              onApplyAiEdit={applyVscodeAiEdit}
              onRejectAiEdit={() => undefined}
              pickAndOpenFolder={pickAndOpenFolder}
              pickAndOpen={pickAndOpen}
              onCloseWelcome={closeWelcomeTab}
            />
          </div>

          {prefs.terminalVisible ? (
            <>
              <div
                class="vscode__terminal-sash"
                role="separator"
                aria-orientation="horizontal"
                aria-label="调整面板高度"
                onPointerDown={onTerminalSashPointerDown}
              />
              <div class="vscode__terminal" style={{ height: `${prefs.terminalHeight}px` }}>
                <div class="vscode__panel-header vscode__panel-header--tabs" role="tablist" aria-label="面板">
                  <button
                    type="button"
                    role="tab"
                    class={`vscode__panel-tab${prefs.panelTab === 'problems' ? ' vscode__panel-tab--active' : ''}`}
                    aria-selected={prefs.panelTab === 'problems'}
                    onClick={() => updatePrefs({ panelTab: 'problems' })}
                  >
                    问题
                    {problems.length > 0 ? (
                      <span class="vscode__panel-tab-count">{problems.length}</span>
                    ) : undefined}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    class={`vscode__panel-tab${prefs.panelTab === 'terminal' ? ' vscode__panel-tab--active' : ''}`}
                    aria-selected={prefs.panelTab === 'terminal'}
                    onClick={() => updatePrefs({ panelTab: 'terminal' })}
                  >
                    终端
                  </button>
                  <button
                    type="button"
                    role="tab"
                    class={`vscode__panel-tab${prefs.panelTab === 'logs' ? ' vscode__panel-tab--active' : ''}`}
                    aria-selected={prefs.panelTab === 'logs'}
                    onClick={() => updatePrefs({ panelTab: 'logs' })}
                  >
                    日志
                  </button>
                  <span class="vscode__panel-header-spacer" aria-hidden="true" />
                  <button
                    type="button"
                    class="vscode__panel-close"
                    aria-label="关闭面板"
                    title="关闭面板"
                    onClick={() => updatePrefs({ terminalVisible: false })}
                  >
                    ×
                  </button>
                </div>
                <div
                  class={`vscode__panel-body${prefs.panelTab === 'problems' ? '' : ' vscode__panel-body--hidden'}`}
                  hidden={prefs.panelTab !== 'problems'}
                >
                  <VscodeProblemsPanel problems={problems} onSelect={openProblem} />
                </div>
                <div
                  class={`vscode__panel-body${prefs.panelTab === 'terminal' ? '' : ' vscode__panel-body--hidden'}`}
                  hidden={prefs.panelTab !== 'terminal'}
                >
                  {terminalReplPanel}
                </div>
                <div
                  class={`vscode__panel-body${prefs.panelTab === 'logs' ? '' : ' vscode__panel-body--hidden'}`}
                  hidden={prefs.panelTab !== 'logs'}
                >
                  <VscodeLogPanel />
                </div>
              </div>
            </>
          ) : (
            <div class="vscode__terminal-keeper" hidden aria-hidden="true">
              {terminalReplPanel}
            </div>
          )}
        </div>
      </div>

      <footer class="vscode__status">
        <button
          type="button"
          class={`vscode__status-problems-btn${prefs.terminalVisible && prefs.panelTab === 'problems' ? ' vscode__status-problems-btn--active' : ''}`}
          title="问题"
          aria-pressed={prefs.terminalVisible && prefs.panelTab === 'problems'}
          onClick={() => toggleBottomPanelTab('problems')}
        >
          <span class="vscode__status-problems-part vscode__status-problems-part--error">
            <svg class="vscode__status-problems-glyph" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="5.25" fill="none" stroke="currentColor" stroke-width="1.5" />
              <path
                d="M8 5.2 V8.6 M8 10.6 V10.85"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
            <span>{problemSummary.errors}</span>
          </span>
          <span class="vscode__status-problems-part vscode__status-problems-part--warning">
            <svg class="vscode__status-problems-glyph" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M8 2.6 L13.4 12.4 H2.6 Z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linejoin="round"
              />
              <path
                d="M8 6.2 V9.2 M8 10.7 V10.95"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
              />
            </svg>
            <span>{problemSummary.warnings}</span>
          </span>
        </button>
        <button
          type="button"
          class={`vscode__status-terminal-btn${prefs.terminalVisible && prefs.panelTab === 'terminal' ? ' vscode__status-terminal-btn--active' : ''}`}
          title={
            prefs.terminalVisible && prefs.panelTab === 'terminal' ? '隐藏终端' : '显示终端'
          }
          aria-pressed={prefs.terminalVisible && prefs.panelTab === 'terminal'}
          onClick={() => toggleBottomPanelTab('terminal')}
        >
          <svg class="vscode__status-terminal-glyph" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4.2 7.2 L9.8 12 L4.2 16.8"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M11.5 16.8 H19.5"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
            />
          </svg>
          <span>终端</span>
        </button>
        <button
          type="button"
          class={`vscode__status-terminal-btn${prefs.terminalVisible && prefs.panelTab === 'logs' ? ' vscode__status-terminal-btn--active' : ''}`}
          title={prefs.terminalVisible && prefs.panelTab === 'logs' ? '隐藏日志' : '显示日志'}
          aria-pressed={prefs.terminalVisible && prefs.panelTab === 'logs'}
          onClick={() => toggleBottomPanelTab('logs')}
        >
          <svg class="vscode__status-terminal-glyph" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M5 6.5 H19 M5 12 H19 M5 17.5 H14"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
            />
          </svg>
          <span>日志</span>
        </button>
        <span class="vscode__status-spacer" />
        {activeTab ? (
          <>
            <VscodeStatusCursorButton
              expanded={gotoLineOpen}
              onOpenGoto={openGotoLineDialog}
              registerSetter={registerCursorSetter}
            />
            <button
              type="button"
              class="vscode__status-lang-btn"
              aria-haspopup="dialog"
              aria-expanded={languagePickerOpen}
              title="选择语言模式"
              onClick={() => setLanguagePickerOpen(true)}
            >
              {monacoLanguageLabel(activeTab.language)}
            </button>
            {activeTab.conflict || activeTab.deleted || activeTab.binaryPrompt || !activeTab.writable ? (
              <span>
                {activeTab.binaryPrompt
                  ? '二进制'
                  : activeTab.conflict
                    ? '冲突'
                    : activeTab.deleted
                      ? '已删除'
                      : '只读'}
              </span>
            ) : undefined}
          </>
        ) : undefined}
        {loading ? <span>处理中…</span> : undefined}
      </footer>

      {openDialog}

      <VscodeQuickPick
        open={languagePickerOpen}
        title="选择语言模式"
        placeholder="输入语言名称或后缀筛选…"
        items={languageQuickPickItems}
        activeId={activeTab?.language}
        onClose={() => setLanguagePickerOpen(false)}
        onSelect={(item) => setActiveLanguage(item.id)}
      />

      <VscodeQuickSearch
        open={quickSearchOpen}
        workspaceFolder={prefs.workspaceFolder}
        openFiles={openSearchFiles}
        onClose={() => setQuickSearchOpen(false)}
        onSelect={openSearchHit}
      />

      <WindowModal
        open={gotoLineOpen}
        title="跳转到行列"
        themeColor={THEME}
        onClose={() => setGotoLineOpen(false)}
        actions={[
          {
            label: '取消',
            tone: 'secondary',
            onClick: () => setGotoLineOpen(false),
          },
          {
            label: '跳转',
            tone: 'primary',
            onClick: confirmGotoLine,
          },
        ]}
      >
        <p class="window-modal__message">输入要跳转的行号与列号。</p>
        <div class="window-modal__field">
          <label for="vscode-goto-line">行</label>
          <input
            id="vscode-goto-line"
            type="number"
            min={1}
            value={gotoLineInput}
            autofocus={true}
            onInput={(event) => setGotoLineInput((event.target as HTMLInputElement).value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                confirmGotoLine()
              }
            }}
          />
        </div>
        <div class="window-modal__field">
          <label for="vscode-goto-column">列</label>
          <input
            id="vscode-goto-column"
            type="number"
            min={1}
            value={gotoColumnInput}
            onInput={(event) => setGotoColumnInput((event.target as HTMLInputElement).value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                confirmGotoLine()
              }
            }}
          />
        </div>
      </WindowModal>

      <WindowModal
        open={!!dirtyPrompt}
        title="未保存的更改"
        role="alertdialog"
        themeColor={THEME}
        actions={dirtyPromptActions}
      >
        <p class="window-modal__message">是否保存对「{dirtyPrompt?.fileName}」的更改？</p>
      </WindowModal>
    </div>
  )
}
