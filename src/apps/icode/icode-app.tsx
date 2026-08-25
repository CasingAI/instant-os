import type { ComponentChildren, ComponentType } from 'preact'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { osNowMs } from '../../os/os-clock.ts'
import { AiStreamPreview } from '../../ai/ai-stream-preview.tsx'
import { ICodeIcon } from '../../icons/app-icons.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import { GeneratedAppIcon } from '../generated/generated-app-icon.tsx'
import { EXPERIMENTAL_SETTINGS_CHANGED_EVENT } from '../../os/experimental-settings-storage.ts'
import { isGeneratedAppStorageMessage } from '../../os/generated-app-data-storage.ts'
import { useGeneratedAppHeartbeat } from '../../os/generated-app-heartbeat-context.tsx'
import { useGeneratedApps } from '../../os/generated-apps-context.tsx'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs, useAppCloseGuard } from '../../os/os-context.tsx'
import {
  isGeneratedAppProcessIsolationActive,
  SANDBOXED_CORS_PROBE_COMPLETED_EVENT,
} from '../../os/resolve-generated-app-process-isolation.ts'
import type { GeneratedAppId } from '../../os/types.ts'
import {
  APP_CAPABILITY_TAG_3D,
  APP_CAPABILITY_TAG_AI,
  APP_CAPABILITY_TAG_FILES,
  APP_CAPABILITY_TAG_TERMINAL,
  filterAppCapabilityTags,
  hasAppCapabilityTag,
} from '../appstore/app-capability-tags.ts'
import type { AppCapabilityTag } from '../appstore/app-capability-tags.ts'
import type { GeneratedAppRecord } from '../appstore/types.ts'
import {
  draftFromInternalProject,
  draftFromSession,
  draftSnapshotsEqual,
  isPublishDirty,
  loadPublishedSnapshot,
  resolvePreviewBootstrapData,
  type ICodePublishedSnapshot,
} from './icode-draft.ts'
import { buildIcodeEditorNavHint, buildIcodeNavigateAwayPrompt } from './icode-editor-nav-hint.ts'
import { isIcodeGenerationAbortedError } from './icode-generation-abort.ts'
import type { AppGenerationPhase } from '../appstore/generate-app-stream.ts'
import { parseAiderEditBlocks, stripAiderEditBlocksFromContent, extractNaturalLanguageReply } from './icode-apply-edits.ts'
import {
  buildChatCapabilityRequests,
  formatGrantableCapabilityLabel,
  mergeSessionTagsWithCapability,
  type GrantableIcodeCapabilityTag,
} from './icode-capability-request.ts'
import {
  buildIcodeSyncInput,
  buildIcodePlaceholderSyncInput,
  findProjectNameConflict,
  formatProjectNameConflictMessage,
  isIcodeManagedInstalledApp,
  resolvePublishAppId,
  resolveUniqueCopyName,
} from './icode-publish.ts'
import { installGeneratedAppAiHandler } from '../generated/install-generated-app-ai-handler.ts'
import { installGeneratedAppFilesHandler } from '../generated/install-generated-app-files-handler.ts'
import { installGeneratedAppTerminalHandler } from '../generated/install-generated-app-terminal-handler.ts'
import { injectGeneratedAppHeartbeatBridge } from '../generated/inject-generated-app-heartbeat-bridge.ts'
import { useGeneratedHtmlIframe } from '../generated/use-generated-html-iframe.ts'
import { prepareIcodePreviewHtml } from './prepare-icode-preview-html.ts'
import {
  createInternalProject,
  getInternalProject,
  loadInternalProjects,
  loadInternalProjectsSync,
  previewAppIdForInternal,
  removeInternalProject,
  subscribeInternalProjects,
  updateInternalProject,
} from './icode-storage.ts'
import { appendConsoleEntry, isIcodeConsoleMessage } from './icode-console.ts'
import {
  isGeneratedAppRuntimeErrorMessage,
  logRuntimeErrorToHostConsole,
} from '../generated/generated-app-runtime-errors.ts'
import {
  ICODE_CONSOLE_MESSAGE_TYPE,
  type ICodeChatMessage,
  type ICodeConsoleEntry,
  type ICodeExportBundle,
  type ICodeInternalProject,
} from './icode-types.ts'
import { formatTokenCount } from '../browser/format-token-count.ts'
import { measureIcodeContextPayload } from './icode-context-tokens.ts'
import { useIcodeNarrowLayout } from './icode-layout.ts'
import { appDataRecordsEqual } from './icode-app-data-value.ts'
import { WindowModal, type WindowModalAction } from '../../window/window-modal.tsx'
import { WindowModalTheme } from '../../window/window-modal-context.tsx'
import './icode.css'

function IcodeHeavyFallback({ label }: { label: string }) {
  return <p class="icode__list--empty">{label}</p>
}

function createDeferredComponent<P extends object>(
  load: () => Promise<ComponentType<P>>,
  fallback: ComponentChildren,
): ComponentType<P> {
  let resolved: ComponentType<P> | undefined

  return function DeferredComponent(props: P) {
    const [Component, setComponent] = useState<ComponentType<P> | undefined>(() => resolved)

    useEffect(() => {
      if (resolved) {
        setComponent(() => resolved)
        return
      }

      let cancelled = false
      void load()
        .then((loaded) => {
          resolved = loaded
          if (!cancelled) {
            setComponent(() => loaded)
          }
        })
        .catch(() => undefined)
      return () => {
        cancelled = true
      }
    }, [])

    if (!Component) {
      return fallback
    }
    return <Component {...props} />
  }
}

const IcodeMonacoEditor = createDeferredComponent(
  () => import('./icode-monaco-editor.tsx').then((module) => module.IcodeMonacoEditor),
  <IcodeHeavyFallback label="正在加载源码编辑器…" />,
)
const IcodeAppDataEditor = createDeferredComponent(
  () => import('./icode-app-data-editor.tsx').then((module) => module.IcodeAppDataEditor),
  <IcodeHeavyFallback label="正在加载数据编辑器…" />,
)
const EmojiPickerPopover = createDeferredComponent(
  () => import('../../ui/emoji-picker-popover.tsx').then((module) => module.EmojiPickerPopover),
  <span class="icode__config-note">加载表情选择器…</span>,
)
const loadIcodeChatMessages = () => import('./icode-chat-message.tsx')

