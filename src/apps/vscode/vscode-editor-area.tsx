import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type OpenAI from 'openai'
import { MonacoEditor, type MonacoRevealPosition } from '../../monaco/monaco-editor.tsx'
import { useIconContextMenu } from '../../os/icon-context-menu-context.tsx'
import { parseFilesAbsolutePath } from '../files/files-path.ts'
import type {
  VscodeAiModelOptionPrefs,
  VscodeCustomSubAgent,
  VscodeModelSource,
  VscodePrefs,
} from './vscode-prefs.ts'
import { VscodeMarkdownPreview } from './vscode-markdown-preview.tsx'
import {
  type VscodeEditorDragPayload,
  type VscodeEditorGroupState,
  type VscodeEditorLayoutState,
  type VscodeGroupItem,
  type VscodeLayoutNode,
  type VscodeSplitEdge,
  VSCODE_EDITOR_DRAG_MIME,
  getActiveEditorDrag,
  getGroupActiveItem,
  setActiveEditorDrag,
} from './vscode-editor-layout.ts'
import { isPreviewableTab, isVscodeTabDirty, type VscodeTab } from './vscode-tabs.ts'
import { relativeToWorkspace } from './vscode-workspace-search-ignore.ts'
import { VscodeSearchEditor } from './vscode-search-editor.tsx'
import type { VscodeSearchEditorSession } from './vscode-search-editor-session.ts'
import type { VscodeWorkspaceSearchHit } from './vscode-workspace-search-core.ts'
import { VscodeAiPanel } from './vscode-ai-panel.tsx'
import { VscodeSubagentPanel } from './vscode-subagent-panel.tsx'
import type { VscodeAiMode } from './vscode-ai-mode.ts'
import type {
  VscodeAiChatMessage,
  VscodeAiChatSession,
  VscodeAiClosedChatSession,
} from './vscode-ai-chat-storage.ts'
import type { VscodeAiContextInput } from './vscode-ai-context.ts'
import type { MonacoProblem } from '../../monaco/monaco-markers.ts'
import type { TerminalReplHandle } from '../terminal/terminal-repl-panel.tsx'
import type { TerminalChangeSet } from '../../terminal/terminal-changeset.ts'
import type {
  VscodeAgentTerminalEnsureResult,
  VscodeAiLastChangeSource,
} from './vscode-ai-run-command.ts'
import type {
  VscodeAgentTerminalSnapshot,
  VscodeAiTerminalKind,
} from './vscode-terminal-sessions.ts'
import { HistoryIcon, PlusIcon } from '../../icons/app-icons.tsx'

type DropZone = VscodeSplitEdge

type TabVisualSnapshot = {
  title: string
  pathTitle: string
  dirty: boolean
  deleted: boolean
  conflict: boolean
}

type DisplayTab = {
  item: VscodeGroupItem
  exiting: boolean
  snapshot: TabVisualSnapshot
}

function computeTabSnapshot(
  item: VscodeGroupItem,
  tabs: readonly VscodeTab[],
  aiChatSessions: ReadonlyMap<string, VscodeAiChatSession> | undefined,
): TabVisualSnapshot {
  const fileTab = item.kind === 'file' ? tabs.find((tab) => tab.id === item.tabId) : undefined
  const previewSource =
    item.kind === 'preview' ? tabs.find((tab) => tab.path === item.sourcePath) : undefined
  const aiSession =
    item.kind === 'aiChat' ? aiChatSessions?.get(item.sessionId) : undefined

  const title =
    item.kind === 'searchEditor'
      ? '搜索编辑器'
      : item.kind === 'aiChat'
        ? aiSession?.title || '新对话'
        : item.kind === 'subagentDetail'
          ? 'Sub Agent'
          : item.kind === 'preview'
            ? `Preview ${previewSource?.name ?? 'Markdown'}`
            : item.kind === 'welcome'
              ? '欢迎'
              : fileTab
                ? fileTab.deleted
                  ? `${fileTab.name}（已删除）`
                  : fileTab.conflict
                    ? `${fileTab.name}（冲突）`
                    : fileTab.binaryPrompt
                      ? `${fileTab.name}（二进制）`
                      : fileTab.name
                : '未知文件'

  return {
    title,
    pathTitle:
      item.kind === 'searchEditor'
        ? 'Search Editor'
        : item.kind === 'aiChat'
          ? 'AI Chat'
          : item.kind === 'subagentDetail'
            ? 'Sub Agent'
            : item.kind === 'preview'
              ? previewSource?.path ?? item.sourcePath
              : item.kind === 'welcome'
              ? 'Welcome'
              : fileTab?.path ?? '',
    dirty: fileTab ? isVscodeTabDirty(fileTab) : false,
    deleted: Boolean(fileTab?.deleted),
    conflict: Boolean(fileTab?.conflict),
  }
}

