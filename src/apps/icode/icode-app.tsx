import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { AiStreamPreview } from '../../ai/ai-stream-preview.tsx'
import { ICodeIcon } from '../../icons/app-icons.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { GeneratedAppIcon } from '../generated/generated-app-icon.tsx'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { isGeneratedAppStorageMessage } from '../../os/generated-app-data-storage.ts'
import { useGeneratedApps } from '../../os/generated-apps-context.tsx'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs, useAppCloseGuard } from '../../os/os-context.tsx'
import type { GeneratedAppId } from '../../os/types.ts'
import { ensureIframeBlankDocument, writeHtmlToIframe } from '../../assets/3d/write-html-to-iframe.ts'
import {
  APP_CAPABILITY_TAG_3D,
  filterAppCapabilityTags,
  hasAppCapabilityTag,
} from '../appstore/app-capability-tags.ts'
import type { AppCapabilityTag } from '../appstore/app-capability-tags.ts'
import type { GeneratedAppRecord } from '../appstore/types.ts'
import {
  buildExportBundleFromInternal,
  downloadBundleZip,
  loadFormalAppData,
  readBundleFromZipFile,
} from './icode-backup.ts'
import {
  draftFromInternalProject,
  draftFromSession,
  draftSnapshotsEqual,
  isPublishDirty,
  loadPublishedSnapshot,
  type ICodePublishedSnapshot,
} from './icode-draft.ts'
import { buildIcodeClosePromptHint, buildIcodeEditorNavHint } from './icode-editor-nav-hint.ts'
import { generateInternalAppHtml } from './icode-generation.ts'
import type { AppGenerationPhase } from '../appstore/generate-app-stream.ts'
import { parseAiderEditBlocks, stripAiderEditBlocksFromContent, extractFinalReplyAfterEdits } from './icode-apply-edits.ts'
import { IcodeChatAssistantMessage, IcodeChatMessageView } from './icode-chat-message.tsx'
import {
  buildIcodeSyncInput,
  buildIcodePlaceholderSyncInput,
  findProjectNameConflict,
  formatProjectNameConflictMessage,
  resolvePublishAppId,
} from './icode-publish.ts'
import { generatedAppNeeds3d } from '../generated/generated-app-tags.ts'
import { prepareIcodePreviewHtml } from './prepare-icode-preview-html.ts'
import {
  createInternalProject,
  getInternalProject,
  loadInternalProjects,
  previewAppIdForInternal,
  removeInternalProject,
  updateInternalProject,
} from './icode-storage.ts'
import { appendConsoleEntry, isIcodeConsoleMessage } from './icode-console.ts'
import type {
  ICodeChatMessage,
  ICodeConsoleEntry,
  ICodeExportBundle,
  ICodeInternalProject,
} from './icode-types.ts'
import { IcodeAppDataEditor } from './icode-app-data-editor.tsx'
import { appDataRecordsEqual } from './icode-app-data-value.ts'
import { IcodeMonacoEditor } from './icode-monaco-editor.tsx'
import { EmojiPickerPopover } from '../../ui/emoji-picker-popover.tsx'
import './icode.css'

type EditorTab = 'chat' | 'source' | 'config' | 'data' | 'console'
type MobileEditorPane = 'preview' | 'edit'

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