function IcodeDeferredGate<T>({
  load,
  fallback,
  children,
}: {
  load: () => Promise<T>
  fallback: ComponentChildren
  children: (mod: T) => ComponentChildren
}) {
  const [mod, setMod] = useState<T | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void load()
      .then((loaded) => {
        if (!cancelled) {
          setMod(() => loaded)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [load])

  if (!mod) {
    return fallback
  }
  return children(mod)
}

type EditorTab = 'chat' | 'source' | 'config' | 'data' | 'console'
type MobileEditorPane = 'preview' | 'edit'

type IcodeNavigationIntent =
  | { type: 'list' }
  | { type: 'window' }
  | { type: 'open'; projectId: string }

const ICODE_CHROME_ACCENT = '#2f87e2'

const ICODE_THEME_COLOR_PRESETS = [
  '#007aff',
  '#5856d6',
  '#34c759',
  '#ff9500',
  '#ff3b30',
  '#af52de',
  '#5ac8fa',
  '#ff2d55',
] as const

function generationStatusLabel(phase: AppGenerationPhase | undefined, progress: number): string {
  if (phase === 'waiting') {
    return '连接 AI…'
  }
  if (phase === 'thinking') {
    return `思考中 ${Math.round(progress)}%`
  }
  if (phase === 'generating') {
    return `生成中 ${Math.round(progress)}%`
  }
  return '处理中…'
}

const CONSOLE_LEVEL_LABELS: Record<ICodeConsoleEntry['level'], string> = {
  log: '日志',
  info: 'INFO',
  warn: '提示',
  error: '错误',
  debug: 'DBG',
}

type EditorSession = {
  projectId: string
  linkedAppId?: GeneratedAppId
  name: string
  description: string
  category: string
  iconEmoji: string
  themeColor: string
  tags: AppCapabilityTag[]
  html: string
  appData: Record<string, string>
  chat: ICodeChatMessage[]
}

function formatProjectDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function htmlHasContent(html: string): boolean {
  return html.length > 0
}

function chatMessagesEqual(left: ICodeChatMessage[], right: ICodeChatMessage[]): boolean {
  if (left === right) {
    return true
  }
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

function sessionFromInternal(project: ICodeInternalProject): EditorSession {
  return {
    projectId: project.id,
    linkedAppId: project.linkedAppId,
    name: project.name,
    description: project.description,
    category: project.category,
    iconEmoji: project.iconEmoji,
    themeColor: project.themeColor,
    tags: project.tags,
    html: project.html,
    appData: { ...project.appData },
    chat: [...project.chat],
  }
}

function mergeDraftIntoSession(session: EditorSession, draftHtml: string, codeDirty: boolean): EditorSession {
  if (!codeDirty) {
    return session
  }

  return { ...session, html: draftHtml }
}

async function sessionToInternalProject(
  session: EditorSession,
  draftHtml: string,
  codeDirty: boolean,
): Promise<ICodeInternalProject> {
  const merged = mergeDraftIntoSession(session, draftHtml, codeDirty)
  const stored = await getInternalProject(session.projectId)
  const now = osNowMs()
  return {
    id: session.projectId,
    name: merged.name,
    description: merged.description,
    category: merged.category,
    iconEmoji: merged.iconEmoji,
    themeColor: merged.themeColor,
    tags: merged.tags,
    html: merged.html,
    appData: { ...merged.appData },
    chat: merged.chat,
    linkedAppId: merged.linkedAppId,
    createdAt: stored?.createdAt ?? now,
    updatedAt: now,
  }
}

function previewAppIdForSession(session: EditorSession): GeneratedAppId {
  return previewAppIdForInternal(session.projectId)
}

function icodePreviewHeartbeatWindowId(projectId: string): string {
  return `icode-preview:${projectId}`
}

export function ICodeApp() {
  const { setAppWindowTitle, closeWindowsForApp, bypassAppCloseGuard } = useOs()
  const { installedApps, syncAppFromIcode, getAppDataRevision, uninstallApp, pendingIcodeProjectId, clearPendingIcodeProject } = useGeneratedApps()

  const [projectRevision, setProjectRevision] = useState(0)
  const [session, setSession] = useState<EditorSession | undefined>()
  const [editorTab, setEditorTab] = useState<EditorTab>('chat')
  const [visitedEditorTabs, setVisitedEditorTabs] = useState<Partial<Record<EditorTab, true>>>({
    chat: true,
  })
  const [mobilePane, setMobilePane] = useState<MobileEditorPane>('edit')
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generationPhase, setGenerationPhase] = useState<AppGenerationPhase | undefined>()
  const [generationStatus, setGenerationStatus] = useState('')
  const [streamReasoningText, setStreamReasoningText] = useState('')
  const [streamContentText, setStreamContentText] = useState('')
  const [streamVisibleReply, setStreamVisibleReply] = useState('')
  const [streamAppliedEdits, setStreamAppliedEdits] = useState(0)
  const [error, setError] = useState<string | undefined>()
  const [importAlert, setImportAlert] = useState<
    { title: string; message: string } | undefined
  >()
  const [showNewProject, setShowNewProject] = useState(false)
  const [showImportPicker, setShowImportPicker] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<
    { projectId: string; name: string; linkedAppId?: GeneratedAppId; linkedAppName?: string } | undefined
  >()
  const [deleteLinkedAppToo, setDeleteLinkedAppToo] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDescription, setNewProjectDescription] = useState('')
  const [previewEpoch, setPreviewEpoch] = useState(0)
  const [processIsolated, setProcessIsolated] = useState(() => isGeneratedAppProcessIsolationActive())
  const [draftHtml, setDraftHtml] = useState('')
  const [draftAppData, setDraftAppData] = useState<Record<string, string>>({})
  const [dataEditInvalid, setDataEditInvalid] = useState(false)
  const dataDraftEditedRef = useRef(false)
  const [consoleLogs, setConsoleLogs] = useState<ICodeConsoleEntry[]>([])
  const [publishedSnapshot, setPublishedSnapshot] = useState<ICodePublishedSnapshot | undefined>()
  const [closePromptOpen, setClosePromptOpen] = useState(false)
  const [closePromptMode, setClosePromptMode] = useState<'close' | 'switch'>('close')
  const [clearChatPromptOpen, setClearChatPromptOpen] = useState(false)
  const closeIntentRef = useRef<IcodeNavigationIntent>({ type: 'list' })

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const previewWindowRef = useRef<Window | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const generationRunRef = useRef<
    | {
        abortController: AbortController
        htmlBefore: string
        nextChat: ICodeChatMessage[]
        stopped: boolean
      }
    | undefined
  >()
  const streamSnapshotRef = useRef({
    reasoningText: '',
    contentText: '',
    appliedEdits: 0,
  })
  const consoleListRef = useRef<HTMLDivElement>(null)
  const chatListRef = useRef<HTMLDivElement>(null)
  const previewBootstrapDataRef = useRef<Record<string, string>>({})
  const previewFrozenLoggedRef = useRef(false)
  const { hostRef, narrowLayout } = useIcodeNarrowLayout()
  const {
    registerHeartbeat,
    unregisterHeartbeat,
    resetHeartbeatMonitoring,
    setHeartbeatContentWindow,
    isWindowFrozen,
  } = useGeneratedAppHeartbeat()

  const internalProjects = useMemo(() => loadInternalProjectsSync(), [projectRevision])

  const syncPlaceholderToDesktop = useCallback(
    async (project: ICodeInternalProject): Promise<boolean> => {
      const appId = resolvePublishAppId(project)
      const linkedProject = project.linkedAppId ? project : { ...project, linkedAppId: appId }
      if (!project.linkedAppId) {
        await updateInternalProject(project.id, { linkedAppId: appId })
      }
      return syncAppFromIcode(buildIcodePlaceholderSyncInput(linkedProject))
    },
    [syncAppFromIcode],
  )

  const publishProjectToDesktop = useCallback(
    async (project: ICodeInternalProject): Promise<boolean> => {
      const appId = resolvePublishAppId(project)
      const linkedProject = project.linkedAppId ? project : { ...project, linkedAppId: appId }
      if (!project.linkedAppId) {
        await updateInternalProject(project.id, { linkedAppId: appId })
      }
      return syncAppFromIcode(buildIcodeSyncInput(linkedProject))
    },
    [syncAppFromIcode],
  )

  const ensureDesktopPlaceholder = useCallback(
    async (project: ICodeInternalProject): Promise<ICodeInternalProject> => {
      const appId = resolvePublishAppId(project)
      if (installedApps.some((app) => app.id === appId)) {
        return project
      }

      await syncPlaceholderToDesktop(project)
      return (await getInternalProject(project.id)) ?? project
    },
    [installedApps, syncPlaceholderToDesktop],
  )

  const migratedProjectsRef = useRef(false)
  useEffect(() => {
    if (migratedProjectsRef.current) {
      return
    }
    migratedProjectsRef.current = true

    let alive = true
    void (async () => {
      const projects = await loadInternalProjects()

      let changed = false
      for (const project of projects) {
        if (!alive) {
          break
        }

        const appId = resolvePublishAppId(project)
        let current = project
        if (!project.linkedAppId) {
          const patched = await updateInternalProject(project.id, { linkedAppId: appId })
          if (patched) {
            current = patched
            changed = true
          }
        }

        const installed = installedApps.find((app) => app.id === resolvePublishAppId(current))
        if (!installed) {
          await syncPlaceholderToDesktop(current)
          changed = true
        }
      }

      if (alive && changed) {
        setProjectRevision((value) => value + 1)
      }
    })()

    return () => {
      alive = false
    }
  }, [installedApps, syncPlaceholderToDesktop])

  useEffect(() => {
    let alive = true
    void loadInternalProjects().then((projects) => {
      if (!alive) {
        return
      }
      if (projects === loadInternalProjectsSync()) {
        return
      }
      setProjectRevision((value) => value + 1)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => subscribeInternalProjects(() => setProjectRevision((value) => value + 1)), [])

  const previewAppId = session ? previewAppIdForSession(session) : undefined
  const previewHeartbeatWindowId = session ? icodePreviewHeartbeatWindowId(session.projectId) : undefined
  const runtimeAppId = session?.linkedAppId ?? previewAppId
  const linkedAppDataRevision = session?.linkedAppId ? getAppDataRevision(session.linkedAppId) : 0
  const codeDirty = session !== undefined && draftHtml !== session.html
  const dataDirty = Boolean(session && !appDataRecordsEqual(draftAppData, session.appData))
  const currentDraft = session ? draftFromSession(session, draftHtml, codeDirty) : undefined
  const storedProject = session
    ? internalProjects.find((project) => project.id === session.projectId)
    : undefined
  const publishDirty =
    Boolean(session && publishedSnapshot && currentDraft) &&
    isPublishDirty(currentDraft!, publishedSnapshot!)
  const internalSaveDirty =
    Boolean(session && storedProject && currentDraft) &&
    !draftSnapshotsEqual(currentDraft!, draftFromInternalProject(storedProject!))
  const chatDirty =
    Boolean(session && storedProject) &&
    !chatMessagesEqual(session!.chat, storedProject!.chat)
  const hasDraftToSave = internalSaveDirty || chatDirty
  const contextPayload = useMemo(() => {
    if (!session) {
      return { characters: 0, tokens: 0 }
    }

    const html = codeDirty ? draftHtml : session.html
    return measureIcodeContextPayload(
      {
        slug: session.projectId,
        name: session.name,
        description: session.description,
        category: session.category,
        iconEmoji: session.iconEmoji,
        themeColor: session.themeColor,
        tags: session.tags,
      },
      html,
      prompt.trim(),
      session.chat,
    )
  }, [codeDirty, draftHtml, prompt, session, session?.chat])
  const streamEdits = useMemo(
    () => (streamContentText ? parseAiderEditBlocks(streamContentText) : []),
    [streamContentText],
  )

  const codeEditingActive = useMemo(() => {
    if (!generating || !session) {
      return false
    }

    if (!htmlHasContent(session.html)) {
      return true
    }

    return (
      streamAppliedEdits > 0 ||
      streamEdits.length > 0 ||
      streamContentText.includes('<<<<<<< SEARCH')
    )
  }, [generating, session, streamAppliedEdits, streamContentText, streamEdits.length])

  const showStreamOutput =
    codeEditingActive && Boolean(streamReasoningText || streamContentText)

  const editorNavHint = useMemo(
    () =>
      buildIcodeEditorNavHint({
        generating,
        codeEditing: codeEditingActive,
        generationStatus,
        codeDirty,
        publishDirty,
        internalSaveDirty,
        chatDirty,
        currentDraft,
        publishedSnapshot,
        htmlLength: session?.html.length ?? 0,
      }),
    [
      chatDirty,
      codeDirty,
      codeEditingActive,
      currentDraft,
      generating,
      generationStatus,
      internalSaveDirty,
      publishDirty,
      publishedSnapshot,
      session?.html.length,
    ],
  )
  const navigateAwayPrompt = useMemo(
    () =>
      buildIcodeNavigateAwayPrompt({
        codeDirty,
        internalSaveDirty,
        chatDirty,
        mode: closePromptMode,
      }),
    [chatDirty, closePromptMode, codeDirty, internalSaveDirty],
  )

  useEffect(() => {
    if (!session) {
      setDraftHtml('')
      return
    }

    setDraftHtml(session.html)
  }, [session?.html, session?.projectId])

  useEffect(() => {
    dataDraftEditedRef.current = false
    if (!session) {
      setDraftAppData({})
      setDataEditInvalid(false)
      return
    }

    setDraftAppData({ ...session.appData })
  }, [session?.projectId])

  useEffect(() => {
    if (!session || dataDraftEditedRef.current) {
      return
    }

    setDraftAppData({ ...session.appData })
  }, [session?.appData])

  useEffect(() => {
    const syncIsolation = () => {
      setProcessIsolated(isGeneratedAppProcessIsolationActive())
    }

    window.addEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, syncIsolation)
    window.addEventListener(SANDBOXED_CORS_PROBE_COMPLETED_EVENT, syncIsolation)
    return () => {
      window.removeEventListener(EXPERIMENTAL_SETTINGS_CHANGED_EVENT, syncIsolation)
      window.removeEventListener(SANDBOXED_CORS_PROBE_COMPLETED_EVENT, syncIsolation)
    }
  }, [])

  useEffect(() => {
    setVisitedEditorTabs((current) =>
      current[editorTab] ? current : { ...current, [editorTab]: true },
    )
  }, [editorTab])

  useEffect(() => {
    setVisitedEditorTabs({ chat: true })
    setEditorTab('chat')
  }, [session?.projectId])

  useEffect(() => {
    if (!session || !htmlHasContent(session.html)) {
      return
    }

    previewBootstrapDataRef.current = resolvePreviewBootstrapData(session, draftAppData, false)
    setConsoleLogs([])
    previewFrozenLoggedRef.current = false
    setPreviewEpoch((epoch) => epoch + 1)
  }, [linkedAppDataRevision, session?.html, session?.linkedAppId, session?.projectId])

  const preparedHtml = useMemo(() => {
    if (!session || !runtimeAppId || !previewAppId || !previewHeartbeatWindowId || !htmlHasContent(session.html)) {
      return undefined
    }

    const runtimeHtml = prepareIcodePreviewHtml(
      session.html,
      runtimeAppId,
      previewBootstrapDataRef.current,
      previewAppId,
      {
        processIsolated,
        enableFiles: hasAppCapabilityTag(session.tags, APP_CAPABILITY_TAG_FILES),
        enableTerminal: hasAppCapabilityTag(session.tags, APP_CAPABILITY_TAG_TERMINAL),
      },
    )
    return injectGeneratedAppHeartbeatBridge(runtimeHtml, previewAppId, previewHeartbeatWindowId)
  }, [
    previewAppId,
    previewEpoch,
    previewHeartbeatWindowId,
    processIsolated,
    runtimeAppId,
    session?.html,
    session?.tags,
  ])

  const previewRemountKey = previewAppId
    ? `${previewAppId}-${previewEpoch}-${processIsolated ? 'iso' : 'std'}`
    : 'icode-preview'

  const handlePreviewIframeReady = useCallback(() => {
    previewWindowRef.current = iframeRef.current?.contentWindow ?? null
    if (!previewHeartbeatWindowId) {
      return
    }

    setHeartbeatContentWindow(previewHeartbeatWindowId, iframeRef.current?.contentWindow ?? undefined)
  }, [previewHeartbeatWindowId, setHeartbeatContentWindow])

  const { iframeProps } = useGeneratedHtmlIframe(
    iframeRef,
    session && htmlHasContent(session.html) ? preparedHtml : undefined,
    previewRemountKey,
    { processIsolated, onReady: handlePreviewIframeReady },
  )

  useEffect(() => {
    if (!previewHeartbeatWindowId || !previewAppId) {
      return
    }

    registerHeartbeat(previewHeartbeatWindowId, previewAppId)
    return () => unregisterHeartbeat(previewHeartbeatWindowId)
  }, [previewAppId, previewHeartbeatWindowId, registerHeartbeat, unregisterHeartbeat])

  useEffect(() => {
    if (!previewHeartbeatWindowId) {
      return
    }

    previewFrozenLoggedRef.current = false
    resetHeartbeatMonitoring(previewHeartbeatWindowId)
  }, [previewRemountKey, previewHeartbeatWindowId, resetHeartbeatMonitoring])

  const previewFrozen =
    previewHeartbeatWindowId !== undefined && isWindowFrozen(previewHeartbeatWindowId)

  useEffect(() => {
    if (!previewFrozen || !previewAppId || previewFrozenLoggedRef.current) {
      if (!previewFrozen) {
        previewFrozenLoggedRef.current = false
      }
      return
    }

    previewFrozenLoggedRef.current = true
    const timestamp = osNowMs()
    setConsoleLogs((current) =>
      appendConsoleEntry(current, {
        type: ICODE_CONSOLE_MESSAGE_TYPE,
        appId: previewAppId,
        level: 'warn',
        text: '预览应用未响应，可能是代码中存在死循环',
        timestamp,
      }),
    )
  }, [previewAppId, previewFrozen])

  useEffect(() => {
    if (!session) {
      setAppWindowTitle('icode', 'iCode')
      return
    }

    setAppWindowTitle('icode', `${session.name} — iCode`)
  }, [session, setAppWindowTitle])

  useEffect(() => {
    if (!runtimeAppId) {
      return
    }

    return installGeneratedAppAiHandler({
      appId: runtimeAppId,
      appName: session?.name,
      debug: true,
      getContentWindow: () =>
        iframeRef.current?.contentWindow ?? previewWindowRef.current ?? undefined,
    })
  }, [runtimeAppId, session?.name])

  useEffect(() => {
    if (!runtimeAppId || !session) {
      return
    }
    if (!hasAppCapabilityTag(session.tags, APP_CAPABILITY_TAG_FILES)) {
      return
    }

    return installGeneratedAppFilesHandler({
      appId: runtimeAppId,
      getContentWindow: () =>
        iframeRef.current?.contentWindow ?? previewWindowRef.current ?? undefined,
      isAllowed: () => hasAppCapabilityTag(session.tags, APP_CAPABILITY_TAG_FILES),
    })
  }, [runtimeAppId, session])

  useEffect(() => {
    if (!runtimeAppId || !session) {
      return
    }
    if (!hasAppCapabilityTag(session.tags, APP_CAPABILITY_TAG_TERMINAL)) {
      return
    }

    return installGeneratedAppTerminalHandler({
      appId: runtimeAppId,
      getContentWindow: () =>
        iframeRef.current?.contentWindow ?? previewWindowRef.current ?? undefined,
      isAllowed: () => hasAppCapabilityTag(session.tags, APP_CAPABILITY_TAG_TERMINAL),
    })
  }, [runtimeAppId, session])

  useEffect(() => {
    if (!runtimeAppId || !previewAppId) {
      return
    }

    const onMessage = (event: MessageEvent) => {
      const previewWindow =
        previewWindowRef.current ?? iframeRef.current?.contentWindow ?? undefined

      if (isIcodeConsoleMessage(event.data)) {
        if (event.data.appId !== previewAppId) {
          return
        }

        if (event.source !== previewWindow) {
          return
        }

        if (event.data.level === 'error') {
          logRuntimeErrorToHostConsole(session?.name ?? previewAppId, event.data.text)
        }

        setConsoleLogs((current) => appendConsoleEntry(current, event.data))
        return
      }

      if (isGeneratedAppRuntimeErrorMessage(event.data)) {
        if (event.data.appId !== previewAppId) {
          return
        }

        if (event.source !== previewWindow) {
          return
        }

        logRuntimeErrorToHostConsole(session?.name ?? previewAppId, event.data.text)
        setConsoleLogs((current) =>
          appendConsoleEntry(current, {
            type: ICODE_CONSOLE_MESSAGE_TYPE,
            appId: event.data.appId,
            level: 'error',
            text: event.data.text,
            timestamp: event.data.timestamp,
          }),
        )
        return
      }

      if (event.source !== previewWindow) {
        return
      }

      if (!isGeneratedAppStorageMessage(event.data)) {
        return
      }

      if (event.data.appId !== runtimeAppId) {
        return
      }

      setSession((current) => {
        if (!current) {
          return current
        }

        return {
          ...current,
          appData: { ...event.data.data },
        }
      })
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [previewAppId, runtimeAppId, session?.name])

  useEffect(() => {
    return () => {
      generationRunRef.current?.abortController.abort()
    }
  }, [])

  useEffect(() => {
    const container = consoleListRef.current
    if (!container || editorTab !== 'console') {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight
    })

    return () => window.cancelAnimationFrame(frame)
  }, [consoleLogs, editorTab])

  const chatPinnedToBottomRef = useRef(true)

  useEffect(() => {
    const container = chatListRef.current
    if (!container || editorTab !== 'chat') {
      return
    }

    const isNearBottom = (threshold = 48) =>
      container.scrollHeight - container.scrollTop - container.clientHeight <= threshold

    const scrollToBottom = () => {
      container.scrollTop = container.scrollHeight
      chatPinnedToBottomRef.current = true
    }

    const scrollToBottomIfPinned = () => {
      if (chatPinnedToBottomRef.current || isNearBottom()) {
        scrollToBottom()
      }
    }

    const onScroll = () => {
      chatPinnedToBottomRef.current = isNearBottom()
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    scrollToBottom()

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(scrollToBottomIfPinned)
    })
    resizeObserver.observe(container)

    const mutationObserver = new MutationObserver(() => {
      window.requestAnimationFrame(scrollToBottomIfPinned)
    })
    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    return () => {
      container.removeEventListener('scroll', onScroll)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [editorTab, session?.chat, session?.projectId, generating])

  const saveDraftInternal = useCallback(
    async (
      next: EditorSession,
      draftHtmlValue: string,
      codeDirtyFlag: boolean,
    ): Promise<ICodeInternalProject | undefined> => {
      const project = await sessionToInternalProject(next, draftHtmlValue, codeDirtyFlag)
      const updated = await updateInternalProject(project.id, {
        name: project.name,
        description: project.description,
        category: project.category,
        iconEmoji: project.iconEmoji,
        themeColor: project.themeColor,
        tags: project.tags,
        html: project.html,
        appData: project.appData,
        chat: project.chat,
        linkedAppId: project.linkedAppId,
      })
      setProjectRevision((value) => value + 1)
      if (!updated) {
        return undefined
      }

      return await ensureDesktopPlaceholder(updated)
    },
    [ensureDesktopPlaceholder],
  )

  const publishSessionDraft = useCallback(
    async (
      next: EditorSession,
      draftHtmlValue: string,
      codeDirtyFlag: boolean,
    ): Promise<boolean> => {
      const saved = await saveDraftInternal(next, draftHtmlValue, codeDirtyFlag)
      if (!saved) {
        setError('保存草稿失败，请检查存储空间')
        return false
      }

      if (!(await publishProjectToDesktop(saved))) {
        setError('发布失败，请检查存储空间')
        return false
      }

      const merged = mergeDraftIntoSession(next, draftHtmlValue, codeDirtyFlag)
      setPublishedSnapshot(draftFromSession(merged, merged.html, false))
      setError(undefined)
      return true
    },
    [publishProjectToDesktop, saveDraftInternal],
  )

  const updateSessionMeta = useCallback(
    (patch: Partial<Pick<EditorSession, 'name' | 'description' | 'category' | 'iconEmoji' | 'themeColor' | 'tags'>>) => {
      if (!session) {
        return
      }

      if (patch.name !== undefined) {
        const conflict = findProjectNameConflict(installedApps, internalProjects, patch.name, {
          excludeProjectId: session.projectId,
          excludeAppId: session.linkedAppId,
        })
        if (conflict) {
          setError(formatProjectNameConflictMessage(conflict))
          return
        }
      }

      const updated: EditorSession = { ...session, ...patch }
      setSession(updated)
      setError(undefined)

      if (patch.tags !== undefined) {
        setPreviewEpoch((epoch) => epoch + 1)
      }
    },
    [installedApps, internalProjects, session],
  )

  const onRunDraft = useCallback(() => {
    if (!session || draftHtml === session.html) {
      return
    }

    const updated: EditorSession = {
      ...session,
      html: draftHtml,
    }
    setSession(updated)
    setDraftHtml(updated.html)
    setPreviewEpoch((epoch) => epoch + 1)
  }, [draftHtml, session])

  const onApplyAppData = useCallback(() => {
    if (!session || !dataDirty || dataEditInvalid) {
      return
    }

    const updated: EditorSession = {
      ...session,
      appData: { ...draftAppData },
    }
    dataDraftEditedRef.current = false
    setSession(updated)
    setDraftAppData({ ...draftAppData })
    previewBootstrapDataRef.current = resolvePreviewBootstrapData(updated, draftAppData, false)
    setPreviewEpoch((epoch) => epoch + 1)
  }, [dataDirty, dataEditInvalid, draftAppData, session])

  const onDraftAppDataChange = useCallback((value: Record<string, string>) => {
    dataDraftEditedRef.current = true
    setDraftAppData(value)
  }, [])

  const resetEditorUi = useCallback(() => {
    setSession(undefined)
    setPublishedSnapshot(undefined)
    setDraftHtml('')
    setDraftAppData({})
    setDataEditInvalid(false)
    dataDraftEditedRef.current = false
    setPrompt('')
    setError(undefined)
    setGenerationStatus('')
    setGenerationPhase(undefined)
    setStreamReasoningText('')
    setStreamContentText('')
    setStreamVisibleReply('')
    setStreamAppliedEdits(0)
    setClosePromptOpen(false)
    setEditorTab('chat')
    setVisitedEditorTabs({ chat: true })
  }, [])

  const completePendingNavigation = useCallback(async (): Promise<void> => {
    const intent = closeIntentRef.current
    closeIntentRef.current = { type: 'list' }
    setClosePromptOpen(false)
    setClosePromptMode('close')

    if (intent.type === 'open') {
      const stored = await getInternalProject(intent.projectId)
      if (!stored) {
        return
      }

      const project = await ensureDesktopPlaceholder(stored)
      const nextSession = sessionFromInternal(project)
      setSession(nextSession)
      setPublishedSnapshot(
        loadPublishedSnapshot(
          nextSession.linkedAppId ?? resolvePublishAppId(project),
          installedApps,
          project,
        ),
      )
      setEditorTab('chat')
      setVisitedEditorTabs({ chat: true })
      setError(undefined)
      return
    }

    resetEditorUi()
    if (intent.type === 'window') {
      bypassAppCloseGuard('icode')
      closeWindowsForApp('icode')
    }
  }, [bypassAppCloseGuard, closeWindowsForApp, ensureDesktopPlaceholder, installedApps, resetEditorUi])

  const requestCloseEditor = useCallback(() => {
    closeIntentRef.current = { type: 'list' }
    if (!session) {
      void completePendingNavigation()
      return
    }

    if (hasDraftToSave) {
      setClosePromptMode('close')
      setClosePromptOpen(true)
      return
    }

    void completePendingNavigation()
  }, [completePendingNavigation, hasDraftToSave, session])

  const requestCloseWindow = useCallback(() => {
    closeIntentRef.current = { type: 'window' }
    if (!session) {
      return true
    }

    if (hasDraftToSave) {
      setClosePromptMode('close')
      setClosePromptOpen(true)
      return false
    }

    return true
  }, [hasDraftToSave, session])

  useAppCloseGuard('icode', requestCloseWindow)

  const dismissNavigateAwayPrompt = useCallback((): void => {
    closeIntentRef.current = { type: 'list' }
    setClosePromptMode('close')
    setClosePromptOpen(false)
  }, [])

  const confirmCloseDiscard = useCallback((): void => {
    void completePendingNavigation()
  }, [completePendingNavigation])

  const confirmCloseSaveDraft = useCallback(async (): Promise<void> => {
    if (session) {
      await saveDraftInternal(session, draftHtml, codeDirty)
    }
    await completePendingNavigation()
  }, [codeDirty, completePendingNavigation, draftHtml, saveDraftInternal, session])

  const closePromptActions = useMemo(
    (): WindowModalAction[] => [
      {
        key: 'save',
        label: closePromptMode === 'switch' ? '保存并打开' : '保存并关闭',
        tone: 'primary' as const,
        onClick: () => void confirmCloseSaveDraft(),
      },
      {
        key: 'discard',
        label: '放弃更改',
        tone: 'danger' as const,
        onClick: confirmCloseDiscard,
      },
      {
        key: 'continue',
        label: '继续编辑',
        tone: 'secondary' as const,
        onClick: dismissNavigateAwayPrompt,
      },
    ],
    [closePromptMode, confirmCloseDiscard, confirmCloseSaveDraft, dismissNavigateAwayPrompt],
  )

  const requestClearChat = useCallback(() => {
    if (!session || session.chat.length === 0 || generating) {
      return
    }

    setClearChatPromptOpen(true)
  }, [generating, session])

  const confirmClearChat = useCallback(() => {
    if (!session) {
      setClearChatPromptOpen(false)
      return
    }

    setSession({ ...session, chat: [] })
    setClearChatPromptOpen(false)
  }, [session])

  const onSaveDraft = useCallback(async () => {
    if (!session) {
      return
    }

    const saved = await saveDraftInternal(session, draftHtml, codeDirty)
    if (!saved) {
      setError('保存失败，请检查存储空间')
      return
    }

    const merged = mergeDraftIntoSession(session, draftHtml, codeDirty)
    setSession(merged)
    setDraftHtml(merged.html)
    setError(undefined)
  }, [codeDirty, draftHtml, saveDraftInternal, session])

  const onPublish = useCallback(async () => {
    if (!session) {
      return
    }

    if (!(await publishSessionDraft(session, draftHtml, codeDirty))) {
      return
    }

    const merged = mergeDraftIntoSession(session, draftHtml, codeDirty)
    setSession(merged)
    setDraftHtml(merged.html)
    setPublishedSnapshot(draftFromSession(merged, merged.html, false))
  }, [codeDirty, draftHtml, publishSessionDraft, session])

  const closeEditor = requestCloseEditor

  const openInternalDirect = useCallback(
    async (projectId: string): Promise<void> => {
      const stored = await getInternalProject(projectId)
      if (!stored) {
        return
      }

      const project = await ensureDesktopPlaceholder(stored)
      const nextSession = sessionFromInternal(project)
      setSession(nextSession)
      setPublishedSnapshot(
        loadPublishedSnapshot(nextSession.linkedAppId ?? resolvePublishAppId(project), installedApps, project),
      )
      setEditorTab('chat')
      setVisitedEditorTabs({ chat: true })
      setError(undefined)
    },
    [ensureDesktopPlaceholder, installedApps],
  )

  const requestOpenInternal = useCallback(
    async (projectId: string): Promise<void> => {
      if (!(await getInternalProject(projectId))) {
        return
      }

      if (session?.projectId === projectId) {
        return
      }

      if (!session) {
        await openInternalDirect(projectId)
        return
      }

      if (hasDraftToSave) {
        closeIntentRef.current = { type: 'open', projectId }
        setClosePromptMode('switch')
        setClosePromptOpen(true)
        return
      }

      await openInternalDirect(projectId)
    },
    [hasDraftToSave, openInternalDirect, session],
  )

  useEffect(() => {
    if (!pendingIcodeProjectId) {
      return
    }

    const projectId = pendingIcodeProjectId
    clearPendingIcodeProject()
    void requestOpenInternal(projectId)
  }, [pendingIcodeProjectId, requestOpenInternal, clearPendingIcodeProject])

  const requestDeleteProject = useCallback(async (projectId: string) => {
    const project = await getInternalProject(projectId)
    if (!project) {
      return
    }

    const linkedAppId = resolvePublishAppId(project)
    const linkedApp = installedApps.find((app) => app.id === linkedAppId)

    setDeleteLinkedAppToo(false)
    setDeleteTarget({
      projectId: project.id,
      name: project.name,
      linkedAppId: linkedApp ? linkedAppId : undefined,
      linkedAppName: linkedApp?.name,
    })
  }, [installedApps])

  const closeDeleteProjectModal = useCallback(() => {
    setDeleteTarget(undefined)
    setDeleteLinkedAppToo(false)
  }, [])

  const confirmDeleteProject = useCallback(async () => {
    if (!deleteTarget) {
      return
    }

    const linkedAppId = deleteLinkedAppToo ? deleteTarget.linkedAppId : undefined

    const removed = await removeInternalProject(deleteTarget.projectId)
    if (!removed) {
      setError('删除失败，项目可能已被移除')
      closeDeleteProjectModal()
      return
    }

    if (linkedAppId) {
      uninstallApp(linkedAppId)
    }

    if (session?.projectId === deleteTarget.projectId) {
      resetEditorUi()
    }

    setProjectRevision((value) => value + 1)
    closeDeleteProjectModal()
    setError(undefined)
  }, [closeDeleteProjectModal, deleteLinkedAppToo, deleteTarget, resetEditorUi, session?.projectId, uninstallApp])

  const importFromInstalled = useCallback(
    async (record: GeneratedAppRecord) => {
      const importName = resolveUniqueCopyName(record.name, installedApps, internalProjects)

      const imported = await createInternalProject(importName, record.description)
      await updateInternalProject(imported.id, {
        html: record.html,
        appData: (await import('./icode-backup.ts')).loadFormalAppData(record.id),
        iconEmoji: record.iconEmoji,
        themeColor: record.themeColor,
        tags: record.tags ?? [],
      })
      const synced = await getInternalProject(imported.id)
      if (!synced || !(await syncPlaceholderToDesktop(synced))) {
        await removeInternalProject(imported.id)
        setError('导入失败，请检查存储空间')
        return
      }

      setProjectRevision((value) => value + 1)
      setShowImportPicker(false)
      setError(undefined)
      void requestOpenInternal(imported.id)
    },
    [installedApps, internalProjects, requestOpenInternal, syncPlaceholderToDesktop],
  )

  const exportCurrentProject = useCallback(async () => {
    if (!session) {
      return
    }

    const project = await getInternalProject(session.projectId)
    if (!project) {
      return
    }

    const { buildExportBundleFromInternal, downloadBundleZip } = await import('./icode-backup.ts')
    downloadBundleZip(
      buildExportBundleFromInternal({
        ...project,
        name: session.name,
        description: session.description,
        category: session.category,
        iconEmoji: session.iconEmoji,
        themeColor: session.themeColor,
        tags: session.tags,
        html: session.html,
        appData: session.appData,
        chat: session.chat,
        linkedAppId: session.linkedAppId,
      }),
    )
  }, [session])

  const importBundle = useCallback(
    async (bundle: ICodeExportBundle) => {
      const registerImportedProject = async (
        importName: string,
        description: string,
        patch: Parameters<typeof updateInternalProject>[1],
      ): Promise<ICodeInternalProject | undefined> => {
        const conflict = findProjectNameConflict(installedApps, internalProjects, importName)
        if (conflict) {
          setImportAlert({
            title: '无法导入程序包',
            message: formatProjectNameConflictMessage(conflict),
          })
          return undefined
        }

        const imported = await createInternalProject(importName, description)
        await updateInternalProject(imported.id, patch)
        const synced = await getInternalProject(imported.id)
        if (!synced || !(await syncPlaceholderToDesktop(synced))) {
          await removeInternalProject(imported.id)
          setImportAlert({
            title: '无法导入程序包',
            message: '导入失败，请检查存储空间',
          })
          return undefined
        }

        setProjectRevision((value) => value + 1)
        setImportAlert(undefined)
        void requestOpenInternal(imported.id)
        return imported
      }

      if (bundle.kind === 'internal') {
        const project = bundle.project as ICodeInternalProject
        const existingProject = internalProjects.find((entry) => entry.id === project.id)
        if (existingProject) {
          setImportAlert({
            title: '无法导入程序包',
            message: `项目「${existingProject.name}」已在 iCode 中，无法重复导入`,
          })
          return
        }

        await registerImportedProject(project.name, project.description, {
          html: project.html,
          appData: bundle.appData,
          chat: project.chat ?? [],
          iconEmoji: project.iconEmoji,
          themeColor: project.themeColor,
          tags: project.tags,
        })
        return
      }

      const formalProject = bundle.project as {
        appId?: GeneratedAppId
        name: string
        description: string
        category: string
        iconEmoji: string
        themeColor: string
        html: string
        tags?: AppCapabilityTag[]
      }

      await registerImportedProject(`${formalProject.name}（导入）`, formalProject.description, {
        html: formalProject.html,
        appData: bundle.appData,
        iconEmoji: formalProject.iconEmoji,
        themeColor: formalProject.themeColor,
        tags: formalProject.tags ?? [],
      })
    },
    [installedApps, internalProjects, requestOpenInternal, syncPlaceholderToDesktop],
  )

  const onImportFile = useCallback(
    async (file: File | undefined) => {
      if (!file) {
        return
      }

      try {
        const bundle = await (await import('./icode-backup.ts')).readBundleFromZipFile(file)
        await importBundle(bundle)
      } catch (importError) {
        setImportAlert({
          title: '无法导入程序包',
          message: importError instanceof Error ? importError.message : '导入失败',
        })
      }
    },
    [importBundle],
  )

  const onCreateProject = useCallback(async () => {
    const trimmedName = newProjectName.trim()
    if (!trimmedName) {
      setError('请输入项目名称')
      return
    }

    const conflict = findProjectNameConflict(installedApps, internalProjects, trimmedName)
    if (conflict) {
      setError(formatProjectNameConflictMessage(conflict))
      return
    }

    const project = await createInternalProject(newProjectName, newProjectDescription)
    if (!(await syncPlaceholderToDesktop(project))) {
      await removeInternalProject(project.id)
      setError('创建失败，请检查存储空间')
      return
    }

    setProjectRevision((value) => value + 1)
    setShowNewProject(false)
    setNewProjectName('')
    setNewProjectDescription('')
    setError(undefined)
    void requestOpenInternal(project.id)
  }, [
    installedApps,
    internalProjects,
    newProjectDescription,
    newProjectName,
    requestOpenInternal,
    syncPlaceholderToDesktop,
  ])

  const resetStreamUi = useCallback(() => {
    setGenerationStatus('')
    setGenerationPhase(undefined)
    setStreamReasoningText('')
    setStreamContentText('')
    setStreamVisibleReply('')
    setStreamAppliedEdits(0)
    setGenerating(false)
  }, [])

  const applyGenerationStopped = useCallback(
    (run: { htmlBefore: string; nextChat: ICodeChatMessage[] }) => {
      const snapshot = streamSnapshotRef.current
      const hasStreamOutput = Boolean(snapshot.contentText.trim() || snapshot.reasoningText.trim())
      const fullReply = stripAiderEditBlocksFromContent(snapshot.contentText) || undefined
      const partialSummary =
        extractNaturalLanguageReply(snapshot.contentText) ||
        fullReply ||
        (snapshot.reasoningText.trim() ? '（已停止生成）' : undefined)

      if (hasStreamOutput && partialSummary) {
        const stoppedSummary = partialSummary.includes('（已停止生成）')
          ? partialSummary
          : `${partialSummary}\n\n（已停止生成）`
        const assistantMessage: ICodeChatMessage = {
          id: `assistant-${osNowMs()}`,
          role: 'assistant',
          content: stoppedSummary,
          createdAt: osNowMs(),
          reasoningText: snapshot.reasoningText || undefined,
          fullReply,
          outputText: snapshot.contentText || undefined,
          appliedEdits: snapshot.appliedEdits > 0 ? snapshot.appliedEdits : undefined,
        }

        setSession((current) =>
          current
            ? {
                ...current,
                chat: [...run.nextChat, assistantMessage],
                html: run.htmlBefore,
              }
            : current,
        )
      } else {
        setSession((current) => (current ? { ...current, html: run.htmlBefore } : current))
      }

      setDraftHtml(run.htmlBefore)
      setError(undefined)
      resetStreamUi()
    },
    [resetStreamUi],
  )

  const onCancelGeneration = useCallback(() => {
    const run = generationRunRef.current
    if (!run || run.stopped) {
      return
    }

    run.stopped = true
    run.abortController.abort()
    applyGenerationStopped(run)
    generationRunRef.current = undefined
  }, [applyGenerationStopped])

  const runPromptGeneration = useCallback(
    async (instruction: string, activeSession: EditorSession) => {
      const trimmedInstruction = instruction.trim()
      if (!trimmedInstruction || generating) {
        return
      }

      generationRunRef.current?.abortController.abort()
      const abortController = new AbortController()
      const run = {
      abortController,
      htmlBefore: codeDirty ? draftHtml : activeSession.html,
      nextChat: [] as ICodeChatMessage[],
      stopped: false,
    }
    generationRunRef.current = run

    const userMessage: ICodeChatMessage = {
      id: `user-${osNowMs()}`,
      role: 'user',
      content: trimmedInstruction,
      createdAt: osNowMs(),
    }

    const nextChat = [...activeSession.chat, userMessage]
    run.nextChat = nextChat
    run.htmlBefore = codeDirty ? draftHtml : activeSession.html
    streamSnapshotRef.current = { reasoningText: '', contentText: '', appliedEdits: 0 }
    setSession({ ...activeSession, chat: nextChat })
    setGenerating(true)
    setGenerationPhase('waiting')
    setGenerationStatus('连接 AI…')
    setStreamReasoningText('')
    setStreamContentText('')
    setStreamVisibleReply('')
    setStreamAppliedEdits(0)
    setError(undefined)

    try {
      const project = await getInternalProject(activeSession.projectId)
      if (!project) {
        throw new Error('内部项目不存在')
      }

      const requestHtml = codeDirty ? draftHtml : activeSession.html

      const { generateInternalAppHtml } = await import('./icode-generation.ts')
      const result = await generateInternalAppHtml(
        {
          ...project,
          name: activeSession.name,
          description: activeSession.description,
          category: activeSession.category,
          iconEmoji: activeSession.iconEmoji,
          themeColor: activeSession.themeColor,
          tags: activeSession.tags,
          html: requestHtml,
        },
        trimmedInstruction,
        (update) => {
          streamSnapshotRef.current = {
            reasoningText: update.reasoningText,
            contentText: update.contentText,
            appliedEdits: update.appliedEdits ?? 0,
          }
          setGenerationPhase(update.phase)
          setStreamReasoningText(update.reasoningText)
          setStreamContentText(update.contentText)
          setStreamVisibleReply(update.visibleReply ?? '')
          setStreamAppliedEdits(update.appliedEdits ?? 0)
          const editLabel =
            update.appliedEdits !== undefined && update.appliedEdits > 0
              ? ` · 已应用 ${update.appliedEdits} 处修改`
              : ''
          setGenerationStatus(`${generationStatusLabel(update.phase, update.progress)}${editLabel}`)
          if (update.partialHtml) {
            setSession((current) =>
              current ? { ...current, html: update.partialHtml! } : current,
            )
            setDraftHtml(update.partialHtml!)
          }
        },
        activeSession.chat,
        { signal: abortController.signal },
      )

      const fullReply = stripAiderEditBlocksFromContent(result.outputText ?? '') || undefined
      const displaySummary =
        extractNaturalLanguageReply(result.outputText ?? '') ||
        fullReply ||
        result.assistantSummary ||
        ''

      const assistantMessage: ICodeChatMessage = {
        id: `assistant-${osNowMs()}`,
        role: 'assistant',
        content: displaySummary,
        createdAt: osNowMs(),
        reasoningText: result.reasoningText,
        fullReply,
        outputText: result.outputText,
        edits: result.edits,
        appliedEdits: result.appliedEdits,
        capabilityRequests: buildChatCapabilityRequests(
          result.outputText ?? '',
          activeSession.tags,
          result.html,
        ),
      }

      const htmlChanged = result.html !== run.htmlBefore
      const updated: EditorSession = {
        ...activeSession,
        chat: [...nextChat, assistantMessage],
        html: htmlChanged ? result.html : activeSession.html,
      }

      setSession(updated)
      if (htmlChanged) {
        setDraftHtml(updated.html)
        setPreviewEpoch((epoch) => epoch + 1)
      }
      setGenerationStatus('')
      setGenerationPhase(undefined)
      setStreamReasoningText('')
      setStreamContentText('')
      setStreamVisibleReply('')
      setStreamAppliedEdits(0)
    } catch (generationError) {
      if (run.stopped || isIcodeGenerationAbortedError(generationError, abortController.signal)) {
        if (!run.stopped) {
          applyGenerationStopped(run)
        }
      } else {
        setError(generationError instanceof Error ? generationError.message : '生成失败')
        resetStreamUi()
      }
    } finally {
      if (generationRunRef.current === run) {
        generationRunRef.current = undefined
      }
      if (!run.stopped) {
        setGenerating(false)
      }
    }
    },
    [applyGenerationStopped, codeDirty, draftHtml, generating, resetStreamUi],
  )

  const onSendPrompt = useCallback(async () => {
    const instruction = prompt.trim()
    if (!instruction || !session) {
      return
    }

    setPrompt('')
    await runPromptGeneration(instruction, session)
  }, [prompt, runPromptGeneration, session])

  const onGrantCapabilityRequest = useCallback(
    async (messageId: string, requestIndex: number, tag: GrantableIcodeCapabilityTag) => {
      if (!session || generating) {
        return
      }

      const targetMessage = session.chat.find((message) => message.id === messageId)
      const request = targetMessage?.capabilityRequests?.[requestIndex]
      if (!request || request.status !== 'pending') {
        return
      }

      const nextTags = mergeSessionTagsWithCapability(session.tags, tag)
      const nextChat = session.chat.map((message) => {
        if (message.role !== 'assistant' || !message.capabilityRequests) {
          return message
        }

        return {
          ...message,
          capabilityRequests: message.capabilityRequests.map((item) =>
            item.tag === tag && item.status === 'pending'
              ? { ...item, status: 'granted' as const }
              : item,
          ),
        }
      })

      const updatedSession: EditorSession = {
        ...session,
        tags: nextTags,
        chat: nextChat,
      }

      setSession(updatedSession)
      setPreviewEpoch((epoch) => epoch + 1)

      await runPromptGeneration(
        `已授予${formatGrantableCapabilityLabel(tag)}，请继续完成之前的请求。`,
        updatedSession,
      )
    },
    [generating, runPromptGeneration, session],
  )

  const onDismissCapabilityRequest = useCallback(
    (messageId: string, requestIndex: number) => {
      if (!session) {
        return
      }

      setSession({
        ...session,
        chat: session.chat.map((message) => {
          if (message.id !== messageId || !message.capabilityRequests) {
            return message
          }

          return {
            ...message,
            capabilityRequests: message.capabilityRequests.map((request, index) =>
              index === requestIndex && request.status === 'pending'
                ? { ...request, status: 'dismissed' as const }
                : request,
            ),
          }
        }),
      })
    },
    [session],
  )

  const menuBar = useMemo((): MenuDefinition[] => {
    const fileItems = session
      ? [
          {
            type: 'action' as const,
            label: '保存草稿',
            shortcut: '⌘S',
            onClick: () => void onSaveDraft(),
          },
          {
            type: 'action' as const,
            label: '发布到桌面',
            shortcut: '⇧⌘P',
            onClick: () => void onPublish(),
          },
          { type: 'separator' as const },
          {
            type: 'action' as const,
            label: '关闭项目',
            onClick: closeEditor,
          },
          { type: 'separator' as const },
          {
            type: 'action' as const,
            label: '导出程序包…',
            onClick: () => void exportCurrentProject(),
          },
          {
            type: 'action' as const,
            label: '导入程序包…',
            onClick: () => importInputRef.current?.click(),
          },
        ]
      : [
          {
            type: 'action' as const,
            label: '从已安装应用导入…',
            onClick: () => setShowImportPicker(true),
          },
          {
            type: 'action' as const,
            label: '导入程序包…',
            onClick: () => importInputRef.current?.click(),
          },
        ]

    return [
      {
        label: '文件',
        items: fileItems,
      },
    ]
  }, [
    closeEditor,
    exportCurrentProject,
    onPublish,
    onSaveDraft,
    session,
  ])

  useAppMenuBar('icode', menuBar)

  const deleteProjectModal = (
    <WindowModal
      open={!!deleteTarget}
      title="删除内部项目"
      role="alertdialog"
      themeColor={ICODE_CHROME_ACCENT}
      onClose={closeDeleteProjectModal}
      actions={[
        {
          key: 'cancel',
          label: '取消',
          tone: 'secondary',
          onClick: closeDeleteProjectModal,
        },
        {
          key: 'delete',
          label: '删除',
          tone: 'danger',
          onClick: () => void confirmDeleteProject(),
        },
      ]}
    >
      {deleteTarget && (
        <>
          <p class="window-modal__message">
            确定删除「{deleteTarget.name}」吗？此操作不可恢复。
            {deleteTarget.linkedAppId
              ? ' 默认仅删除 iCode 项目，桌面应用可保留。'
              : ' 此项目未关联已安装的桌面应用。'}
          </p>
          {deleteTarget.linkedAppId && deleteTarget.linkedAppName && (
            <label class="icode__delete-linked-app">
              <input
                type="checkbox"
                checked={deleteLinkedAppToo}
                onChange={(event) =>
                  setDeleteLinkedAppToo((event.currentTarget as HTMLInputElement).checked)
                }
              />
              <span>同时从桌面卸载「{deleteTarget.linkedAppName}」</span>
            </label>
          )}
        </>
      )}
    </WindowModal>
  )

  if (!session) {
    const modalTheme = ICODE_CHROME_ACCENT

    return (
      <div ref={hostRef} class="icode">
        <WindowModalTheme themeColor={modalTheme} />
        <input
          ref={importInputRef}
          class="icode__hidden-input"
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => {
            const input = event.currentTarget as HTMLInputElement
            void onImportFile(input.files?.[0])
            input.value = ''
          }}
        />

        <div class="icode__picker">
          <header class="icode__hero">
            <div class="icode__hero-top">
              <div class="icode__hero-icon" aria-hidden="true">
                <ICodeIcon size={52} />
              </div>
              <div class="icode__hero-copy">
                <h1 class="icode__picker-title">iCode</h1>
                <p class="icode__picker-subtitle">
                  在系统内开发、调试 AI 微应用。编辑仅在 iCode 内预览，发布后才更新桌面入口。
                </p>
              </div>
            </div>
          </header>

          <div class="icode__picker-body">
            <div class="icode__picker-actions">
              <button
                type="button"
                class="icode__button icode__button--primary"
                onClick={() => setShowNewProject(true)}
              >
                新建内部项目
              </button>
              <button
                type="button"
                class="icode__button icode__button--secondary"
                onClick={() => setShowImportPicker(true)}
                disabled={installedApps.length === 0}
              >
                从已安装应用导入…
              </button>
              <button
                type="button"
                class="icode__button icode__button--secondary"
                onClick={() => importInputRef.current?.click()}
              >
                导入程序包…
              </button>
            </div>

            {error && <p class="icode__error">{error}</p>}

            <section class="icode__section">
              <h2 class="icode__section-title">内部应用</h2>
              <div class="icode__list">
                {internalProjects.length === 0 ? (
                  <p class="icode__list--empty">暂无内部项目。点击「新建内部项目」开始开发。</p>
                ) : (
                  internalProjects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      class="icode__row"
                      onClick={() => void requestOpenInternal(project.id)}
                    >
                      <span class="icode__row-icon" aria-hidden="true">
                        <GeneratedAppIcon
                          emoji={project.iconEmoji || '📦'}
                          themeColor={project.themeColor}
                          size={36}
                        />
                      </span>
                      <span class="icode__row-main">
                        <span class="icode__row-name">{project.name}</span>
                        {project.description && (
                          <span class="icode__row-desc">{project.description}</span>
                        )}
                        <span class="icode__row-meta">
                          <span class="icode__badge">iCode</span>
                          <span>
                            {formatProjectDate(project.updatedAt)}
                            {htmlHasContent(project.html)
                              ? ` · ${project.html.length.toLocaleString('zh-CN')} 字符`
                              : ' · 尚未生成'}
                          </span>
                        </span>
                      </span>
                      <span class="icode__row-disclosure" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  ))
                )}
              </div>
              <p class="icode__section-footnote">
                每个项目会在桌面创建占位入口。在 iCode 中编辑后需「发布到桌面」才会更新外部应用。
              </p>
            </section>
          </div>
        </div>

        <WindowModal
          open={showImportPicker}
          title="从已安装应用导入"
          wide
          scrollBody
          themeColor={modalTheme}
          onClose={() => setShowImportPicker(false)}
          actions={[
            {
              key: 'cancel',
              label: '取消',
              tone: 'secondary',
              onClick: () => setShowImportPicker(false),
            },
          ]}
        >
          <p class="window-modal__message">
            将创建独立的 iCode 副本进行编辑，与原应用无关联，也不会修改桌面上的原应用。
          </p>
          <div class="icode__list">
            {installedApps.map((app) => (
              <button
                key={app.id}
                type="button"
                class="icode__row"
                onClick={() => void importFromInstalled(app)}
              >
                <span class="icode__row-icon" aria-hidden="true">
                  <GeneratedAppIcon emoji={app.iconEmoji} themeColor={app.themeColor} size={36} />
                </span>
                <span class="icode__row-main">
                  <span class="icode__row-name">{app.name}</span>
                  {app.description && <span class="icode__row-desc">{app.description}</span>}
                  <span class="icode__row-meta">
                    {isIcodeManagedInstalledApp(app, internalProjects) ? (
                      <span class="icode__badge">iCode</span>
                    ) : (
                      <span class="icode__badge icode__badge--formal">正式</span>
                    )}
                    <span>{app.version ? app.version : '已安装'}</span>
                  </span>
                </span>
                <span class="icode__row-disclosure" aria-hidden="true">
                  ›
                </span>
              </button>
            ))}
          </div>
        </WindowModal>

        <WindowModal
          open={showNewProject}
          title="新建内部项目"
          themeColor={modalTheme}
          onClose={() => setShowNewProject(false)}
          actions={[
            {
              key: 'cancel',
              label: '取消',
              tone: 'secondary',
              onClick: () => setShowNewProject(false),
            },
            {
              key: 'create',
              label: '创建并打开',
              tone: 'primary',
              disabled: !newProjectName.trim(),
              onClick: () => void onCreateProject(),
            },
          ]}
        >
          <div class="window-modal__field">
            <label for="icode-new-name">项目名称</label>
            <input
              id="icode-new-name"
              type="text"
              value={newProjectName}
              placeholder="例如：待办清单"
              onInput={(event) => setNewProjectName((event.currentTarget as HTMLInputElement).value)}
            />
          </div>
          <div class="window-modal__field">
            <label for="icode-new-desc">应用描述</label>
            <textarea
              id="icode-new-desc"
              value={newProjectDescription}
              placeholder="描述你想让 AI 生成的应用功能与界面…"
              onInput={(event) =>
                setNewProjectDescription((event.currentTarget as HTMLTextAreaElement).value)
              }
            />
          </div>
        </WindowModal>

        {deleteProjectModal}

        <WindowModal
          open={!!importAlert}
          title={importAlert?.title ?? ''}
          role="alertdialog"
          themeColor={modalTheme}
          onClose={() => setImportAlert(undefined)}
          actions={[
            {
              key: 'ok',
              label: '好',
              tone: 'primary',
              onClick: () => setImportAlert(undefined),
            },
          ]}
        >
          {importAlert && <p class="window-modal__message">{importAlert.message}</p>}
        </WindowModal>
      </div>
    )
  }

  const modalTheme = ICODE_CHROME_ACCENT

  return (
    <div
      ref={hostRef}
      class="icode"
      style={{ '--app-accent': session.themeColor }}
    >
      <WindowModalTheme themeColor={modalTheme} />
      <input
        ref={importInputRef}
        class="icode__hidden-input"
        type="file"
        accept=".zip,application/zip"
        onChange={(event) => {
          const input = event.currentTarget as HTMLInputElement
          void onImportFile(input.files?.[0])
          input.value = ''
        }}
      />

      <div class="icode__editor">
        <nav class="icode__nav">
          <IosNavBackButton class="icode__nav-back" label="项目" onClick={closeEditor} />
          <p
            class={`icode__nav-hint icode__nav-hint--${editorNavHint.tone}`}
            title={editorNavHint.message}
          >
            {editorNavHint.message}
          </p>
          <div class="icode__nav-actions">
            {generating ? (
              <button
                type="button"
                class="icode__button icode__button--secondary icode__nav-stop"
                onClick={onCancelGeneration}
              >
                停止
              </button>
            ) : (
              <>
                <button
                  type="button"
                  class="icode__button icode__button--secondary icode__nav-save"
                  disabled={!hasDraftToSave}
                  onClick={() => void onSaveDraft()}
                >
                  保存
                </button>
                <button
                  type="button"
                  class="icode__button icode__button--primary icode__nav-publish"
                  disabled={!publishDirty}
                  onClick={() => void onPublish()}
                >
                  发布
                </button>
                {codeDirty && (
                  <button
                    type="button"
                    class="icode__button icode__button--run icode__nav-run"
                    disabled={!htmlHasContent(draftHtml)}
                    onClick={onRunDraft}
                  >
                    运行
                  </button>
                )}
              </>
            )}
            <span class="icode__kind-pill">iCode</span>
          </div>
        </nav>

        {error && <p class="icode__error">{error}</p>}

        <div class={`icode__editor-body icode__editor-body--mobile-${mobilePane}`}>
          <div class="icode__preview">
            <p class="icode__preview-label">应用预览</p>
            <div class={`icode__preview-screen${previewFrozen ? ' icode__preview-screen--unresponsive' : ''}`}>
              {!htmlHasContent(session.html) && !codeEditingActive && (
                <div class="icode__preview-empty">
                  <span class="icode__preview-empty-icon" aria-hidden="true">
                    💬
                  </span>
                  <span>
                    在「对话」中输入提示词，
                    <br />
                    让 AI 生成或修改此应用。
                  </span>
                </div>
              )}
              {codeEditingActive && !showStreamOutput && (
                <div class="icode__preview-overlay">{generationStatus || '生成中…'}</div>
              )}
              {codeEditingActive && (
                <AiStreamPreview
                  reasoningText={showStreamOutput ? streamReasoningText : ''}
                  contentText={showStreamOutput ? streamContentText : ''}
                  variant="safari"
                  emptyLabel={generationStatus || '连接 AI…'}
                  className="icode__stream-preview"
                />
              )}
              <iframe
                ref={iframeRef}
                class={`icode__frame${htmlHasContent(session.html) ? '' : ' icode__frame--hidden'}`}
                title={`${session.name} 预览`}
                {...iframeProps}
              />
              {previewFrozen && (
                <div class="icode__preview-unresponsive-overlay" aria-hidden="true">
                  预览未响应
                </div>
              )}
            </div>
          </div>

          <aside class="icode__panel">
            <div class="icode__segmented-wrap">
              <SegmentedControl
                value={editorTab}
                ariaLabel="调试面板"
                items={[
                  { id: 'chat', label: '对话' },
                  { id: 'source', label: '源码', dirty: codeDirty },
                  { id: 'config', label: '配置' },
                  { id: 'data', label: '数据', dirty: dataDirty },
                  {
                    id: 'console',
                    label: '日志',
                    badge: consoleLogs.length > 0 ? consoleLogs.length : undefined,
                  },
                ]}
                onChange={setEditorTab}
              />
            </div>

            <div class="icode__tab-body">
              <div class="icode__tab-pane" hidden={editorTab !== 'chat'}>
                <div class="icode__panel-toolbar">
                  <span>
                    {session.chat.length} 条消息（{formatTokenCount(contextPayload.characters)} 字符 · 约{' '}
                    {formatTokenCount(contextPayload.tokens)} tokens）
                    {generating ? ' · 生成中…' : ''}
                  </span>
                  <button
                    type="button"
                    class="icode__panel-action"
                    disabled={session.chat.length === 0 || generating}
                    onClick={requestClearChat}
                  >
                    清空对话
                  </button>
                </div>
                <div ref={chatListRef} class="icode__chat-messages">
                  {session.chat.length === 0 && !generating ? (
                    <p class="icode__chat-empty">
                      输入提示词开始生成。
                      <br />
                      首次生成会创建完整应用；之后可提问或描述修改，AI 会先回复，需要时才会改代码。
                    </p>
                  ) : (
                    <IcodeDeferredGate
                      load={loadIcodeChatMessages}
                      fallback={<IcodeHeavyFallback label="正在加载对话…" />}
                    >
                      {(mod) => {
                        const ChatMessageView = mod.IcodeChatMessageView
                        const ChatAssistantMessage = mod.IcodeChatAssistantMessage
                        return (
                          <>
                            {session.chat.map((message) => (
                              <ChatMessageView
                                key={message.id}
                                message={message}
                                grantedTags={session.tags}
                                onGrantCapabilityRequest={(messageId, requestIndex, tag) =>
                                  void onGrantCapabilityRequest(messageId, requestIndex, tag)
                                }
                                onDismissCapabilityRequest={onDismissCapabilityRequest}
                              />
                            ))}
                            {generating && (
                              <ChatAssistantMessage
                                summary=""
                                visibleReply={streamVisibleReply || undefined}
                                reasoningText={streamReasoningText || undefined}
                                outputText={streamContentText || undefined}
                                edits={streamEdits.length > 0 ? streamEdits : undefined}
                                appliedEdits={streamAppliedEdits}
                                editStreaming={codeEditingActive}
                                streaming
                                phase={generationPhase}
                                grantedTags={session.tags}
                              />
                            )}
                          </>
                        )
                      }}
                    </IcodeDeferredGate>
                  )}
                </div>
                <div class="icode__chat-compose">
                  <textarea
                    class="icode__chat-input"
                    value={prompt}
                    placeholder="描述要生成或修改的内容…"
                    disabled={generating}
                    onInput={(event) =>
                      setPrompt((event.currentTarget as HTMLTextAreaElement).value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault()
                        void onSendPrompt()
                      }
                    }}
                  />
                  <div class="icode__chat-compose-actions">
                    {generating ? (
                      <button
                        type="button"
                        class="icode__button icode__button--secondary icode__chat-send icode__chat-stop"
                        onClick={onCancelGeneration}
                      >
                        停止
                      </button>
                    ) : (
                      <button
                        type="button"
                        class="icode__button icode__button--primary icode__chat-send"
                        disabled={!prompt.trim()}
                        onClick={() => void onSendPrompt()}
                      >
                        发送
                      </button>
                    )}
                    <p class="icode__chat-hint">{generating ? '生成中…' : '⌘↵ 发送'}</p>
                  </div>
                </div>
              </div>

              <div class="icode__tab-pane" hidden={editorTab !== 'source'}>
                <div class="icode__panel-toolbar icode__panel-toolbar--source">
                  <span>{draftHtml.length.toLocaleString('zh-CN')} 字符</span>
                  {codeDirty && (
                    <span class="icode__run-hint">源码已修改，点击「运行」更新左侧预览</span>
                  )}
                  <button
                    type="button"
                    class="icode__button icode__button--run icode__run-button"
                    disabled={!codeDirty || !htmlHasContent(draftHtml) || generating}
                    onClick={onRunDraft}
                  >
                    运行
                  </button>
                </div>
                {(editorTab === 'source' || visitedEditorTabs.source) && (
                  <IcodeMonacoEditor
                    value={draftHtml}
                    onChange={setDraftHtml}
                    active={editorTab === 'source'}
                  />
                )}
              </div>

              <div class="icode__tab-pane" hidden={editorTab !== 'config'}>
                <div class="icode__config">
                  <section class="icode__config-section">
                    <h4 class="icode__config-heading">基本信息</h4>
                    <div class="icode__config-inset">
                      <div class="icode__config-item">
                        <label for="icode-config-name">应用名称</label>
                        <input
                          id="icode-config-name"
                          type="text"
                          value={session.name}
                          onInput={(event) =>
                            updateSessionMeta({
                              name: (event.currentTarget as HTMLInputElement).value,
                            })
                          }
                        />
                      </div>
                      <div class="icode__config-item">
                        <label for="icode-config-desc">应用描述</label>
                        <textarea
                          id="icode-config-desc"
                          value={session.description}
                          onInput={(event) =>
                            updateSessionMeta({
                              description: (event.currentTarget as HTMLTextAreaElement).value,
                            })
                          }
                        />
                      </div>
                      <div class="icode__config-item">
                        <label for="icode-config-internal-id">内部标识</label>
                        <input
                          id="icode-config-internal-id"
                          type="text"
                          class="icode__config-readonly"
                          value={session.projectId}
                          readOnly
                        />
                        <p class="icode__config-note">
                          创建时自动生成，用于区分应用，不可修改。上方「应用名称」可随时更改。
                        </p>
                      </div>
                    </div>
                  </section>

                  <section class="icode__config-section">
                    <h4 class="icode__config-heading">外观</h4>
                    <div class="icode__config-inset">
                      <div class="icode__config-item icode__config-item--appearance">
                        <div class="icode__config-appearance">
                          <span class="icode__config-icon-preview" aria-hidden="true">
                            <GeneratedAppIcon
                              emoji={session.iconEmoji || '📦'}
                              themeColor={session.themeColor}
                              size={52}
                            />
                          </span>
                          <div class="icode__config-appearance-copy">
                            <span class="icode__config-item-label">图标</span>
                            {(editorTab === 'config' || visitedEditorTabs.config) ? (
                              <EmojiPickerPopover
                                value={session.iconEmoji || '📦'}
                                triggerLabel="选择表情"
                                onChange={(emoji) => updateSessionMeta({ iconEmoji: emoji })}
                              />
                            ) : (
                              <span class="icode__config-note">{session.iconEmoji || '📦'}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div class="icode__config-item">
                        <span class="icode__config-item-label">主题色</span>
                        <div class="icode__config-colors" role="radiogroup" aria-label="主题色">
                          {ICODE_THEME_COLOR_PRESETS.map((color) => {
                            const selected = session.themeColor.toLowerCase() === color
                            return (
                              <button
                                key={color}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                aria-label={color}
                                class={`icode__config-color${selected ? ' icode__config-color--selected' : ''}`}
                                style={{ backgroundColor: color }}
                                onClick={() => updateSessionMeta({ themeColor: color })}
                              />
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </section>

                  <section class="icode__config-section">
                    <h4 class="icode__config-heading">程序生成能力</h4>
                    <p class="icode__config-section-hint">
                      授予能力后，AI在生成程序时可以使用对应的能力。
                    </p>
                    <div class="icode__config-inset">
                      <div class="icode__config-toggle-row">
                        <div class="icode__config-toggle-copy">
                          <strong>3D 能力</strong>
                          <span>允许 AI 使用 3D 引擎</span>
                        </div>
                        <IosSwitch
                          label="启用 3D 模块"
                          checked={hasAppCapabilityTag(session.tags, APP_CAPABILITY_TAG_3D)}
                          onChange={(enabled) => {
                            const baseTags = filterAppCapabilityTags(session.tags)
                            const tags = enabled
                              ? [...baseTags.filter((tag) => tag !== APP_CAPABILITY_TAG_3D), APP_CAPABILITY_TAG_3D]
                              : baseTags.filter((tag) => tag !== APP_CAPABILITY_TAG_3D)
                            updateSessionMeta({ tags })
                          }}
                        />
                      </div>
                      <div class="icode__config-toggle-row">
                        <div class="icode__config-toggle-copy">
                          <strong>运行时 AI 能力</strong>
                          <span>AI 可以在他编写的 App 中(运行时)调用 AI 能力</span>
                        </div>
                        <IosSwitch
                          label="启用 AI 模块"
                          checked={hasAppCapabilityTag(session.tags, APP_CAPABILITY_TAG_AI)}
                          onChange={(enabled) => {
                            const baseTags = filterAppCapabilityTags(session.tags)
                            const tags = enabled
                              ? [...baseTags.filter((tag) => tag !== APP_CAPABILITY_TAG_AI), APP_CAPABILITY_TAG_AI]
                              : baseTags.filter((tag) => tag !== APP_CAPABILITY_TAG_AI)
                            updateSessionMeta({ tags })
                          }}
                        />
                      </div>
                      <div class="icode__config-toggle-row">
                        <div class="icode__config-toggle-copy">
                          <strong>文件访问能力</strong>
                          <span>AI 可以在他编写的 App 中通过 InstantOS.files 读写系统文件</span>
                        </div>
                        <IosSwitch
                          label="启用文件模块"
                          checked={hasAppCapabilityTag(session.tags, APP_CAPABILITY_TAG_FILES)}
                          onChange={(enabled) => {
                            const baseTags = filterAppCapabilityTags(session.tags)
                            const tags = enabled
                              ? [
                                  ...baseTags.filter((tag) => tag !== APP_CAPABILITY_TAG_FILES),
                                  APP_CAPABILITY_TAG_FILES,
                                ]
                              : baseTags.filter((tag) => tag !== APP_CAPABILITY_TAG_FILES)
                            updateSessionMeta({ tags })
                          }}
                        />
                      </div>
                      <div class="icode__config-toggle-row">
                        <div class="icode__config-toggle-copy">
                          <strong>终端能力</strong>
                          <span>AI 可以在他编写的 App 中通过 InstantOS.terminal 使用系统终端会话</span>
                        </div>
                        <IosSwitch
                          label="启用终端模块"
                          checked={hasAppCapabilityTag(session.tags, APP_CAPABILITY_TAG_TERMINAL)}
                          onChange={(enabled) => {
                            const baseTags = filterAppCapabilityTags(session.tags)
                            const tags = enabled
                              ? [
                                  ...baseTags.filter((tag) => tag !== APP_CAPABILITY_TAG_TERMINAL),
                                  APP_CAPABILITY_TAG_TERMINAL,
                                ]
                              : baseTags.filter((tag) => tag !== APP_CAPABILITY_TAG_TERMINAL)
                            updateSessionMeta({ tags })
                          }}
                        />
                      </div>
                    </div>
                  </section>

                  <section class="icode__config-section icode__config-section--danger">
                    <h4 class="icode__config-heading">删除项目</h4>
                    <div class="icode__config-inset icode__config-inset--danger">
                      <p class="icode__config-danger-copy">
                        永久删除此 iCode 项目的源码、聊天记录与本地数据。若项目已发布到桌面，可选择是否同时卸载应用入口。
                      </p>
                      <div class="icode__config-item icode__config-item--action">
                        <button
                          type="button"
                          class="icode__button icode__button--danger icode__button--block"
                          onClick={() => void requestDeleteProject(session.projectId)}
                        >
                          删除此项目…
                        </button>
                      </div>
                    </div>
                  </section>
                </div>
              </div>

              <div class="icode__tab-pane" hidden={editorTab !== 'data'}>
                <div class="icode__panel-toolbar icode__panel-toolbar--source">
                  <span>{Object.keys(draftAppData).length} 个键</span>
                  {dataEditInvalid && (
                    <span class="icode__run-hint">当前键的值格式无效</span>
                  )}
                  {!dataEditInvalid && dataDirty && (
                    <span class="icode__run-hint">数据已修改，点击「应用」更新左侧预览</span>
                  )}
                  <button
                    type="button"
                    class="icode__button icode__button--run icode__run-button"
                    disabled={!dataDirty || dataEditInvalid || generating}
                    onClick={onApplyAppData}
                  >
                    应用
                  </button>
                </div>
                {(editorTab === 'data' || visitedEditorTabs.data) && (
                  <IcodeAppDataEditor
                    value={draftAppData}
                    onChange={onDraftAppDataChange}
                    active={editorTab === 'data'}
                    onInvalidChange={setDataEditInvalid}
                    narrowLayout={narrowLayout}
                  />
                )}
              </div>

              <div class="icode__tab-pane" hidden={editorTab !== 'console'}>
                <div class="icode__panel-toolbar">
                  <span>{consoleLogs.length} 条输出</span>
                  <button
                    type="button"
                    class="icode__panel-action"
                    disabled={consoleLogs.length === 0}
                    onClick={() => setConsoleLogs([])}
                  >
                    清空
                  </button>
                </div>
                <div ref={consoleListRef} class="icode__console-list">
                  {consoleLogs.length === 0 ? (
                    <p class="icode__console-empty">应用内日志、提示、错误等输出将显示在这里。</p>
                  ) : (
                    consoleLogs.map((entry) => (
                      <div key={entry.id} class={`icode__console-line icode__console-line--${entry.level}`}>
                        <span class="icode__console-time">
                          {new Date(entry.timestamp).toLocaleTimeString('zh-CN', {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </span>
                        <span class="icode__console-level">{CONSOLE_LEVEL_LABELS[entry.level]}</span>
                        <pre class="icode__console-text">{entry.text}</pre>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>

        <nav class="icode__mobile-dock" aria-label="编辑视图">
          <button
            type="button"
            class={`icode__mobile-dock-item${mobilePane === 'preview' ? ' icode__mobile-dock-item--active' : ''}`}
            aria-current={mobilePane === 'preview' ? 'page' : undefined}
            onClick={() => setMobilePane('preview')}
          >
            预览
          </button>
          <button
            type="button"
            class={`icode__mobile-dock-item${mobilePane === 'edit' ? ' icode__mobile-dock-item--active' : ''}${codeDirty || dataDirty ? ' icode__mobile-dock-item--dirty' : ''}`}
            aria-current={mobilePane === 'edit' ? 'page' : undefined}
            onClick={() => setMobilePane('edit')}
          >
            编辑
          </button>
        </nav>
      </div>

      {deleteProjectModal}

      <WindowModal
        open={clearChatPromptOpen}
        title="清空对话"
        role="alertdialog"
        themeColor={modalTheme}
        onClose={() => setClearChatPromptOpen(false)}
        actions={[
          {
            key: 'cancel',
            label: '取消',
            tone: 'secondary',
            onClick: () => setClearChatPromptOpen(false),
          },
          {
            key: 'clear',
            label: '清空',
            tone: 'danger',
            onClick: confirmClearChat,
          },
        ]}
      >
        <p class="window-modal__message">
          确定清空当前项目的对话记录吗？此操作不会修改源码；保存草稿后才会永久生效。
        </p>
      </WindowModal>

      <WindowModal
        open={closePromptOpen}
        title={navigateAwayPrompt.title}
        role="alertdialog"
        themeColor={modalTheme}
        onClose={dismissNavigateAwayPrompt}
        actions={closePromptActions}
      >
        <p class="window-modal__message">{navigateAwayPrompt.message}</p>
      </WindowModal>

      <WindowModal
        open={!!importAlert}
        title={importAlert?.title ?? ''}
        role="alertdialog"
        themeColor={modalTheme}
        onClose={() => setImportAlert(undefined)}
        actions={[
          {
            key: 'ok',
            label: '好',
            tone: 'primary',
            onClick: () => setImportAlert(undefined),
          },
        ]}
      >
        {importAlert && <p class="window-modal__message">{importAlert.message}</p>}
      </WindowModal>
    </div>
  )
}