function itemExistsInLayout(layout: VscodeEditorLayoutState, itemId: string): boolean {
  for (const group of Object.values(layout.groups)) {
    if (group.items.some((item) => item.id === itemId)) return true
  }
  return false
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 标签 flex 宽度过渡时长，与 CSS 保持一致。 */
const TAB_FLEX_TRANSITION_MS = 200

function listenTabFlexTransition(
  node: HTMLElement,
  onDone: () => void,
): () => void {
  const finish = (event: TransitionEvent) => {
    if (event.target !== node || event.propertyName !== 'flex-grow') return
    onDone()
  }
  node.addEventListener('transitionend', finish)
  const fallback = window.setTimeout(onDone, TAB_FLEX_TRANSITION_MS + 50)
  return () => {
    node.removeEventListener('transitionend', finish)
    window.clearTimeout(fallback)
  }
}

/** 均分后单标签宽度低于此值时，才启用悬停/激活加宽。 */
const TAB_EXPAND_MIN_WIDTH = 96

function measureTabsCrowded(tabsEl: HTMLElement): boolean {
  const tabCount = tabsEl.querySelectorAll('.vscode__tab:not(.vscode__tab--exit)').length
  if (tabCount === 0) return false
  const width = tabsEl.clientWidth
  if (width <= 0) return false
  return width / tabCount < TAB_EXPAND_MIN_WIDTH
}

type VscodeEditorAreaProps = {
  layout: VscodeEditorLayoutState
  tabs: readonly VscodeTab[]
  loading: boolean
  dialogBlocked: boolean
  isActiveWindow: boolean
  prefs: {
    theme: VscodePrefs['theme']
    fontSize: number
    minimap: boolean
    wordWrap: boolean
    completionEnabled?: boolean
    completionDebounceMs?: number
    completionModelKey?: string | undefined
  }
  revealPosition: (MonacoRevealPosition & { path: string }) | undefined
  onRevealPositionApplied: () => void
  onFocusGroup: (groupId: string) => void
  onActivateItem: (groupId: string, itemId: string) => void
  onCloseFileTab: (tabId: string) => void
  onClosePreview: (itemId: string) => void
  onCloseOtherInGroup: (groupId: string, keepItemId: string) => void
  onRevealInExplorer: (path: string) => void
  onOpenInFiles: (path: string) => void
  workspaceFolder: string | undefined
  onMoveItemToGroup: (itemId: string, targetGroupId: string, targetIndex?: number) => void
  onSplitItemToEdge: (itemId: string, targetGroupId: string, edge: VscodeSplitEdge) => void
  onOpenMarkdownPreview: (groupId: string) => void
  inlinePreviewTabIds?: ReadonlySet<string>
  onToggleInlinePreview?: (tabId: string, open: boolean) => void
  onTabTextChange: (tabId: string, text: string) => void
  onCursorChange: (line: number, column: number) => void
  onSelectionChange?: (selectionText: string | undefined) => void
  onOpenPath: (path: string, reveal?: MonacoRevealPosition) => boolean | Promise<boolean>
  onResolveConflict: (tabId: string, choice: 'draft' | 'disk') => void
  onConfirmBinaryPrompt: (tabId: string) => void
  onSetBranchRatio: (branchId: string, ratio: number) => void
  searchEditorSessions?: ReadonlyMap<string, VscodeSearchEditorSession>
  onCloseSearchEditor?: (itemId: string) => void
  onSearchEditorOpenHit?: (hit: VscodeWorkspaceSearchHit) => void
  onSearchEditorContextLinesChange?: (sessionId: string, lines: number) => void
  aiChatSessions?: ReadonlyMap<string, VscodeAiChatSession>
  aiChatBusySessionIds?: ReadonlySet<string>
  closedAiChats?: readonly VscodeAiClosedChatSession[]
  onNewAiChat?: () => void
  onRestoreAiChat?: (sessionId: string) => void
  onCloseAiChat?: (itemId: string) => void
  onAiChatMessagesChange?: (
    sessionId: string,
    messages: VscodeAiChatMessage[],
    extras?: { apiTranscript?: OpenAI.Chat.ChatCompletionMessageParam[] },
  ) => void
  onAiChatBusyChange?: (sessionId: string, busy: boolean) => void
  onAiChatLastSentTerminalChange?: (
    sessionId: string,
    lastSentTerminal: VscodeAiChatSession['lastSentTerminal'],
  ) => void
  aiMode?: VscodeAiMode
  onAiModeChange?: (mode: VscodeAiMode) => void
  aiModelSource?: VscodeModelSource
  aiModelKey?: string | undefined
  onAiModelSelectionChange?: (
    source: VscodeModelSource,
    modelKey: string | undefined,
  ) => void
  aiModelOptions?: Record<string, VscodeAiModelOptionPrefs>
  onAiModelOptionsChange?: (next: Record<string, VscodeAiModelOptionPrefs>) => void
  subAgentsEnabled?: boolean
  subAgentsMaxConcurrent?: number
  subAgentBuiltinOverrides?: VscodePrefs['subAgentBuiltinOverrides']
  customSubAgents?: VscodeCustomSubAgent[]
  aiIdleRetryCount?: number
  aiDebugSystemReminder?: boolean
  aiDark?: boolean
  getAiContext?: () => VscodeAiContextInput
  problems?: readonly MonacoProblem[]
  getNpmLastChangesSlot?: (chatSessionId: string) => {
    current: TerminalChangeSet | undefined
  }
  getLastChangeSourceSlot?: (chatSessionId: string) => {
    current: VscodeAiLastChangeSource | undefined
  }
  onTerminalChangesAvailable?: (available: boolean) => void
  ensureAiTerminal?: (
    kind: VscodeAiTerminalKind,
    chatSessionId: string,
    chatTitle: string,
  ) => Promise<VscodeAgentTerminalEnsureResult>
  getAiTerminalHandle?: (
    kind: VscodeAiTerminalKind,
    chatSessionId: string,
  ) => TerminalReplHandle | undefined
  getAiTerminalSnapshot?: (
    kind: VscodeAiTerminalKind,
    chatSessionId: string,
  ) => VscodeAgentTerminalSnapshot
  openPlanFile?: (path: string) => Promise<void>
  pickAndOpenFolder?: () => Promise<boolean>
  pickAndOpen?: () => Promise<boolean>
  onCloseWelcome?: () => void
  onCloseSubagentDetail?: (itemId: string) => void
  onOpenSubagentDetail?: (runId: string) => void
}

function pathInWorkspace(workspaceFolder: string | undefined, path: string | undefined): boolean {
  if (!workspaceFolder || !path) return false
  const root = workspaceFolder.replace(/\/+$/, '') || '/'
  return path === root || path.startsWith(`${root}/`)
}

function pathForGroupItem(
  item: VscodeGroupItem,
  tabs: readonly VscodeTab[],
): string | undefined {
  if (item.kind === 'preview') return item.sourcePath
  if (item.kind === 'searchEditor' || item.kind === 'aiChat' || item.kind === 'subagentDetail' || item.kind === 'welcome') return undefined
  return tabs.find((tab) => tab.id === item.tabId)?.path
}

function parseDragPayload(event: DragEvent): VscodeEditorDragPayload | undefined {
  const raw = event.dataTransfer?.getData(VSCODE_EDITOR_DRAG_MIME)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as VscodeEditorDragPayload
      if (typeof parsed.itemId === 'string' && typeof parsed.fromGroupId === 'string') {
        return parsed
      }
    } catch {
      // ignore
    }
  }
  return getActiveEditorDrag()
}

