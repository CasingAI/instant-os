import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { TerminalChangeSet } from '../../terminal/terminal-changeset.ts'
import { isStreamAbortError } from '../../ai/stream-abort.ts'
import { osNowMs } from '../../os/os-clock.ts'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import { VscodeIcon } from '../../icons/app-icons.tsx'
import {
  CHAT_CONTENT_WIDTH_OPTIONS,
  type ChatContentWidth,
} from '../chat-content-width.ts'
import { buildLiveAnswerClassName, HelpMarkdown } from '../help/help-markdown.tsx'
import type { VscodeAiLastChangeSource } from '../vscode/vscode-ai-run-command.ts'
import { buildVscodeAiInvestigationFromTimeline } from '../vscode/vscode-ai-agent.ts'
import type { VscodeAiImageAttachment } from '../vscode/vscode-ai-attachments.ts'
import {
  InvestigationPanel,
  LiveTimeline,
} from '../vscode/vscode-ai-chat-surface.tsx'
import {
  measureVscodeAiContextUsage,
  prepareVscodeAiContextUsage,
  type VscodeAiContextUsage,
} from '../vscode/vscode-ai-context-usage.ts'
import {
  decodeVscodeModelPickerValue,
  encodeVscodeModelPickerValue,
  openAiConfigForVscodeAiModelKey,
  parseVscodeAiModelRefKey,
  resolveVscodeAiModelKey,
  tokenizerFamilyForVscodeAiModelKey,
  useVscodeAiCapabilityTags,
  useVscodeAiTextModels,
} from '../vscode/vscode-ai-models.ts'
import { VscodeAiComposerBlock } from '../vscode/vscode-ai-panel.tsx'
import type { VscodeAiModelOptionPrefs, VscodeModelSource } from '../vscode/vscode-prefs.ts'
import {
  buildProdudeChatHistory,
  buildProdudeContext,
  createProdudeRunCommandHost,
  liveProgressFromAgent,
  runProdudeAgent,
} from './produde-ai-runner.ts'
import { createProdudeAiTools } from './produde-tools.ts'
import type { VscodeAiToolsHost } from '../vscode/vscode-ai-tools.ts'
import {
  createMessage,
  createSession,
  deriveSessionTitle,
  readProdudeStore,
  removeSession,
  upsertSession,
  writeProdudeStore,
} from './produde-storage.ts'
import {
  ProdudeTerminalHost,
  type ProdudeTerminalHostApi,
} from './produde-terminal-host.tsx'
import type {
  ProdudeLiveProgress,
  ProdudeMessage,
  ProdudeSession,
  ProdudeStore,
} from './produde-types.ts'
import { PRODUDE_DEFAULT_WORKSPACE } from './produde-types.ts'
import '../help/help.css'
import '../vscode/vscode-ai.css'
import './produde.css'

const SAMPLE_PROMPTS = [
  '用户目录里有什么？',
  '帮我找一下入口文件',
  '解释一下某个文件在做什么',
  '帮我改一下这段逻辑',
] as const

const CONTEXT_USAGE_DEBOUNCE_MS = 280
const STICK_TO_BOTTOM_THRESHOLD_PX = 64

function menuCheckPrefix(active: boolean): string {
  return active ? '✓ ' : ''
}

function formatProdudeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
  return String(err)
}

function shortWorkspaceLabel(path: string): string {
  const trimmed = path.trim() || PRODUDE_DEFAULT_WORKSPACE
  if (trimmed === PRODUDE_DEFAULT_WORKSPACE) return '用户目录'
  const parts = trimmed.split('/').filter(Boolean)
  if (parts.length <= 2) return trimmed
  return `…/${parts.slice(-2).join('/')}`
}