function sessionToInternalProject(session: EditorSession, draftHtml: string, codeDirty: boolean): ICodeInternalProject {
  const merged = mergeDraftIntoSession(session, draftHtml, codeDirty)
  const stored = getInternalProject(session.projectId)
  const now = Date.now()
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

export function ICodeApp() {
  const { setAppWindowTitle, closeWindowsForApp, minimizeWindow, windows, bypassAppCloseGuard } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const { installedApps, syncAppFromIcode } = useGeneratedApps()

  const [projectRevision, setProjectRevision] = useState(0)
  const [session, setSession] = useState<EditorSession | undefined>()
  const [editorTab, setEditorTab] = useState<EditorTab>('chat')
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
  const [importErrorMessage, setImportErrorMessage] = useState<string | undefined>()
  const [showNewProject, setShowNewProject] = useState(false)
  const [showImportPicker, setShowImportPicker] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<
    { projectId: string; name: string; linkedAppId?: GeneratedAppId } | undefined
  >()
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDescription, setNewProjectDescription] = useState('')
  const [previewEpoch, setPreviewEpoch] = useState(0)
  const [draftHtml, setDraftHtml] = useState('')
  const [draftAppData, setDraftAppData] = useState<Record<string, string>>({})
  const [dataEditInvalid, setDataEditInvalid] = useState(false)
  const dataDraftEditedRef = useRef(false)
  const [consoleLogs, setConsoleLogs] = useState<ICodeConsoleEntry[]>([])
  const [publishedSnapshot, setPublishedSnapshot] = useState<ICodePublishedSnapshot | undefined>()
  const [closePromptOpen, setClosePromptOpen] = useState(false)
  const closeIntentRef = useRef<'list' | 'window'>('list')

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const previewWindowRef = useRef<Window | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const consoleListRef = useRef<HTMLDivElement>(null)
  const chatListRef = useRef<HTMLDivElement>(null)
  const previewBootstrapDataRef = useRef<Record<string, string>>({})

  const internalProjects = useMemo(() => loadInternalProjects(), [projectRevision])

  const syncPlaceholderToDesktop = useCallback(
    (project: ICodeInternalProject): boolean => {
      const appId = resolvePublishAppId(project)
      const linkedProject = project.linkedAppId ? project : { ...project, linkedAppId: appId }
      if (!project.linkedAppId) {
        updateInternalProject(project.id, { linkedAppId: appId })
      }
      return syncAppFromIcode(buildIcodePlaceholderSyncInput(linkedProject))
    },
    [syncAppFromIcode],
  )

  const publishProjectToDesktop = useCallback(
    (project: ICodeInternalProject): boolean => {
      const appId = resolvePublishAppId(project)
      const linkedProject = project.linkedAppId ? project : { ...project, linkedAppId: appId }
      if (!project.linkedAppId) {
        updateInternalProject(project.id, { linkedAppId: appId })
      }
      return syncAppFromIcode(buildIcodeSyncInput(linkedProject))
    },
    [syncAppFromIcode],
  )

  const migratedProjectsRef = useRef(false)
  useEffect(() => {
    if (migratedProjectsRef.current) {
      return
    }
    migratedProjectsRef.current = true

    let changed = false
    for (const project of loadInternalProjects()) {
      const appId = resolvePublishAppId(project)
      let current = project
      if (!project.linkedAppId) {
        const patched = updateInternalProject(project.id, { linkedAppId: appId })
        if (patched) {
          current = patched
          changed = true
        }
      }

      const installed = installedApps.find((app) => app.id === resolvePublishAppId(current))
      if (!installed) {
        syncPlaceholderToDesktop(current)
        changed = true
      }
    }

    if (changed) {
      setProjectRevision((value) => value + 1)
    }
  }, [installedApps, syncPlaceholderToDesktop])

  const previewAppId = session ? previewAppIdForSession(session) : undefined
  const codeDirty = session !== undefined && draftHtml !== session.html
  const dataDirty = Boolean(session && !appDataRecordsEqual(draftAppData, session.appData))
  const currentDraft = session ? draftFromSession(session, draftHtml, codeDirty) : undefined
  const storedProject = session ? getInternalProject(session.projectId) : undefined
  const publishDirty =
    Boolean(session && publishedSnapshot && currentDraft) &&
    isPublishDirty(currentDraft!, publishedSnapshot!)
  const internalSaveDirty =
    Boolean(session && storedProject && currentDraft) &&
    !draftSnapshotsEqual(currentDraft!, draftFromInternalProject(storedProject!))
  const chatDirty =
    Boolean(session && storedProject) &&
    JSON.stringify(session!.chat) !== JSON.stringify(storedProject!.chat)
  const hasUnsavedWork = publishDirty || internalSaveDirty || chatDirty
  const streamEdits = useMemo(
    () => (streamContentText ? parseAiderEditBlocks(streamContentText) : []),
    [streamContentText],
  )

  const codeEditingActive = useMemo(() => {
    if (!generating || !session) {
      return false
    }

    if (!session.html.trim()) {
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
  const closePromptHint = useMemo(
    () =>
      buildIcodeClosePromptHint({
        codeDirty,
        publishDirty,
        internalSaveDirty,
        chatDirty,
        currentDraft,
        publishedSnapshot,
      }),
    [chatDirty, codeDirty, currentDraft, internalSaveDirty, publishDirty, publishedSnapshot],
  )

  const streamingSummary = useMemo(() => {
    if (generationPhase === 'thinking') {
      return '思考中…'
    }
    if (generationPhase === 'generating') {
      return streamEdits.length > 0
        ? `正在应用修改（${streamEdits.length} 处）…`
        : '生成中…'
    }
    return generationStatus || '连接 AI…'
  }, [generationPhase, generationStatus, streamEdits.length])

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
    if (!session?.html.trim()) {
      return
    }

    previewBootstrapDataRef.current = { ...session.appData }
    setConsoleLogs([])
    setPreviewEpoch((epoch) => epoch + 1)
  }, [session?.html, session?.projectId])

  const preparedHtml = useMemo(() => {
    if (!session || !previewAppId || !session.html.trim()) {
      return undefined
    }

    return prepareIcodePreviewHtml(session.html, previewAppId, previewBootstrapDataRef.current, {
      name: session.name,
      description: session.description,
      category: session.category,
      tags: session.tags,
    })
  }, [
    previewEpoch,
    previewAppId,
    session?.html,
    session?.name,
    session?.description,
    session?.category,
    session?.tags,
  ])

  const needs3d = session
    ? generatedAppNeeds3d(session.html, {
        name: session.name,
        description: session.description,
        category: session.category,
        tags: session.tags,
      })
    : false

  const syncPreviewWindow = useCallback(() => {
    previewWindowRef.current = iframeRef.current?.contentWindow ?? null
  }, [])

  const writePreviewToIframe = useCallback(() => {
    if (!preparedHtml) {
      return
    }

    if (needs3d) {
      writeHtmlToIframe(iframeRef.current, preparedHtml)
      syncPreviewWindow()
      return
    }

    const frame = iframeRef.current
    if (frame) {
      frame.srcdoc = preparedHtml
    }
    syncPreviewWindow()
  }, [needs3d, preparedHtml, syncPreviewWindow])

  useEffect(() => {
    if (!session) {
      setAppWindowTitle('icode', 'iCode')
      return
    }

    setAppWindowTitle('icode', `${session.name} — iCode`)
  }, [session, setAppWindowTitle])

  useEffect(() => {
    if (!preparedHtml) {
      return
    }

    if (needs3d) {
      ensureIframeBlankDocument(iframeRef.current)
    }

    writePreviewToIframe()
  }, [needs3d, preparedHtml, previewEpoch, writePreviewToIframe])

  useEffect(() => {
    if (!previewAppId) {
      return
    }

    const onMessage = (event: MessageEvent) => {
      if (isIcodeConsoleMessage(event.data)) {
        if (event.data.appId !== previewAppId) {
          return
        }

        setConsoleLogs((current) => appendConsoleEntry(current, event.data))
        return
      }

      const previewWindow =
        previewWindowRef.current ?? iframeRef.current?.contentWindow ?? undefined
      if (event.source !== previewWindow) {
        return
      }

      if (!isGeneratedAppStorageMessage(event.data)) {
        return
      }

      if (event.data.appId !== previewAppId) {
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
  }, [previewAppId])

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

  useEffect(() => {
    const container = chatListRef.current
    if (!container || editorTab !== 'chat') {
      return
    }

    const scrollToBottom = () => {
      container.scrollTop = container.scrollHeight
    }

    scrollToBottom()
    const frame = window.requestAnimationFrame(scrollToBottom)

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(scrollToBottom)
    })
    resizeObserver.observe(container)

    const mutationObserver = new MutationObserver(() => {
      window.requestAnimationFrame(scrollToBottom)
    })
    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [
    editorTab,
    session?.chat,
    session?.projectId,
    generating,
    streamReasoningText,
    streamContentText,
    streamVisibleReply,
    streamAppliedEdits,
    generationPhase,
  ])

  const saveDraftInternal = useCallback(
    (next: EditorSession, draftHtmlValue: string, codeDirtyFlag: boolean) => {
      const project = sessionToInternalProject(next, draftHtmlValue, codeDirtyFlag)
      const updated = updateInternalProject(project.id, {
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
      return updated
    },
    [],
  )

  const publishSessionDraft = useCallback(
    (next: EditorSession, draftHtmlValue: string, codeDirtyFlag: boolean): boolean => {
      const saved = saveDraftInternal(next, draftHtmlValue, codeDirtyFlag)
      if (!saved) {
        setError('保存草稿失败，请检查存储空间')
        return false
      }

      if (!publishProjectToDesktop(saved)) {
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

  const revertDraftToPublished = useCallback(
    (targetSession: EditorSession, snapshot: ICodePublishedSnapshot) => {
      const stored = getInternalProject(targetSession.projectId)
      const reverted: EditorSession = {
        ...targetSession,
        name: snapshot.name,
        description: snapshot.description,
        category: snapshot.category,
        iconEmoji: snapshot.iconEmoji,
        themeColor: snapshot.themeColor,
        tags: [...snapshot.tags],
        html: snapshot.html,
        appData: { ...snapshot.appData },
        chat: stored ? [...stored.chat] : [...targetSession.chat],
      }
      saveDraftInternal(reverted, snapshot.html, false)
      return reverted
    },
    [saveDraftInternal],
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
    previewBootstrapDataRef.current = { ...draftAppData }
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
  }, [])

  const finishCloseEditor = useCallback(() => {
    const shouldCloseWindow = closeIntentRef.current === 'window'
    closeIntentRef.current = 'list'
    resetEditorUi()
    if (shouldCloseWindow) {
      bypassAppCloseGuard('icode')
      closeWindowsForApp('icode')
    }
  }, [bypassAppCloseGuard, closeWindowsForApp, resetEditorUi])

  const requestCloseEditor = useCallback(() => {
    closeIntentRef.current = 'list'
    if (!session) {
      finishCloseEditor()
      return
    }

    if (hasUnsavedWork) {
      setClosePromptOpen(true)
      return
    }

    finishCloseEditor()
  }, [finishCloseEditor, hasUnsavedWork, session])

  const requestCloseWindow = useCallback(() => {
    closeIntentRef.current = 'window'
    if (!session) {
      return true
    }

    if (hasUnsavedWork) {
      setClosePromptOpen(true)
      return false
    }

    return true
  }, [hasUnsavedWork, session])

  useAppCloseGuard('icode', requestCloseWindow)

  const confirmCloseDiscard = useCallback(() => {
    if (!session) {
      finishCloseEditor()
      return
    }

    const snapshot =
      publishedSnapshot ??
      loadPublishedSnapshot(
        session.linkedAppId ?? resolvePublishAppId(sessionToInternalProject(session, draftHtml, codeDirty)),
        installedApps,
        session,
      )
    revertDraftToPublished(session, snapshot)
    finishCloseEditor()
  }, [
    codeDirty,
    draftHtml,
    finishCloseEditor,
    installedApps,
    publishedSnapshot,
    revertDraftToPublished,
    session,
  ])

  const confirmCloseSaveDraft = useCallback(() => {
    if (!session) {
      finishCloseEditor()
      return
    }

    saveDraftInternal(session, draftHtml, codeDirty)
    finishCloseEditor()
  }, [codeDirty, draftHtml, finishCloseEditor, saveDraftInternal, session])

  const confirmClosePublish = useCallback(() => {
    if (!session) {
      finishCloseEditor()
      return
    }

    if (publishSessionDraft(session, draftHtml, codeDirty)) {
      finishCloseEditor()
    }
  }, [codeDirty, draftHtml, finishCloseEditor, publishSessionDraft, session])

  const onSaveDraft = useCallback(() => {
    if (!session) {
      return
    }

    const saved = saveDraftInternal(session, draftHtml, codeDirty)
    if (!saved) {
      setError('保存失败，请检查存储空间')
      return
    }

    const merged = mergeDraftIntoSession(session, draftHtml, codeDirty)
    setSession(merged)
    setDraftHtml(merged.html)
    setError(undefined)
  }, [codeDirty, draftHtml, saveDraftInternal, session])

  const onPublish = useCallback(() => {
    if (!session) {
      return
    }

    if (!publishSessionDraft(session, draftHtml, codeDirty)) {
      return
    }

    const merged = mergeDraftIntoSession(session, draftHtml, codeDirty)
    setSession(merged)
    setDraftHtml(merged.html)
    setPublishedSnapshot(draftFromSession(merged, merged.html, false))
  }, [codeDirty, draftHtml, publishSessionDraft, session])

  const closeEditor = requestCloseEditor

  const openInternal = useCallback(
    (projectId: string) => {
      const project = getInternalProject(projectId)
      if (!project) {
        return
      }

      const nextSession = sessionFromInternal(project)
      setSession(nextSession)
      setPublishedSnapshot(
        loadPublishedSnapshot(nextSession.linkedAppId ?? resolvePublishAppId(project), installedApps, project),
      )
      setEditorTab('chat')
      setError(undefined)
    },
    [installedApps],
  )

  const requestDeleteProject = useCallback((projectId: string) => {
    const project = getInternalProject(projectId)
    if (!project) {
      return
    }

    setDeleteTarget({
      projectId: project.id,
      name: project.name,
      linkedAppId: project.linkedAppId,
    })
  }, [])

  const confirmDeleteProject = useCallback(() => {
    if (!deleteTarget) {
      return
    }

    const removed = removeInternalProject(deleteTarget.projectId)
    if (!removed) {
      setError('删除失败，项目可能已被移除')
      setDeleteTarget(undefined)
      return
    }

    if (session?.projectId === deleteTarget.projectId) {
      setSession(undefined)
      setDraftHtml('')
      setPrompt('')
      setGenerationStatus('')
    }

    setProjectRevision((value) => value + 1)
    setDeleteTarget(undefined)
    setError(undefined)
  }, [deleteTarget, session?.projectId])

  const importFromInstalled = useCallback(
    (record: GeneratedAppRecord) => {
      const importName = `${record.name}（副本）`
      const conflict = findProjectNameConflict(installedApps, internalProjects, importName)
      if (conflict) {
        setError(formatProjectNameConflictMessage(conflict))
        return
      }

      const imported = createInternalProject(importName, record.description)
      updateInternalProject(imported.id, {
        html: record.html,
        appData: loadFormalAppData(record.id),
        iconEmoji: record.iconEmoji,
        themeColor: record.themeColor,
        tags: record.tags ?? [],
      })
      const synced = getInternalProject(imported.id)
      if (!synced || !syncPlaceholderToDesktop(synced)) {
        removeInternalProject(imported.id)
        setError('导入失败，请检查存储空间')
        return
      }

      setProjectRevision((value) => value + 1)
      setShowImportPicker(false)
      setError(undefined)
      openInternal(imported.id)
    },
    [installedApps, internalProjects, openInternal, syncPlaceholderToDesktop],
  )

  const exportCurrentProject = useCallback(() => {
    if (!session) {
      return
    }

    const project = getInternalProject(session.projectId)
    if (!project) {
      return
    }

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
      const registerImportedProject = (importName: string, description: string, patch: Parameters<typeof updateInternalProject>[1]) => {
        const conflict = findProjectNameConflict(installedApps, internalProjects, importName)
        if (conflict) {
          setImportErrorMessage(formatProjectNameConflictMessage(conflict))
          return undefined
        }

        const imported = createInternalProject(importName, description)
        updateInternalProject(imported.id, patch)
        const synced = getInternalProject(imported.id)
        if (!synced || !syncPlaceholderToDesktop(synced)) {
          removeInternalProject(imported.id)
          setImportErrorMessage('导入失败，请检查存储空间')
          return undefined
        }

        setProjectRevision((value) => value + 1)
        setImportErrorMessage(undefined)
        openInternal(imported.id)
        return imported
      }

      if (bundle.kind === 'internal') {
        const project = bundle.project as ICodeInternalProject
        registerImportedProject(project.name, project.description, {
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

      registerImportedProject(`${formalProject.name}（导入）`, formalProject.description, {
        html: formalProject.html,
        appData: bundle.appData,
        iconEmoji: formalProject.iconEmoji,
        themeColor: formalProject.themeColor,
        tags: formalProject.tags ?? [],
      })
    },
    [installedApps, internalProjects, openInternal, syncPlaceholderToDesktop],
  )

  const onImportFile = useCallback(
    async (file: File | undefined) => {
      if (!file) {
        return
      }

      try {
        const bundle = await readBundleFromZipFile(file)
        await importBundle(bundle)
        setImportErrorMessage(undefined)
      } catch (importError) {
        setImportErrorMessage(importError instanceof Error ? importError.message : '导入失败')
      }
    },
    [importBundle],
  )

  const onCreateProject = useCallback(() => {
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

    const project = createInternalProject(newProjectName, newProjectDescription)
    if (!syncPlaceholderToDesktop(project)) {
      removeInternalProject(project.id)
      setError('创建失败，请检查存储空间')
      return
    }

    setProjectRevision((value) => value + 1)
    setShowNewProject(false)
    setNewProjectName('')
    setNewProjectDescription('')
    setError(undefined)
    openInternal(project.id)
  }, [
    installedApps,
    internalProjects,
    newProjectDescription,
    newProjectName,
    openInternal,
    syncPlaceholderToDesktop,
  ])

  const onSendPrompt = useCallback(async () => {
    const instruction = prompt.trim()
    if (!instruction || !session || generating) {
      return
    }

    const userMessage: ICodeChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: instruction,
      createdAt: Date.now(),
    }

    const nextChat = [...session.chat, userMessage]
    setSession({ ...session, chat: nextChat })
    setPrompt('')
    setGenerating(true)
    setGenerationPhase('waiting')
    setGenerationStatus('连接 AI…')
    setStreamReasoningText('')
    setStreamContentText('')
    setStreamVisibleReply('')
    setStreamAppliedEdits(0)
    setError(undefined)

    try {
      const project = getInternalProject(session.projectId)
      if (!project) {
        throw new Error('内部项目不存在')
      }

      const result = await generateInternalAppHtml(
        {
          ...project,
          name: session.name,
          description: session.description,
          category: session.category,
          iconEmoji: session.iconEmoji,
          themeColor: session.themeColor,
          tags: session.tags,
          html: session.html,
        },
        instruction,
        (update) => {
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
      )

      const htmlBefore = codeDirty ? draftHtml : session.html
      const fullReply = stripAiderEditBlocksFromContent(result.outputText ?? '') || undefined
      const displaySummary =
        result.assistantSummary ||
        extractFinalReplyAfterEdits(result.outputText ?? '') ||
        fullReply ||
        ''

      const assistantMessage: ICodeChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: displaySummary,
        createdAt: Date.now(),
        reasoningText: result.reasoningText,
        fullReply,
        outputText: result.outputText,
        edits: result.edits,
        appliedEdits: result.appliedEdits,
      }

      const htmlChanged = result.html !== htmlBefore
      const updated: EditorSession = {
        ...session,
        chat: [...nextChat, assistantMessage],
        html: htmlChanged ? result.html : session.html,
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
      setError(generationError instanceof Error ? generationError.message : '生成失败')
      setGenerationStatus('')
      setGenerationPhase(undefined)
      setStreamReasoningText('')
      setStreamContentText('')
      setStreamVisibleReply('')
      setStreamAppliedEdits(0)
    } finally {
      setGenerating(false)
    }
  }, [codeDirty, draftHtml, generating, prompt, session])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === 'icode' && !window.minimized)

    const fileItems = session
      ? [
          {
            type: 'action' as const,
            label: '保存草稿',
            shortcut: '⌘S',
            onClick: onSaveDraft,
          },
          {
            type: 'action' as const,
            label: '发布到桌面',
            shortcut: '⇧⌘P',
            onClick: onPublish,
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
            onClick: exportCurrentProject,
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
      {
        label: 'iCode',
        items: [
          ...aboutAppMenuPrefix('关于 iCode', () => showBuiltinAbout('icode')),
          {
            type: 'action',
            label: '隐藏 iCode',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出 iCode',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp('icode'),
          },
        ],
      },
    ]
  }, [
    closeEditor,
    closeWindowsForApp,
    exportCurrentProject,
    minimizeWindow,
    onPublish,
    onSaveDraft,
    session,
    showBuiltinAbout,
    windows,
  ])

  useAppMenuBar('icode', menuBar)

  const deleteConfirmModal = deleteTarget ? (
    <div class="icode__modal-backdrop">
      <div class="icode__modal" role="alertdialog" aria-labelledby="icode-delete-title">
        <div class="icode__modal-header">
          <h3 id="icode-delete-title">删除内部项目</h3>
        </div>
        <div class="icode__modal-body">
          <p class="icode__modal-hint">
            确定删除「{deleteTarget.name}」吗？此操作不可恢复。桌面上的应用入口不会被卸载。
          </p>
        </div>
        <div class="icode__modal-actions">
          <button
            type="button"
            class="icode__button icode__button--secondary"
            onClick={() => setDeleteTarget(undefined)}
          >
            取消
          </button>
          <button
            type="button"
            class="icode__button icode__button--danger"
            onClick={confirmDeleteProject}
          >
            删除
          </button>
        </div>
      </div>
    </div>
  ) : undefined

  const importErrorModal = importErrorMessage ? (
    <div class="icode__modal-backdrop">
      <div class="icode__modal" role="alertdialog" aria-labelledby="icode-import-error-title">
        <div class="icode__modal-header">
          <h3 id="icode-import-error-title">无法导入程序包</h3>
        </div>
        <div class="icode__modal-body">
          <p class="icode__modal-hint">{importErrorMessage}</p>
        </div>
        <div class="icode__modal-actions">
          <button
            type="button"
            class="icode__button icode__button--primary"
            onClick={() => setImportErrorMessage(undefined)}
          >
            好
          </button>
        </div>
      </div>
    </div>
  ) : undefined

  const closeConfirmModal = closePromptOpen ? (
    <div class="icode__modal-backdrop">
      <div class="icode__modal" role="alertdialog" aria-labelledby="icode-close-title">
        <div class="icode__modal-header">
          <h3 id="icode-close-title">有未保存的更改</h3>
        </div>
        <div class="icode__modal-body">
          <p class="icode__modal-hint">{closePromptHint}</p>
        </div>
        <div class="icode__modal-actions icode__modal-actions--stack">
          <button
            type="button"
            class="icode__button icode__button--primary"
            onClick={confirmClosePublish}
          >
            发布到桌面并关闭
          </button>
          <button
            type="button"
            class="icode__button icode__button--secondary"
            onClick={confirmCloseSaveDraft}
          >
            保存草稿并关闭
          </button>
          <button
            type="button"
            class="icode__button icode__button--danger"
            onClick={confirmCloseDiscard}
          >
            放弃更改
          </button>
          <button
            type="button"
            class="icode__button icode__button--secondary"
            onClick={() => setClosePromptOpen(false)}
          >
            继续编辑
          </button>
        </div>
      </div>
    </div>
  ) : undefined

  if (!session) {
    return (
      <div class="icode">
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
                      onClick={() => openInternal(project.id)}
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
                            {project.html.trim()
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

        {showImportPicker && (
          <div class="icode__modal-backdrop">
            <div class="icode__modal icode__modal--wide" role="dialog" aria-labelledby="icode-import-title">
              <div class="icode__modal-header">
                <h3 id="icode-import-title">从已安装应用导入</h3>
              </div>
              <div class="icode__modal-body icode__modal-body--list">
                <p class="icode__modal-hint">
                  将创建独立的 iCode 副本进行编辑，与原应用无关联，也不会修改桌面上的原应用。
                </p>
                <div class="icode__list">
                  {installedApps.map((app) => (
                    <button
                      key={app.id}
                      type="button"
                      class="icode__row"
                      onClick={() => importFromInstalled(app)}
                    >
                      <span class="icode__row-icon" aria-hidden="true">
                        <GeneratedAppIcon
                          emoji={app.iconEmoji}
                          themeColor={app.themeColor}
                          size={36}
                        />
                      </span>
                      <span class="icode__row-main">
                        <span class="icode__row-name">{app.name}</span>
                        {app.description && <span class="icode__row-desc">{app.description}</span>}
                        <span class="icode__row-meta">
                          <span class="icode__badge icode__badge--formal">正式</span>
                          <span>{app.version ? app.version : '已安装'}</span>
                        </span>
                      </span>
                      <span class="icode__row-disclosure" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div class="icode__modal-actions">
                <button
                  type="button"
                  class="icode__button icode__button--secondary"
                  onClick={() => setShowImportPicker(false)}
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        {showNewProject && (
          <div class="icode__modal-backdrop">
            <div class="icode__modal" role="dialog" aria-labelledby="icode-new-title">
              <div class="icode__modal-header">
                <h3 id="icode-new-title">新建内部项目</h3>
              </div>
              <div class="icode__modal-body">
                <div class="icode__field">
                  <label for="icode-new-name">项目名称</label>
                  <input
                    id="icode-new-name"
                    type="text"
                    value={newProjectName}
                    placeholder="例如：待办清单"
                    onInput={(event) =>
                      setNewProjectName((event.currentTarget as HTMLInputElement).value)
                    }
                  />
                </div>
                <div class="icode__field icode__field--stacked">
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
              </div>
              <div class="icode__modal-actions">
                <button
                  type="button"
                  class="icode__button icode__button--secondary"
                  onClick={() => setShowNewProject(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  class="icode__button icode__button--primary"
                  disabled={!newProjectName.trim()}
                  onClick={onCreateProject}
                >
                  创建并打开
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteConfirmModal}
        {importErrorModal}
      </div>
    )
  }

  return (
    <div class="icode">
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
            <button
              type="button"
              class="icode__button icode__button--secondary icode__nav-save"
              disabled={!hasUnsavedWork || generating}
              onClick={onSaveDraft}
            >
              保存
            </button>
            <button
              type="button"
              class="icode__button icode__button--primary icode__nav-publish"
              disabled={!publishDirty || generating}
              onClick={onPublish}
            >
              发布
            </button>
            {codeDirty && (
              <button
                type="button"
                class="icode__button icode__button--run icode__nav-run"
                disabled={!draftHtml.trim() || generating}
                onClick={onRunDraft}
              >
                运行
              </button>
            )}
            <span class="icode__kind-pill">iCode</span>
          </div>
        </nav>

        {error && <p class="icode__error">{error}</p>}

        <div class={`icode__editor-body icode__editor-body--mobile-${mobilePane}`}>
          <div class="icode__preview">
            <p class="icode__preview-label">应用预览</p>
            <div class="icode__preview-screen">
              {!session.html.trim() && !codeEditingActive && (
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
                key={
                  previewAppId
                    ? needs3d
                      ? `${previewAppId}-${previewEpoch}-3d`
                      : `${previewAppId}-${previewEpoch}`
                    : 'icode-preview'
                }
                ref={iframeRef}
                class={`icode__frame${session.html.trim() ? '' : ' icode__frame--hidden'}`}
                title={`${session.name} 预览`}
                sandbox={needs3d ? 'allow-scripts allow-same-origin' : 'allow-scripts'}
                src={needs3d ? 'about:blank' : undefined}
                srcDoc={needs3d ? undefined : preparedHtml}
                onLoad={() => {
                  syncPreviewWindow()
                  if (needs3d) {
                    writePreviewToIframe()
                  }
                }}
              />
            </div>
          </div>

          <aside class="icode__panel">
            <div class="icode__segmented-wrap">
              <div class="icode__segmented" role="tablist" aria-label="调试面板">
                <button
                  type="button"
                  role="tab"
                  aria-selected={editorTab === 'chat'}
                  class={`icode__segment${editorTab === 'chat' ? ' icode__segment--active' : ''}`}
                  onClick={() => setEditorTab('chat')}
                >
                  对话
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={editorTab === 'source'}
                  class={`icode__segment${editorTab === 'source' ? ' icode__segment--active' : ''}${codeDirty ? ' icode__segment--dirty' : ''}`}
                  onClick={() => setEditorTab('source')}
                >
                  源码
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={editorTab === 'config'}
                  class={`icode__segment${editorTab === 'config' ? ' icode__segment--active' : ''}`}
                  onClick={() => setEditorTab('config')}
                >
                  配置
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={editorTab === 'data'}
                  class={`icode__segment${editorTab === 'data' ? ' icode__segment--active' : ''}${dataDirty ? ' icode__segment--dirty' : ''}`}
                  onClick={() => setEditorTab('data')}
                >
                  数据
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={editorTab === 'console'}
                  class={`icode__segment${editorTab === 'console' ? ' icode__segment--active' : ''}`}
                  onClick={() => setEditorTab('console')}
                >
                  日志
                  {consoleLogs.length > 0 && (
                    <span class="icode__segment-badge">{consoleLogs.length}</span>
                  )}
                </button>
              </div>
            </div>

            <div class="icode__tab-body">
              <div class="icode__tab-pane" hidden={editorTab !== 'chat'}>
                <div ref={chatListRef} class="icode__chat-messages">
                  {session.chat.length === 0 ? (
                    <p class="icode__chat-empty">
                      输入提示词开始生成。
                      <br />
                      首次生成会创建完整应用；之后可提问或描述修改，AI 会先回复，需要时才会改代码。
                    </p>
                  ) : (
                    session.chat.map((message) => (
                      <IcodeChatMessageView key={message.id} message={message} />
                    ))
                  )}
                  {generating && (
                    <IcodeChatAssistantMessage
                      summary=""
                      visibleReply={streamVisibleReply || undefined}
                      reasoningText={streamReasoningText || undefined}
                      outputText={streamContentText || undefined}
                      edits={streamEdits.length > 0 ? streamEdits : undefined}
                      appliedEdits={streamAppliedEdits}
                      streaming
                      phase={generationPhase}
                      statusLabel={generationStatus || streamingSummary}
                    />
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
                    <button
                      type="button"
                      class="icode__button icode__button--primary icode__chat-send"
                      disabled={generating || !prompt.trim()}
                      onClick={() => void onSendPrompt()}
                    >
                      发送
                    </button>
                    <p class="icode__chat-hint">⌘↵ 发送</p>
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
                    disabled={!codeDirty || !draftHtml.trim() || generating}
                    onClick={onRunDraft}
                  >
                    运行
                  </button>
                </div>
                <IcodeMonacoEditor
                  value={draftHtml}
                  onChange={setDraftHtml}
                  active={editorTab === 'source'}
                />
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
                            <EmojiPickerPopover
                              value={session.iconEmoji || '📦'}
                              triggerLabel="选择表情"
                              onChange={(emoji) => updateSessionMeta({ iconEmoji: emoji })}
                            />
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
                    <h4 class="icode__config-heading">运行时能力</h4>
                    <div class="icode__config-inset">
                      <label class="icode__config-toggle-row">
                        <span class="icode__config-toggle-copy">
                          <strong>启用 3D 模块</strong>
                          <span>为预览注入 Three.js 桥接与 WebGL 运行时支持</span>
                        </span>
                        <input
                          type="checkbox"
                          checked={hasAppCapabilityTag(session.tags, APP_CAPABILITY_TAG_3D)}
                          onChange={(event) => {
                            const enabled = (event.currentTarget as HTMLInputElement).checked
                            const baseTags = filterAppCapabilityTags(session.tags)
                            const tags = enabled
                              ? [...baseTags.filter((tag) => tag !== APP_CAPABILITY_TAG_3D), APP_CAPABILITY_TAG_3D]
                              : baseTags.filter((tag) => tag !== APP_CAPABILITY_TAG_3D)
                            updateSessionMeta({ tags })
                          }}
                        />
                      </label>
                    </div>
                  </section>

                  <section class="icode__config-section icode__config-section--danger">
                    <h4 class="icode__config-heading">删除项目</h4>
                    <div class="icode__config-inset icode__config-inset--danger">
                      <p class="icode__config-danger-copy">
                        永久删除此 iCode 项目的源码、聊天记录与本地数据。桌面上的应用入口不会被卸载。
                      </p>
                      <div class="icode__config-item icode__config-item--action">
                        <button
                          type="button"
                          class="icode__button icode__button--danger icode__button--block"
                          onClick={() => requestDeleteProject(session.projectId)}
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
                <IcodeAppDataEditor
                  value={draftAppData}
                  onChange={onDraftAppDataChange}
                  active={editorTab === 'data'}
                  onInvalidChange={setDataEditInvalid}
                />
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

      {deleteConfirmModal}
      {closeConfirmModal}
      {importErrorModal}
    </div>
  )
}