function isEditorTabDrag(event: DragEvent): boolean {
  if (getActiveEditorDrag()) return true
  return [...(event.dataTransfer?.types ?? [])].includes(VSCODE_EDITOR_DRAG_MIME)
}

function dropZoneFromPoint(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): VscodeSplitEdge | undefined {
  const x = (clientX - rect.left) / rect.width
  const y = (clientY - rect.top) / rect.height
  const edge = 0.22
  if (x < edge) return 'left'
  if (x > 1 - edge) return 'right'
  if (y < edge) return 'top'
  if (y > 1 - edge) return 'bottom'
  return undefined
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.5C4.5 2.5 1.7 4.8.5 8c1.2 3.2 4 5.5 7.5 5.5s6.3-2.3 7.5-5.5C14.3 4.8 11.5 2.5 8 2.5ZM8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
    </svg>
  )
}

type GroupViewProps = Omit<VscodeEditorAreaProps, 'onSetBranchRatio' | 'onOpenMarkdownPreview'> & {
  group: VscodeEditorGroupState
  focused: boolean
  onOpenMarkdownPreview: (groupId: string) => void
}

function VscodeEditorGroupView({
  layout,
  group,
  focused,
  tabs,
  loading,
  dialogBlocked,
  isActiveWindow,
  prefs,
  revealPosition,
  onRevealPositionApplied,
  onFocusGroup,
  onActivateItem,
  onCloseFileTab,
  onClosePreview,
  onCloseOtherInGroup,
  onRevealInExplorer,
  onOpenInFiles,
  workspaceFolder,
  onMoveItemToGroup,
  onSplitItemToEdge,
  onOpenMarkdownPreview,
  inlinePreviewTabIds,
  onToggleInlinePreview,
  onTabTextChange,
  onCursorChange,
  onSelectionChange,
  onOpenPath,
  onResolveConflict,
  onConfirmBinaryPrompt,
  searchEditorSessions,
  onCloseSearchEditor,
  onSearchEditorOpenHit,
  onSearchEditorContextLinesChange,
  aiChatSessions,
  aiChatBusySessionIds,
  closedAiChats,
  onNewAiChat,
  onRestoreAiChat,
  onCloseAiChat,
  onAiChatMessagesChange,
  onAiChatBusyChange,
  onAiChatLastSentTerminalChange,
  aiMode,
  onAiModeChange,
  aiModelSource,
  aiModelKey,
  onAiModelSelectionChange,
  aiModelOptions,
  onAiModelOptionsChange,
  subAgentsEnabled,
  subAgentsMaxConcurrent,
  subAgentBuiltinOverrides,
  customSubAgents,
  aiIdleRetryCount,
  aiDebugSystemReminder,
  aiDark,
  getAiContext,
  problems,
  getNpmLastChangesSlot,
  getLastChangeSourceSlot,
  onTerminalChangesAvailable,
  ensureAiTerminal,
  getAiTerminalHandle,
  getAiTerminalSnapshot,
  openPlanFile,
  pickAndOpenFolder,
  pickAndOpen,
  onCloseWelcome,
  onCloseSubagentDetail,
  onOpenSubagentDetail,
}: GroupViewProps) {
  const { showIconContextMenu } = useIconContextMenu()
  const [dropZone, setDropZone] = useState<DropZone | undefined>(undefined)
  const [tabBarHot, setTabBarHot] = useState(false)
  const [hoverTabId, setHoverTabId] = useState<string | undefined>(undefined)
  const [peekTabId, setPeekTabId] = useState<string | undefined>(undefined)
  const [tabsCrowded, setTabsCrowded] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const tabsRowRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const visualsRef = useRef(new Map<string, TabVisualSnapshot>())
  const initialItemIdsRef = useRef<Set<string> | undefined>(undefined)
  if (initialItemIdsRef.current === undefined) {
    initialItemIdsRef.current = new Set(group.items.map((item) => item.id))
  }
  const peekPointerIdRef = useRef<number | undefined>(undefined)

  for (const item of group.items) {
    visualsRef.current.set(item.id, computeTabSnapshot(item, tabs, aiChatSessions))
  }

  const [displayTabs, setDisplayTabs] = useState<DisplayTab[]>(() =>
    group.items.map((item) => ({
      item,
      exiting: false,
      snapshot: computeTabSnapshot(item, tabs, aiChatSessions),
    })),
  )

  // 仅在标签结构变化时同步 displayTabs。
  // 不要依赖 aiChatSessions：流式输出会频繁更新 session，重建列表会干扰点击切换。
  useLayoutEffect(() => {
    const reducedMotion = prefersReducedMotion()
    setDisplayTabs((prev) => {
      const nextIds = new Set(group.items.map((item) => item.id))
      const exitingEntries: DisplayTab[] = []

      for (const entry of prev) {
        if (nextIds.has(entry.item.id)) continue
        if (itemExistsInLayout(layout, entry.item.id)) {
          visualsRef.current.delete(entry.item.id)
          continue
        }
        if (entry.exiting) {
          exitingEntries.push(entry)
          continue
        }
        if (reducedMotion) {
          visualsRef.current.delete(entry.item.id)
          continue
        }
        exitingEntries.push({
          item: entry.item,
          exiting: true,
          snapshot: visualsRef.current.get(entry.item.id) ?? entry.snapshot,
        })
      }

      const result: DisplayTab[] = group.items.map((item) => ({
        item,
        exiting: false,
        snapshot:
          visualsRef.current.get(item.id) ?? computeTabSnapshot(item, tabs, aiChatSessions),
      }))

      for (const entry of exitingEntries) {
        const oldIndex = prev.findIndex((item) => item.item.id === entry.item.id)
        const insertAt = Math.min(Math.max(oldIndex, 0), result.length)
        result.splice(insertAt, 0, entry)
      }

      return result
    })
  }, [group.items, layout, tabs])

  const clearPeek = useCallback(() => {
    peekPointerIdRef.current = undefined
    setPeekTabId(undefined)
  }, [])

  useLayoutEffect(() => {
    const tabsEl = tabsRef.current
    if (!tabsEl) return

    const update = () => {
      setTabsCrowded(measureTabsCrowded(tabsEl))
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(tabsEl)
    return () => observer.disconnect()
  }, [displayTabs])

  const finishTabExit = useCallback((itemId: string) => {
    setDisplayTabs((prev) => prev.filter((entry) => entry.item.id !== itemId))
    visualsRef.current.delete(itemId)
  }, [])

  const activeItem = getGroupActiveItem(group)
  const activeFileTab =
    activeItem?.kind === 'file'
      ? tabs.find((tab) => tab.id === activeItem.tabId)
      : undefined
  const previewSourceTab =
    activeItem?.kind === 'preview'
      ? tabs.find((tab) => tab.path === activeItem.sourcePath)
      : undefined

  const showPreviewAction = activeFileTab ? isPreviewableTab(activeFileTab) : false
  const inlinePreviewOpen =
    activeFileTab !== undefined && inlinePreviewTabIds?.has(activeFileTab.id) === true
  const expandedTabId = tabsCrowded ? peekTabId ?? hoverTabId ?? activeItem?.id : undefined

  const openTabContextMenu = useCallback(
    (event: MouseEvent, item: VscodeGroupItem) => {
      event.preventDefault()
      event.stopPropagation()
      onFocusGroup(group.id)
      onActivateItem(group.id, item.id)
      const otherCount = group.items.filter((entry) => entry.id !== item.id).length
      const itemPath = pathForGroupItem(item, tabs)
      const canReveal = pathInWorkspace(workspaceFolder, itemPath)
      const canOpenInFiles = itemPath !== undefined && parseFilesAbsolutePath(itemPath) !== undefined
      const copyToClipboard = (text: string) => {
        void navigator.clipboard.writeText(text).catch(() => {
          // clipboard unavailable
        })
      }
      showIconContextMenu(event, [
        {
          type: 'action',
          label: '关闭',
          disabled: loading || dialogBlocked || (item.kind === 'welcome' && group.items.length <= 1),
          onClick: () => {
            if (item.kind === 'file') onCloseFileTab(item.tabId)
            else if (item.kind === 'searchEditor') onCloseSearchEditor?.(item.id)
            else if (item.kind === 'aiChat') onCloseAiChat?.(item.id)
            else if (item.kind === 'subagentDetail') onCloseSubagentDetail?.(item.id)
            else if (item.kind === 'welcome') onCloseWelcome?.()
            else onClosePreview(item.id)
          },
        },
        {
          type: 'action',
          label: '关闭其他',
          disabled: loading || dialogBlocked || otherCount === 0,
          onClick: () => onCloseOtherInGroup(group.id, item.id),
        },
        { type: 'separator' },
        {
          type: 'action',
          label: '复制路径',
          disabled: !itemPath,
          onClick: () => {
            if (itemPath) copyToClipboard(itemPath)
          },
        },
        {
          type: 'action',
          label: '复制相对路径',
          disabled: !canReveal || !itemPath || !workspaceFolder,
          onClick: () => {
            if (!itemPath || !workspaceFolder) return
            copyToClipboard(relativeToWorkspace(workspaceFolder, itemPath))
          },
        },
        { type: 'separator' },
        {
          type: 'action',
          label: '在工作区列表显示',
          disabled: !canReveal,
          onClick: () => {
            if (itemPath) onRevealInExplorer(itemPath)
          },
        },
        {
          type: 'action',
          label: '在文件中显示',
          disabled: !canOpenInFiles,
          onClick: () => {
            if (itemPath) onOpenInFiles(itemPath)
          },
        },
      ])
    },
    [
      dialogBlocked,
      group,
      loading,
      onActivateItem,
      onCloseFileTab,
      onCloseOtherInGroup,
      onClosePreview,
      onCloseSearchEditor,
      onCloseAiChat,
      onFocusGroup,
      onOpenInFiles,
      onRevealInExplorer,
      showIconContextMenu,
      tabs,
      workspaceFolder,
    ],
  )

  const clearDropZone = useCallback(() => setDropZone(undefined), [])

  useEffect(() => {
    const clearDragVisuals = () => {
      setTabBarHot(false)
      setDropZone(undefined)
      setActiveEditorDrag(undefined)
    }
    window.addEventListener('dragend', clearDragVisuals)
    return () => {
      window.removeEventListener('dragend', clearDragVisuals)
    }
  }, [])

  const onDragOverBody = useCallback(
    (event: DragEvent) => {
      if (!isEditorTabDrag(event)) return
      // 必须拦截，否则 Monaco 会把拖拽内容当正文插入
      event.preventDefault()
      event.stopPropagation()
      setTabBarHot(false)

      const drag = getActiveEditorDrag()
      const rect = bodyRef.current?.getBoundingClientRect()
      if (!rect) {
        event.dataTransfer!.dropEffect = 'none'
        setDropZone(undefined)
        return
      }

      const zone = dropZoneFromPoint(event.clientX, event.clientY, rect)
      const pointlessSelf =
        !!drag && drag.fromGroupId === group.id && group.items.length <= 1
      if (!zone || pointlessSelf) {
        event.dataTransfer!.dropEffect = 'none'
        setDropZone(undefined)
        return
      }

      event.dataTransfer!.dropEffect = 'move'
      setDropZone(zone)
    },
    [group.id, group.items.length],
  )

  const onDropBody = useCallback(
    (event: DragEvent) => {
      if (!isEditorTabDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      const payload = parseDragPayload(event)
      const rect = bodyRef.current?.getBoundingClientRect()
      clearDropZone()
      setTabBarHot(false)
      if (!payload || !rect) return
      if (payload.fromGroupId === group.id && group.items.length <= 1) return
      const zone = dropZoneFromPoint(event.clientX, event.clientY, rect)
      if (!zone) return
      onSplitItemToEdge(payload.itemId, group.id, zone)
    },
    [clearDropZone, group.id, group.items.length, onSplitItemToEdge],
  )

  const onDragOverTabBar = useCallback(
    (event: DragEvent) => {
      if (!isEditorTabDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      clearDropZone()
      const drag = getActiveEditorDrag()
      if (!drag || drag.fromGroupId === group.id) {
        event.dataTransfer!.dropEffect = 'none'
        setTabBarHot(false)
        return
      }
      event.dataTransfer!.dropEffect = 'move'
      setTabBarHot(true)
    },
    [clearDropZone, group.id],
  )

  const onDragLeaveTabBar = useCallback((event: DragEvent) => {
    const current = tabsRowRef.current
    const related = event.relatedTarget
    if (current && related instanceof Node && current.contains(related)) return
    setTabBarHot(false)
  }, [])

  const onDropTabBar = useCallback(
    (event: DragEvent) => {
      if (!isEditorTabDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      setTabBarHot(false)
      clearDropZone()
      const payload = parseDragPayload(event)
      if (!payload || payload.fromGroupId === group.id) return
      onMoveItemToGroup(payload.itemId, group.id)
    },
    [clearDropZone, group.id, onMoveItemToGroup],
  )

  return (
    <div
      class={`vscode__editor-group${focused ? ' vscode__editor-group--focused' : ''}`}
      onMouseDown={() => onFocusGroup(group.id)}
    >
      <div
        ref={tabsRowRef}
        class={`vscode__tabs-row${tabBarHot ? ' vscode__tabs-row--drop-target' : ''}`}
        onDragOver={onDragOverTabBar}
        onDragLeave={onDragLeaveTabBar}
        onDrop={onDropTabBar}
        onPointerUp={(event) => {
          if (peekPointerIdRef.current === event.pointerId) clearPeek()
        }}
        onPointerCancel={clearPeek}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') return
          const row = tabsRowRef.current
          if (!row) return
          const next = event.relatedTarget
          if (next instanceof Node && row.contains(next)) return
          clearPeek()
        }}
      >
        <div
          ref={tabsRef}
          class="vscode__tabs"
          role="tablist"
          aria-label="编辑器标签"
          onMouseLeave={(event) => {
            const tabs = event.currentTarget
            const next = event.relatedTarget
            if (next instanceof Node && tabs.contains(next)) return
            setHoverTabId(undefined)
          }}
        >
          {displayTabs.map((entry) => (
            <EditorTabChip
              key={entry.item.id}
              item={entry.item}
              groupId={group.id}
              active={!entry.exiting && entry.item.id === activeItem?.id}
              snapshot={
                entry.exiting
                  ? entry.snapshot
                  : (visualsRef.current.get(entry.item.id) ?? entry.snapshot)
              }
              loading={
                entry.item.kind === 'aiChat' &&
                aiChatBusySessionIds?.has(entry.item.sessionId) === true
              }
              disabled={loading || dialogBlocked || entry.exiting}
              enter={!entry.exiting && !initialItemIdsRef.current!.has(entry.item.id)}
              exiting={entry.exiting}
              expanded={!entry.exiting && expandedTabId === entry.item.id}
              closable={!(entry.item.kind === 'welcome' && group.items.length <= 1)}
              onActivate={() => {
                if (entry.exiting) return
                onActivateItem(group.id, entry.item.id)
              }}
              onClose={() => {
                if (entry.exiting) return
                if (entry.item.kind === 'file') onCloseFileTab(entry.item.tabId)
                else if (entry.item.kind === 'searchEditor') onCloseSearchEditor?.(entry.item.id)
                else if (entry.item.kind === 'aiChat') onCloseAiChat?.(entry.item.id)
                else if (entry.item.kind === 'subagentDetail') onCloseSubagentDetail?.(entry.item.id)
                else if (entry.item.kind === 'welcome') onCloseWelcome?.()
                else onClosePreview(entry.item.id)
              }}
              onExitComplete={() => finishTabExit(entry.item.id)}
              onContextMenu={(event) => {
                if (entry.exiting) return
                openTabContextMenu(event, entry.item)
              }}
              onMouseEnter={() => {
                if (entry.exiting) return
                setHoverTabId(entry.item.id)
              }}
              onPeekStart={(event) => {
                if (entry.exiting || event.pointerType === 'mouse') return
                if ((event.target as HTMLElement).closest('.vscode__tab-close')) return
                peekPointerIdRef.current = event.pointerId
                setPeekTabId(entry.item.id)
              }}
              onPeekEnd={clearPeek}
            />
          ))}
        </div>
            {showPreviewAction || onNewAiChat ? (
          <div class="vscode__tab-actions">
            {onNewAiChat ? (
              <button
                type="button"
                class="vscode__tab-action"
                title="新建 AI 对话"
                aria-label="新建 AI 对话"
                disabled={loading || dialogBlocked}
                onClick={() => onNewAiChat()}
              >
                <PlusIcon />
              </button>
            ) : undefined}
            {onNewAiChat ? (
              <button
                type="button"
                class="vscode__tab-action"
                title="已关闭的对话"
                aria-label="已关闭的对话"
                disabled={loading || dialogBlocked}
                onClick={(event) => {
                  const items =
                    closedAiChats && closedAiChats.length > 0
                      ? closedAiChats.map((session) => ({
                          type: 'action' as const,
                          label: session.title,
                          onClick: () => onRestoreAiChat?.(session.id),
                        }))
                      : [
                          {
                            type: 'action' as const,
                            label: '暂无已关闭的对话',
                            disabled: true,
                            onClick: () => undefined,
                          },
                        ]
                  showIconContextMenu(event, items)
                }}
              >
                <HistoryIcon />
              </button>
            ) : undefined}
            <div
              class={`vscode__tab-action-slot${showPreviewAction ? ' vscode__tab-action-slot--open' : ''}`}
              aria-hidden={showPreviewAction ? undefined : true}
            >
              <button
                type="button"
                class="vscode__tab-action"
                title="在侧边打开预览"
                aria-label="在侧边打开预览"
                disabled={loading || dialogBlocked || !showPreviewAction}
                onClick={() => onOpenMarkdownPreview(group.id)}
              >
                <EyeIcon />
              </button>
            </div>
          </div>
        ) : undefined}
      </div>

      <div
        ref={bodyRef}
        class="vscode__editor vscode__editor--drop-target"
        onDragOverCapture={onDragOverBody}
        onDragLeave={clearDropZone}
        onDropCapture={onDropBody}
      >
        {dropZone ? (
          <div
            class={`vscode__drop-zone vscode__drop-zone--${dropZone}`}
            aria-hidden="true"
          />
        ) : undefined}

        {(() => {
          // AI 对话 keep-alive：切到文件等其它 tab 时隐藏而不卸载，避免流式输出丢失
          const aiChatItems = group.items.filter(
            (item): item is Extract<VscodeGroupItem, { kind: 'aiChat' }> =>
              item.kind === 'aiChat',
          )
          const activeAiItemId =
            activeItem?.kind === 'aiChat' ? activeItem.id : undefined
          if (
            !getAiContext ||
            !ensureAiTerminal ||
            !getAiTerminalHandle ||
            !getAiTerminalSnapshot ||
            !openPlanFile ||
            !aiMode ||
            !onAiModeChange
          ) {
            if (activeAiItemId) {
              return <div class="vscode__group-empty">对话已关闭</div>
            }
            return undefined
          }
          const resolvedAiMode = aiMode
          const resolvedOnAiModeChange = onAiModeChange
          const resolvedGetAiContext = getAiContext
          const resolvedEnsureAiTerminal = ensureAiTerminal
          const resolvedGetAiTerminalHandle = getAiTerminalHandle
          const resolvedGetAiTerminalSnapshot = getAiTerminalSnapshot
          const resolvedOpenPlanFile = openPlanFile

          return aiChatItems.map((item) => {
            const session = aiChatSessions?.get(item.sessionId)
            const isActive = item.id === activeAiItemId
            if (!session) {
              if (!isActive) return undefined
              return (
                <div key={item.id} class="vscode__group-empty">
                  对话已关闭
                </div>
              )
            }
            return (
              <div
                key={session.id}
                class={`vscode__ai-chat-body${isActive ? '' : ' vscode__ai-chat-body--hidden'}`}
                hidden={!isActive}
              >
                <VscodeAiPanel
                  sessionId={session.id}
                  messages={session.messages}
                  apiTranscript={session.apiTranscript}
                  onMessagesChange={(next, extras) =>
                    onAiChatMessagesChange?.(session.id, next, extras)
                  }
                  mode={resolvedAiMode}
                  onModeChange={resolvedOnAiModeChange}
                  aiModelSource={aiModelSource ?? 'text'}
                  aiModelKey={aiModelKey}
                  onAiModelSelectionChange={(source, modelKey) =>
                    onAiModelSelectionChange?.(source, modelKey)
                  }
                  aiModelOptions={aiModelOptions ?? {}}
                  onAiModelOptionsChange={(next) => onAiModelOptionsChange?.(next)}
                  subAgentsEnabled={subAgentsEnabled}
                  subAgentsMaxConcurrent={subAgentsMaxConcurrent}
                  subAgentBuiltinOverrides={subAgentBuiltinOverrides}
                  customSubAgents={customSubAgents}
                  aiIdleRetryCount={aiIdleRetryCount}
                  aiDebugSystemReminder={aiDebugSystemReminder}
                  dark={aiDark}
                  workspaceFolder={workspaceFolder}
                  lastSentTerminal={session.lastSentTerminal}
                  onLastSentTerminalChange={(value) =>
                    onAiChatLastSentTerminalChange?.(session.id, value)
                  }
                  getContext={resolvedGetAiContext}
                  problems={problems ?? []}
                  getNpmLastChangesSlot={
                    getNpmLastChangesSlot ?? (() => ({ current: undefined }))
                  }
                  getLastChangeSourceSlot={
                    getLastChangeSourceSlot ?? (() => ({ current: undefined }))
                  }
                  onChangesAvailable={onTerminalChangesAvailable}
                  ensureAiTerminal={resolvedEnsureAiTerminal}
                  getAiTerminalHandle={resolvedGetAiTerminalHandle}
                  getAiTerminalSnapshot={resolvedGetAiTerminalSnapshot}
                  openPlanFile={resolvedOpenPlanFile}
                  onBusyChange={(busy) => onAiChatBusyChange?.(session.id, busy)}
                  onOpenPath={(path) => void onOpenPath(path)}
                  onOpenSubagentDetail={onOpenSubagentDetail}
                />
              </div>
            )
          })
        })()}

        {activeItem?.kind === 'aiChat' ? undefined : activeItem?.kind === 'preview' ? (
          <div class="vscode__preview-body">
            <VscodeMarkdownPreview text={previewSourceTab?.text ?? ''} />
          </div>
        ) : activeItem?.kind === 'searchEditor' ? (
          (() => {
            const session = searchEditorSessions?.get(activeItem.sessionId)
            if (!session) {
              return <div class="vscode__group-empty">搜索结果已关闭</div>
            }
            return (
              <VscodeSearchEditor
                session={session}
                onOpenHit={(hit) => onSearchEditorOpenHit?.(hit)}
                onContextLinesChange={(lines) =>
                  onSearchEditorContextLinesChange?.(activeItem.sessionId, lines)
                }
              />
            )
          })()
        ) : activeItem?.kind === 'subagentDetail' ? (
          <div class="vscode__subagent-detail-wrapper">
            <VscodeSubagentPanel
              runId={activeItem.runId}
              getContext={getAiContext ?? (() => ({
                workspaceFolder,
                tabs: [],
                activeTabId: undefined,
                editor: { activePath: undefined, cursorLine: 0, cursorColumn: 0, selectionText: undefined },
                problems: [],
              }))}
              aiModelSource={aiModelSource}
              aiModelKey={aiModelKey}
              dark={aiDark}
              workspaceFolder={workspaceFolder}
            />
          </div>
        ) : activeItem?.kind === 'welcome' ? (
          <div class="vscode__welcome">
            <h1>Virtual Studio Code Desktop</h1>
            <p>
              {workspaceFolder
                ? '从左侧文件夹列表打开文件，或使用菜单「文件 → 打开…」。'
                : '打开一个文件夹作为工作区，或直接打开单个文件。'}
            </p>
            <div class="vscode__welcome-actions">
              <button
                type="button"
                class="vscode__welcome-btn"
                onClick={() => void pickAndOpenFolder?.()}
              >
                打开文件夹
              </button>
              <button
                type="button"
                class="vscode__welcome-btn vscode__welcome-btn--secondary"
                onClick={() => void pickAndOpen?.()}
              >
                打开文件
              </button>
              {onNewAiChat ? (
                <button
                  type="button"
                  class="vscode__welcome-btn vscode__welcome-btn--secondary"
                  onClick={() => onNewAiChat()}
                >
                  打开 AI 对话
                </button>
              ) : undefined}
            </div>
          </div>
        ) : activeFileTab ? (
          activeFileTab.binaryPrompt ? (
            <div class="vscode__binary-prompt" role="status">
              <div class="vscode__binary-prompt-card">
                <p class="vscode__binary-prompt-title">二进制文件</p>
                <p class="vscode__binary-prompt-text">
                  此文件是二进制文件或使用了不受支持的文本编码，因此未在文本编辑器中显示。
                </p>
                <div class="vscode__binary-prompt-actions">
                  <button
                    type="button"
                    class="vscode__binary-prompt-btn"
                    onClick={() => onConfirmBinaryPrompt(activeFileTab.id)}
                  >
                    以文本打开
                  </button>
                </div>
              </div>
            </div>
          ) : (
          <>
            {activeFileTab.conflict ? (
              <div class="vscode__conflict-banner" role="alertdialog" aria-label="内容冲突">
                <p class="vscode__conflict-banner-text">
                  未保存内容与磁盘上的文件不一致。当前编辑器显示的是未保存版本。
                </p>
                <div class="vscode__conflict-banner-actions">
                  <button
                    type="button"
                    class="vscode__conflict-banner-btn vscode__conflict-banner-btn--primary"
                    onClick={() => onResolveConflict(activeFileTab.id, 'draft')}
                  >
                    保留未保存的内容
                  </button>
                  <button
                    type="button"
                    class="vscode__conflict-banner-btn"
                    onClick={() => onResolveConflict(activeFileTab.id, 'disk')}
                  >
                    使用磁盘上的内容
                  </button>
                </div>
              </div>
            ) : activeFileTab.deleted ? (
              <div class="vscode__deleted-banner" role="status">
                此文件已从磁盘删除，保存将重新创建。
              </div>
            ) : undefined}
            <div
              class={`vscode__monaco-wrap${inlinePreviewOpen ? ' vscode__monaco-wrap--hidden' : ''}`}
              hidden={inlinePreviewOpen}
            >
              <MonacoEditor
                className="vscode__monaco"
                value={activeFileTab.text}
                onChange={(text) => onTabTextChange(activeFileTab.id, text)}
                language={activeFileTab.language}
                modelPath={activeFileTab.path}
                theme={prefs.theme}
                readOnly={!activeFileTab.writable}
                fontSize={prefs.fontSize}
                minimap={prefs.minimap}
                wordWrap={prefs.wordWrap ? 'on' : 'off'}
                active={isActiveWindow && focused && !inlinePreviewOpen}
                onCursorChange={onCursorChange}
                onSelectionChange={onSelectionChange}
                onOpenPath={onOpenPath}
                revealPosition={
                  revealPosition && revealPosition.path === activeFileTab.path
                    ? { line: revealPosition.line, column: revealPosition.column }
                    : undefined
                }
                onRevealPositionApplied={onRevealPositionApplied}
                completionEnabled={prefs.completionEnabled === true}
                completionDebounceMs={prefs.completionDebounceMs}
                completionModelKey={prefs.completionModelKey}
              />
            </div>
            {inlinePreviewOpen ? (
              <div class="vscode__preview-body">
                <VscodeMarkdownPreview text={activeFileTab.text} />
              </div>
            ) : undefined}
            {isPreviewableTab(activeFileTab) ? (
              <div class="vscode__preview-footer" role="toolbar" aria-label="Markdown 预览">
                <button
                  type="button"
                  class={`vscode__preview-footer-seg${!inlinePreviewOpen ? ' vscode__preview-footer-seg--active' : ''}`}
                  aria-pressed={!inlinePreviewOpen}
                  onClick={() => onToggleInlinePreview?.(activeFileTab.id, false)}
                >
                  编辑
                </button>
                <button
                  type="button"
                  class={`vscode__preview-footer-seg${inlinePreviewOpen ? ' vscode__preview-footer-seg--active' : ''}`}
                  aria-pressed={inlinePreviewOpen}
                  onClick={() => onToggleInlinePreview?.(activeFileTab.id, true)}
                >
                  预览
                </button>
              </div>
            ) : undefined}
          </>
          )
        ) : (
          <div class="vscode__group-empty">将标签拖到此处</div>
        )}
      </div>
    </div>
  )
}

type TabChipProps = {
  item: VscodeGroupItem
  groupId: string
  active: boolean
  snapshot: TabVisualSnapshot
  loading?: boolean
  disabled: boolean
  enter?: boolean
  exiting?: boolean
  expanded?: boolean
  closable?: boolean
  onActivate: () => void
  onClose: () => void
  onExitComplete: () => void
  onContextMenu: (event: MouseEvent) => void
  onMouseEnter: () => void
  onPeekStart: (event: PointerEvent) => void
  onPeekEnd: () => void
}

function EditorTabChip({
  item,
  groupId,
  active,
  snapshot,
  loading = false,
  disabled,
  enter = false,
  exiting = false,
  expanded = false,
  closable = true,
  onActivate,
  onClose,
  onExitComplete,
  onContextMenu,
  onMouseEnter,
  onPeekStart,
  onPeekEnd,
}: TabChipProps) {
  const tabRef = useRef<HTMLDivElement>(null)
  const [entering, setEntering] = useState(enter && !exiting)
  const [enterActive, setEnterActive] = useState(false)
  const [exitActive, setExitActive] = useState(false)
  const { title, pathTitle, dirty, deleted, conflict } = snapshot

  useLayoutEffect(() => {
    if (!entering) return
    if (prefersReducedMotion()) {
      setEnterActive(true)
      setEntering(false)
      return
    }
    const frame = window.requestAnimationFrame(() => setEnterActive(true))
    return () => window.cancelAnimationFrame(frame)
  }, [entering])

  useLayoutEffect(() => {
    if (!exiting) {
      setExitActive(false)
      return
    }
    if (prefersReducedMotion()) {
      onExitComplete()
      return
    }
    const frame = window.requestAnimationFrame(() => setExitActive(true))
    return () => window.cancelAnimationFrame(frame)
  }, [exiting, onExitComplete])

  useEffect(() => {
    if (!enterActive || !entering) return
    const node = tabRef.current
    if (!node) {
      setEntering(false)
      setEnterActive(false)
      return
    }
    if (prefersReducedMotion()) {
      setEntering(false)
      setEnterActive(false)
      return
    }
    return listenTabFlexTransition(node, () => {
      setEntering(false)
      setEnterActive(false)
    })
  }, [enterActive, entering])

  useEffect(() => {
    if (!exitActive || !exiting) return
    const node = tabRef.current
    if (!node) {
      onExitComplete()
      return
    }
    return listenTabFlexTransition(node, onExitComplete)
  }, [exitActive, exiting, onExitComplete])

  useEffect(() => {
    if (!active || exiting) return
    const frame = window.requestAnimationFrame(() => {
      tabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [active, exiting])

  return (
    <div
      ref={tabRef}
      class={`vscode__tab${active ? ' vscode__tab--active' : ''}${dirty ? ' vscode__tab--dirty' : ''}${deleted ? ' vscode__tab--deleted' : ''}${conflict ? ' vscode__tab--conflict' : ''}${entering ? ' vscode__tab--enter' : ''}${entering && enterActive ? ' vscode__tab--enter-active' : ''}${exiting ? ' vscode__tab--exit' : ''}${exiting && exitActive ? ' vscode__tab--exit-active' : ''}${expanded && !entering ? ' vscode__tab--expanded' : ''}`}
      role="tab"
      aria-selected={active}
      aria-hidden={exiting ? true : undefined}
      draggable={!exiting && item.kind !== 'welcome'}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onPointerDown={onPeekStart}
      onDragStart={(event) => {
        if (exiting || (event.target as HTMLElement).closest('.vscode__tab-close')) {
          event.preventDefault()
          return
        }
        onPeekEnd()
        const payload: VscodeEditorDragPayload = { itemId: item.id, fromGroupId: groupId }
        setActiveEditorDrag(payload)
        event.dataTransfer?.setData(VSCODE_EDITOR_DRAG_MIME, JSON.stringify(payload))
        event.dataTransfer!.effectAllowed = 'move'
      }}
      onDragEnd={() => {
        setActiveEditorDrag(undefined)
      }}
    >
      {closable ? (
        <button
          type="button"
          class="vscode__tab-close"
          aria-label={`关闭 ${title}`}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
        >
          ×
        </button>
      ) : undefined}
      <button
        type="button"
        class={`vscode__tab-main${loading ? ' vscode__tab-main--loading' : ''}`}
        title={pathTitle}
        onClick={onActivate}
      >
        {dirty ? <span class="vscode__tab-dot" aria-hidden="true" /> : undefined}
        <span class="vscode__tab-title">{title}</span>
        {loading ? (
          <span class="vscode__tab-spinner" aria-label="正在运行" title="Agent 正在运行" />
        ) : undefined}
      </button>
    </div>
  )
}

type LayoutNodeViewProps = VscodeEditorAreaProps & {
  node: VscodeLayoutNode
}

function LayoutNodeView({ node, ...props }: LayoutNodeViewProps) {
  if (node.type === 'leaf') {
    const group = props.layout.groups[node.groupId]
    if (!group) return undefined
    return (
      <VscodeEditorGroupView
        {...props}
        group={group}
        focused={props.layout.focusedGroupId === group.id}
      />
    )
  }

  const flexDirection = node.direction === 'horizontal' ? 'row' : 'column'
  const firstStyle =
    node.direction === 'horizontal'
      ? { width: `${node.ratio * 100}%` }
      : { height: `${node.ratio * 100}%` }
  const secondStyle = { flex: '1 1 0' }

  return (
    <div class="vscode__split-branch" style={{ flexDirection }}>
      <div class="vscode__split-child" style={firstStyle}>
        <LayoutNodeView {...props} node={node.children[0]} />
      </div>
      <SplitSash
        direction={node.direction}
        onRatioChange={(ratio) => props.onSetBranchRatio(node.id, ratio)}
        currentRatio={node.ratio}
      />
      <div class="vscode__split-child" style={secondStyle}>
        <LayoutNodeView {...props} node={node.children[1]} />
      </div>
    </div>
  )
}

type SplitSashProps = {
  direction: 'horizontal' | 'vertical'
  currentRatio: number
  onRatioChange: (ratio: number) => void
}

function SplitSash({ direction, currentRatio, onRatioChange }: SplitSashProps) {
  const dragging = useRef(false)

  const onPointerDown = (event: PointerEvent) => {
    const sash = event.currentTarget as HTMLElement
    const parent = sash.parentElement
    if (!parent) return
    dragging.current = true
    sash.setPointerCapture(event.pointerId)
    const rect = parent.getBoundingClientRect()

    const onMove = (moveEvent: PointerEvent) => {
      if (!dragging.current) return
      const ratio =
        direction === 'horizontal'
          ? (moveEvent.clientX - rect.left) / rect.width
          : (moveEvent.clientY - rect.top) / rect.height
      onRatioChange(ratio)
    }
    const onUp = (upEvent: PointerEvent) => {
      dragging.current = false
      sash.releasePointerCapture(upEvent.pointerId)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // keep currentRatio referenced so lint doesn't complain in some configs
    void currentRatio
  }

  return (
    <div
      class={`vscode__split-sash vscode__split-sash--${direction}`}
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
    />
  )
}

export function VscodeEditorArea(props: VscodeEditorAreaProps) {
  if (!props.layout || Object.keys(props.layout.groups).length === 0) {
    return undefined
  }

  return (
    <div class="vscode__editor-fill">
      <LayoutNodeView {...props} node={props.layout.root} />
    </div>
  )
}