export function ProdudeApp() {
  const { closeWindowsForApp, minimizeWindow, setAppWindowTitle, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const { showSystemOpenDialog, dialog: openDialog } = useSystemOpenDialog()
  const textModels = useVscodeAiTextModels()
  const capabilityTags = useVscodeAiCapabilityTags()

  const [store, setStore] = useState<ProdudeStore>(() => readProdudeStore())
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [liveProgress, setLiveProgress] = useState<ProdudeLiveProgress | null>(null)
  const [contentWidth, setContentWidth] = useState<ChatContentWidth>('full')
  const [composerInset, setComposerInset] = useState(96)
  const [aiModelOptions, setAiModelOptions] = useState<Record<string, VscodeAiModelOptionPrefs>>(
    {},
  )
  const [composerContextUsage, setComposerContextUsage] = useState<
    VscodeAiContextUsage | undefined
  >(undefined)
  const [attachments, setAttachments] = useState<VscodeAiImageAttachment[]>([])
  const [attachError, setAttachError] = useState<string | undefined>(undefined)

  const terminalApiRef = useRef<ProdudeTerminalHostApi | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const liveProgressRef = useRef<ProdudeLiveProgress | null>(null)
  const streamingRef = useRef(false)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const composerWrapRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const npmSlotsRef = useRef(new Map<string, { current: TerminalChangeSet | undefined }>())
  const lastChangeSlotsRef = useRef(
    new Map<string, { current: VscodeAiLastChangeSource | undefined }>(),
  )
  const turnChangeSessionsRef = useRef<{ current: TerminalChangeSet[] }>({ current: [] })

  const activeSession = useMemo(
    () => store.sessions.find((session) => session.id === store.activeSessionId),
    [store.activeSessionId, store.sessions],
  )

  const workspaceFolder =
    activeSession?.workspaceFolder?.trim() || PRODUDE_DEFAULT_WORKSPACE

  const persistStore = useCallback((next: ProdudeStore) => {
    writeProdudeStore(next)
    setStore(next)
  }, [])

  const patchActiveSession = useCallback(
    (patch: Partial<ProdudeSession>) => {
      if (!activeSession) {
        const session = createSession(patch)
        persistStore({
          sessions: [session, ...store.sessions],
          activeSessionId: session.id,
        })
        return session
      }
      const nextSession = { ...activeSession, ...patch, updatedAt: osNowMs() }
      persistStore(upsertSession(store, nextSession))
      return nextSession
    },
    [activeSession, persistStore, store],
  )

  const selectSession = useCallback(
    (sessionId: string) => {
      persistStore({ ...store, activeSessionId: sessionId })
      setLiveProgress(null)
      liveProgressRef.current = null
      setAttachments([])
      setAttachError(undefined)
      setSidebarOpen(false)
    },
    [persistStore, store],
  )

  const handleNewChat = useCallback(() => {
    const session = createSession({
      workspaceFolder: activeSession?.workspaceFolder ?? PRODUDE_DEFAULT_WORKSPACE,
      modelSource: activeSession?.modelSource ?? 'text',
      modelKey: activeSession?.modelKey,
    })
    persistStore({
      sessions: [session, ...store.sessions],
      activeSessionId: session.id,
    })
    setDraft('')
    setLiveProgress(null)
    liveProgressRef.current = null
    setAttachments([])
    setAttachError(undefined)
  }, [activeSession, persistStore, store.sessions])

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      persistStore(removeSession(store, sessionId))
      setLiveProgress(null)
      liveProgressRef.current = null
    },
    [persistStore, store],
  )

  const scrollToBottom = useCallback((force = false) => {
    const node = chatScrollRef.current
    if (!node) return
    if (!force && !stickToBottomRef.current) return
    stickToBottomRef.current = true
    // 直接滚到最大位置：容器 padding-bottom 会留出悬浮输入框的高度
    node.scrollTop = node.scrollHeight
  }, [])

  const onChatScroll = useCallback(() => {
    const node = chatScrollRef.current
    if (!node) return
    const distanceFromBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight
    stickToBottomRef.current = distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX
  }, [])

  const handlePickWorkspace = useCallback(async () => {
    const path = await showSystemOpenDialog({
      title: '选择工作区文件夹',
      selectionMode: 'folder',
    })
    if (!path) return
    patchActiveSession({ workspaceFolder: path })
  }, [patchActiveSession, showSystemOpenDialog])

  const resolvedModelKey = useMemo(
    () =>
      resolveVscodeAiModelKey({
        aiModelSource: (activeSession?.modelSource ?? 'text') as VscodeModelSource,
        aiModelKey: activeSession?.modelKey,
      }),
    [activeSession?.modelKey, activeSession?.modelSource],
  )

  const modelSelectValue = useMemo(() => {
    const source = (activeSession?.modelSource ?? 'text') as VscodeModelSource
    return encodeVscodeModelPickerValue(source, activeSession?.modelKey)
  }, [activeSession?.modelKey, activeSession?.modelSource])

  const resolvedModelId = useMemo(
    () => openAiConfigForVscodeAiModelKey(resolvedModelKey).defaultModel,
    [resolvedModelKey],
  )
  const resolvedProviderEntryId = useMemo(
    () => parseVscodeAiModelRefKey(resolvedModelKey ?? '')?.providerEntryId,
    [resolvedModelKey],
  )
  const resolvedTokenizerFamily = useMemo(
    () => tokenizerFamilyForVscodeAiModelKey(resolvedModelKey),
    [resolvedModelKey],
  )

  const handleModelPickerChange = useCallback(
    (encoded: string) => {
      const decoded = decodeVscodeModelPickerValue(encoded)
      if (decoded.source === 'text' || decoded.source === 'text-secondary') {
        patchActiveSession({ modelSource: decoded.source, modelKey: undefined })
        return
      }
      patchActiveSession({
        modelSource: 'custom',
        modelKey: decoded.modelKey,
      })
    },
    [patchActiveSession],
  )

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const sendMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim()
      if ((!text && attachments.length === 0) || streaming) return

      let session = activeSession
      if (!session) {
        session = createSession()
        persistStore({
          sessions: [session, ...store.sessions],
          activeSessionId: session.id,
        })
      }

      const workspace = session.workspaceFolder?.trim() || PRODUDE_DEFAULT_WORKSPACE
      const api = terminalApiRef.current
      if (!api) {
        const errorMessage = createMessage('assistant', '终端宿主尚未就绪，请稍后重试', {
          isError: true,
        })
        const pending = createMessage('user', text || '（附件）')
        const finalMessages = [...session.messages, pending, errorMessage]
        persistStore(
          upsertSession(
            { ...store, activeSessionId: session.id },
            {
              ...session,
              workspaceFolder: workspace,
              messages: finalMessages,
              title: deriveSessionTitle(finalMessages),
              updatedAt: osNowMs(),
            },
          ),
        )
        return
      }

      const turnAttachments = attachments
      setDraft('')
      setAttachments([])
      setAttachError(undefined)

      const userMessage = createMessage('user', text || '（见附件）')
      const pendingMessages: ProdudeMessage[] = [...session.messages, userMessage]
      const pendingSession: ProdudeSession = {
        ...session,
        workspaceFolder: workspace,
        messages: pendingMessages,
        title: deriveSessionTitle(pendingMessages),
        updatedAt: osNowMs(),
      }
      persistStore(upsertSession(store, { ...pendingSession, id: session.id }))
      setStreaming(true)
      streamingRef.current = true
      // 用户主动发送：强制贴底并恢复跟滚
      scrollToBottom(true)
      const emptyLive: ProdudeLiveProgress = { timeline: [], answerText: '' }
      setLiveProgress(emptyLive)
      liveProgressRef.current = emptyLive

      const controller = new AbortController()
      abortRef.current = controller

      const npmSlot =
        npmSlotsRef.current.get(session.id) ??
        (() => {
          const slot = { current: undefined as TerminalChangeSet | undefined }
          npmSlotsRef.current.set(session.id, slot)
          return slot
        })()
      const lastChangeSlot =
        lastChangeSlotsRef.current.get(session.id) ??
        (() => {
          const slot = {
            current: undefined as VscodeAiLastChangeSource | undefined,
          }
          lastChangeSlotsRef.current.set(session.id, slot)
          return slot
        })()
      turnChangeSessionsRef.current.current = []

      const chatTitle =
        pendingMessages.find((message) => message.role === 'user')?.content.trim().slice(0, 40) ||
        '对话'

      const runCommandHost = createProdudeRunCommandHost({
        workspaceFolder: workspace,
        chatSessionId: session.id,
        chatTitle,
        terminalApi: api,
        npmLastChanges: npmSlot,
        lastChangeSource: lastChangeSlot,
        turnChangeSessions: turnChangeSessionsRef.current,
      })

      const history = buildProdudeChatHistory(session.messages)
      const modelKey = resolveVscodeAiModelKey({
        aiModelSource: session.modelSource as VscodeModelSource,
        aiModelKey: session.modelKey,
      })

      try {
        const result = await runProdudeAgent({
          userMessage: text || '请查看附件',
          workspaceFolder: workspace,
          chatSessionId: session.id,
          chatTitle,
          modelKey,
          history: history.length > 0 ? history : undefined,
          signal: controller.signal,
          terminalApi: api,
          runCommandHost,
          imageAttachments: turnAttachments.length > 0 ? turnAttachments : undefined,
          onProgress: (progress) => {
            if (controller.signal.aborted) return
            const next = liveProgressFromAgent(progress)
            liveProgressRef.current = next
            setLiveProgress(next)
            if (progress.contextUsage) {
              setComposerContextUsage(progress.contextUsage)
            }
            scrollToBottom()
          },
        })

        const investigation =
          result.investigation.timeline.length > 0 || result.investigation.activities.length > 0
            ? result.investigation
            : undefined
        const assistantMessage = createMessage('assistant', result.text || '（无回复）', {
          investigation,
        })
        const finalMessages = [...pendingMessages, assistantMessage]
        const finalSession: ProdudeSession = {
          ...pendingSession,
          messages: finalMessages,
          title: deriveSessionTitle(finalMessages),
          updatedAt: osNowMs(),
        }
        persistStore(
          upsertSession({ ...store, activeSessionId: session.id }, finalSession),
        )
      } catch (err) {
        if (isStreamAbortError(err, controller.signal)) {
          const live = liveProgressRef.current
          const partial = live?.answerText.trim() ?? ''
          const timeline = live?.timeline ?? []
          if (partial || timeline.length > 0) {
            const investigation =
              timeline.length > 0
                ? buildVscodeAiInvestigationFromTimeline(timeline)
                : undefined
            const assistantMessage = createMessage('assistant', partial || '（已停止）', {
              investigation,
            })
            const finalMessages = [...pendingMessages, assistantMessage]
            persistStore(
              upsertSession(
                { ...store, activeSessionId: session.id },
                {
                  ...pendingSession,
                  messages: finalMessages,
                  title: deriveSessionTitle(finalMessages),
                  updatedAt: osNowMs(),
                },
              ),
            )
          }
        } else {
          const errorMessage = createMessage('assistant', formatProdudeError(err), {
            isError: true,
          })
          const finalMessages = [...pendingMessages, errorMessage]
          persistStore(
            upsertSession(
              { ...store, activeSessionId: session.id },
              {
                ...pendingSession,
                messages: finalMessages,
                title: deriveSessionTitle(finalMessages),
                updatedAt: osNowMs(),
              },
            ),
          )
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
        }
        liveProgressRef.current = null
        setLiveProgress(null)
        setStreaming(false)
        streamingRef.current = false
        scrollToBottom()
      }
    },
    [activeSession, attachments, persistStore, scrollToBottom, store, streaming],
  )

  const handleSubmit = useCallback(() => {
    void sendMessage(draft)
  }, [draft, sendMessage])

  useEffect(() => {
    setAppWindowTitle('produde', 'ProDude')
  }, [setAppWindowTitle])

  useEffect(() => {
    stickToBottomRef.current = true
  }, [activeSession?.id])

  useEffect(() => {
    scrollToBottom()
  }, [
    activeSession?.id,
    activeSession?.messages.length,
    liveProgress?.answerText,
    liveProgress?.timeline.length,
    // 悬浮输入框高度变化（多行输入 / 附件条展开）时若正贴底，重新贴底避免内容被盖住
    composerInset,
    scrollToBottom,
  ])

  useLayoutEffect(() => {
    const el = composerWrapRef.current
    if (!el) return
    const updateInset = () => setComposerInset(el.offsetHeight)
    updateInset()
    const observer = new ResizeObserver(updateInset)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    void prepareVscodeAiContextUsage(resolvedModelId, resolvedTokenizerFamily)
  }, [resolvedModelId, resolvedTokenizerFamily])

  useEffect(() => {
    if (streaming) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        await prepareVscodeAiContextUsage(resolvedModelId, resolvedTokenizerFamily)
        if (cancelled || streamingRef.current) return
        const sessionId = activeSession?.id ?? 'produde-draft'
        const api = terminalApiRef.current
        const history = buildProdudeChatHistory(activeSession?.messages ?? [])
        const context = buildProdudeContext(workspaceFolder, api, sessionId)
        const toolsHost: VscodeAiToolsHost | undefined = api
          ? {
              getContext: () => context,
              runCommandHost: createProdudeRunCommandHost({
                workspaceFolder,
                chatSessionId: sessionId,
                chatTitle: '对话',
                terminalApi: api,
                npmLastChanges: { current: undefined },
                lastChangeSource: { current: undefined },
                turnChangeSessions: { current: [] },
              }),
              chatSessionId: sessionId,
              ensureAiTerminal: (kind, ownerId, title) =>
                api.ensureAiTerminal(kind, ownerId, title),
              getAiTerminalHandle: (kind, ownerId) =>
                api.getAiTerminalHandle(kind, ownerId),
              getAiTerminalSnapshot: (kind, ownerId) =>
                api.getAiTerminalSnapshot(kind, ownerId),
              closeAiTerminal: (kind, ownerId) => api.closeAiTerminal(kind, ownerId),
            }
          : undefined
        const usage = await measureVscodeAiContextUsage({
          mode: 'agent',
          context,
          history,
          userMessage: draft,
          model: resolvedModelId,
          providerEntryId: resolvedProviderEntryId,
          modelKey: resolvedModelKey,
          tokenizerFamily: resolvedTokenizerFamily,
          tools: toolsHost ? createProdudeAiTools(toolsHost) : undefined,
          aiModelOptions,
        })
        if (cancelled || streamingRef.current) return
        setComposerContextUsage(usage)
      })()
    }, CONTEXT_USAGE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    activeSession?.id,
    activeSession?.messages,
    aiModelOptions,
    draft,
    resolvedModelId,
    resolvedModelKey,
    resolvedProviderEntryId,
    resolvedTokenizerFamily,
    streaming,
    workspaceFolder,
  ])

  const onTerminalApiChange = useCallback((api: ProdudeTerminalHostApi | null) => {
    terminalApiRef.current = api
  }, [])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === 'produde' && !window.minimized)

    return [
      {
        label: 'ProDude',
        items: [
          ...aboutAppMenuPrefix('关于 ProDude', () => showBuiltinAbout('produde')),
          {
            type: 'action',
            label: '隐藏 ProDude',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出 ProDude',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp('produde'),
          },
        ],
      },
      {
        label: '文件',
        items: [
          {
            type: 'action',
            label: '新建对话',
            shortcut: '⌘N',
            onClick: handleNewChat,
          },
          {
            type: 'action',
            label: '选择工作区…',
            onClick: () => void handlePickWorkspace(),
          },
        ],
      },
      {
        label: '视图',
        items: CHAT_CONTENT_WIDTH_OPTIONS.map((option) => ({
          type: 'action' as const,
          label: `${menuCheckPrefix(contentWidth === option.id)}${option.label}`,
          onClick: () => setContentWidth(option.id),
        })),
      },
    ]
  }, [
    closeWindowsForApp,
    contentWidth,
    handleNewChat,
    handlePickWorkspace,
    minimizeWindow,
    showBuiltinAbout,
    windows,
  ])

  useAppMenuBar('produde', menuBar)

  const showWelcome = !activeSession || activeSession.messages.length === 0
  const canSend =
    !streaming && (Boolean(draft.trim()) || attachments.length > 0) && textModels.length > 0
  const liveTimeline = liveProgress?.timeline ?? []
  const liveAnswer = liveProgress?.answerText ?? ''
  const showLiveBubble = streaming && (liveTimeline.length > 0 || liveAnswer.length > 0)
  const widthClass =
    contentWidth === 'wide'
      ? 'help-app--width-wide'
      : contentWidth === 'full'
        ? 'help-app--width-full'
        : ''

  return (
    <div class={`produde-app${sidebarOpen ? ' produde-app--sidebar-open' : ''}`}>
      {openDialog}
      <ProdudeTerminalHost workspaceFolder={workspaceFolder} onApiChange={onTerminalApiChange} />
      {sidebarOpen && (
        <button
          type="button"
          class="produde-app__sidebar-backdrop"
          aria-label="关闭对话列表"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside class="produde-app__sidebar">
        <div class="produde-app__sidebar-head">
          <div class="produde-app__logo">
            <span class="produde-app__logo-mark" aria-hidden="true">
              🛠️
            </span>
            <span class="produde-app__logo-text">ProDude</span>
          </div>
          <button
            type="button"
            class="produde-app__new-chat"
            onClick={handleNewChat}
            disabled={streaming}
          >
            ＋ 新建对话
          </button>
        </div>

        <div class="produde-app__session-list">
          {store.sessions.length === 0 ? (
            <p class="produde-app__session-empty">暂无对话记录</p>
          ) : (
            store.sessions.map((session) => (
              <div
                key={session.id}
                class={`produde-app__session${store.activeSessionId === session.id ? ' produde-app__session--active' : ''}`}
              >
                <button
                  type="button"
                  class="produde-app__session-open"
                  onClick={() => selectSession(session.id)}
                >
                  <span class="produde-app__session-emoji" aria-hidden="true">
                    {session.emoji}
                  </span>
                  <span class="produde-app__session-label">{session.title}</span>
                </button>
                <button
                  type="button"
                  class="produde-app__session-delete"
                  aria-label={`删除对话 ${session.title}`}
                  onClick={() => handleDeleteSession(session.id)}
                  disabled={streaming}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      <div class="produde-app__main">
        <header class="produde-app__toolbar">
          <button
            type="button"
            class="produde-app__sidebar-toggle"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label="对话列表"
            aria-expanded={sidebarOpen}
          >
            <span class="produde-app__sidebar-toggle-icon" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
          <span class="produde-app__toolbar-title">ProDude</span>
          <span
            class="produde-app__toolbar-hint produde-app__workspace-path"
            title={workspaceFolder}
          >
            {shortWorkspaceLabel(workspaceFolder)}
          </span>
          <button
            type="button"
            class="produde-app__workspace-btn"
            onClick={() => void handlePickWorkspace()}
            disabled={streaming}
          >
            更换文件夹
          </button>
        </header>

        <div
          class={`help-app vscode-ai produde-app__chat-shell help-app--width-full ${widthClass}`.trim()}
          style={{ '--vscode-ai-composer-inset': `${composerInset}px` }}
        >
          <div
            class="help-app__chat vscode-ai__chat"
            ref={chatScrollRef}
            onScroll={onChatScroll}
          >
            {showWelcome ? (
              <div class="help-app__welcome vscode-ai__welcome">
                <div class="help-app__welcome-icon" aria-hidden="true">
                  <VscodeIcon size={56} />
                </div>
                <h2 class="help-app__welcome-title">ProDude</h2>
                <p class="help-app__welcome-sub">
                  默认在用户目录里对话改代码，无需先选文件夹。
                  <br />
                  直接说你想查什么、改什么就行。
                </p>
                <div class="help-app__samples" aria-label="示例提问">
                  {SAMPLE_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      class="help-app__sample"
                      onClick={() => void sendMessage(prompt)}
                      disabled={streaming}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div class="help-app__messages">
                {activeSession?.messages.map((message) => {
                  if (message.role === 'user') {
                    return (
                      <div
                        key={message.id}
                        class={`help-app__message help-app__message--user${message.isError ? ' help-app__message--error' : ''}`}
                      >
                        <span class="help-app__avatar" aria-hidden="true">
                          🙂
                        </span>
                        <div
                          class={`help-app__bubble vscode-ai__bubble--user${message.isError ? ' help-app__bubble--error' : ''}`}
                        >
                          <div class="help-app__answer help-app__answer--plain">
                            {message.content}
                          </div>
                        </div>
                      </div>
                    )
                  }

                  return (
                    <div
                      key={message.id}
                      class={`help-app__message help-app__message--assistant${message.isError ? ' help-app__message--error' : ''}`}
                    >
                      <div class="vscode-ai__message-main">
                        <span class="help-app__avatar" aria-hidden="true">
                          {message.isError ? '!' : <VscodeIcon size={30} />}
                        </span>
                        <div class="vscode-ai__message-stack">
                          <div
                            class={`help-app__bubble${message.isError ? ' help-app__bubble--error' : ''}${message.investigation ? ' help-app__bubble--with-investigation' : ''}`}
                          >
                            {message.investigation ? (
                              <InvestigationPanel investigation={message.investigation} />
                            ) : undefined}
                            {!message.isError ? (
                              <div class="help-app__answer">
                                <HelpMarkdown text={message.content} />
                              </div>
                            ) : (
                              <div class="help-app__answer help-app__answer--plain">
                                {message.content}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}

                {showLiveBubble ? (
                  <div class="help-app__message help-app__message--assistant">
                    <div class="vscode-ai__message-main">
                      <span class="help-app__avatar" aria-hidden="true">
                        <VscodeIcon size={30} />
                      </span>
                      <div class="vscode-ai__message-stack">
                        <div class="help-app__bubble help-app__bubble--with-investigation help-app__bubble--live">
                          <LiveTimeline items={liveTimeline} />
                          {liveAnswer && !liveTimeline.some((item) => item.kind === 'text') ? (
                            <div
                              class={buildLiveAnswerClassName({
                                streaming: true,
                                separated: liveTimeline.length > 0,
                              })}
                            >
                              <HelpMarkdown text={liveAnswer} streaming />
                            </div>
                          ) : undefined}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : undefined}

                {streaming && !showLiveBubble ? (
                  <div class="help-app__message help-app__message--assistant">
                    <div class="vscode-ai__message-main">
                      <span class="help-app__avatar" aria-hidden="true">
                        <VscodeIcon size={30} />
                      </span>
                      <div class="vscode-ai__message-stack">
                        <div class="help-app__bubble help-app__bubble--live">
                          <LiveTimeline items={[]} />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : undefined}
              </div>
            )}
          </div>

          <div
            class="help-app__composer-wrap vscode-ai__composer-wrap"
            ref={composerWrapRef}
          >
            {attachError ? (
              <div class="vscode-ai__attach-error" role="alert">
                {attachError}
              </div>
            ) : undefined}
            <VscodeAiComposerBlock
              value={draft}
              onChange={setDraft}
              onSend={handleSubmit}
              inputRef={inputRef}
              placeholder="描述要查什么、改什么…"
              inputDisabled={streaming}
              sendDisabled={!canSend}
              busy={streaming}
              onStop={handleStop}
              mode="agent"
              onModeChange={() => undefined}
              hideMode
              modelPickerValue={modelSelectValue}
              onModelPickerChange={handleModelPickerChange}
              textModels={textModels}
              capabilityTags={capabilityTags}
              aiModelOptions={aiModelOptions}
              onAiModelOptionsChange={setAiModelOptions}
              contextUsage={composerContextUsage}
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              onAttachError={setAttachError}
              chatSessionId={activeSession?.id}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
