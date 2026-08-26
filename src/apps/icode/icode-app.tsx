import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { ComponentChildren, ComponentType } from 'preact'
import { osNowMs } from '../../os/os-clock.ts'
import { ICodeIcon } from '../../icons/app-icons.tsx'
import { IosNavBackButton } from '../../ui/ios-nav-back-button.tsx'
import { IosSwitch } from '../../ui/ios-switch.tsx'
import { SegmentedControl } from '../../ui/segmented-control.tsx'
import { GeneratedAppIcon } from '../generated/generated-app-icon.tsx'
import { buildSiteDocument, EMPTY_SITE_DOCUMENT } from '../generated/generated-app-site-html.ts'
import {
  buildProjectErrorDocument,
  buildProjectPreviewDocument,
  detectProjectEntry,
} from './icode-project-build.ts'
import { readVersionFileBytes } from '../../os/generated-app-versions-layout.ts'
import {
  runIcodeTypeCheck,
  type IcodeTypeCheckDiagnostic,
} from './icode-type-check.ts'
import type { MonacoProblem } from '../../monaco/monaco-markers.ts'
import { EXPERIMENTAL_SETTINGS_CHANGED_EVENT } from '../../os/experimental-settings-storage.ts'
import {
  isGeneratedAppStorageMessage,
  loadGeneratedAppData,
  saveGeneratedAppDataAsync,
} from '../../os/generated-app-data-storage.ts'
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
  appVersionDirPath,
  SITE_ENTRY_FILE,
  type GeneratedAppVersionManifest,
} from '../../os/generated-app-versions-layout.ts'
import {
  ensureIcodeDraftSnapshot,
  getIcodeMaxFormalVersion,
  listIcodeFormalVersions,
  saveIcodeDraftSnapshot,
  type IcodeDraftFile,
} from '../../os/icode-managed-apps.ts'
import { subscribeFilesWatch } from '../files/files-watch.ts'
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
  findAppNameConflict,
  formatAppNameConflictMessage,
  isIcodeManagedApp,
  resolveUniqueCopyName,
} from './icode-publish.ts'
import { toIcodeCapabilityTags, type IcodeCapabilityTag } from './icode-agent.ts'
import { IcodeAiChatPanel } from './icode-ai-chat-panel.tsx'
import { ProdudeTerminalHost } from '../produde/produde-terminal-host.tsx'
import type { ProdudeTerminalHostApi } from '../produde/produde-terminal-host.tsx'
import { installGeneratedAppAiHandler } from '../generated/install-generated-app-ai-handler.ts'
import { installGeneratedAppFilesHandler } from '../generated/install-generated-app-files-handler.ts'
import { installGeneratedAppTerminalHandler } from '../generated/install-generated-app-terminal-handler.ts'
import { injectGeneratedAppHeartbeatBridge } from '../generated/inject-generated-app-heartbeat-bridge.ts'
import { useGeneratedHtmlIframe } from '../generated/use-generated-html-iframe.ts'
import { prepareIcodePreviewHtml } from './prepare-icode-preview-html.ts'
import { appendConsoleEntry, isIcodeConsoleMessage } from './icode-console.ts'
import {
  isGeneratedAppRuntimeErrorMessage,
  logRuntimeErrorToHostConsole,
} from '../generated/generated-app-runtime-errors.ts'
import {
  ICODE_CONSOLE_MESSAGE_TYPE,
  type ICodeConsoleEntry,
} from './icode-types.ts'
import { useIcodeNarrowLayout } from './icode-layout.ts'
import { appDataRecordsEqual } from './icode-app-data-value.ts'
import { WindowModal, type WindowModalAction } from '../../window/window-modal.tsx'
import { WindowModalTheme } from '../../window/window-modal-context.tsx'
import './icode.css'
import '../vscode/vscode-ai.css'

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

type EditorTab = 'chat' | 'source' | 'config' | 'versions' | 'data' | 'console'
type MobileEditorPane = 'preview' | 'edit'

type IcodeNavigationIntent =
  | { type: 'list' }
  | { type: 'window' }
  | { type: 'open'; appId: GeneratedAppId }

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

const CONSOLE_LEVEL_LABELS: Record<ICodeConsoleEntry['level'], string> = {
  log: '日志',
  info: 'INFO',
  warn: '提示',
  error: '错误',
  debug: 'DBG',
}

/**
 * 编辑会话：草稿树的应用内工作副本。
 * `files` 是「已应用到预览」的文件集合；`draftFiles` 是源码页正在编辑的工作副本，
 * 点「运行」应用进预览。manifest 字段是草稿清单的工作副本（改名字/图标不漏到桌面，
 * 发布升格后才成为新最大号的对外身份）。
 */
type EditorSession = {
  appId: GeneratedAppId
  manifest: GeneratedAppVersionManifest
  files: IcodeDraftFile[]
  binaryFiles: Array<{ path: string; byteSize: number }>
  publishedVersion: number
}

function draftFilesEqual(left: IcodeDraftFile[], right: IcodeDraftFile[]): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]!.path !== right[index]!.path || left[index]!.text !== right[index]!.text) {
      return false
    }
  }
  return true
}

function manifestMetaEqual(
  left: GeneratedAppVersionManifest,
  right: GeneratedAppVersionManifest,
): boolean {
  return (
    left.name === right.name &&
    left.description === right.description &&
    left.category === right.category &&
    left.iconEmoji === right.iconEmoji &&
    left.themeColor === right.themeColor &&
    (left.tags ?? []).join(',') === (right.tags ?? []).join(',')
  )
}

function filesToResources(files: readonly IcodeDraftFile[]): Map<string, Uint8Array> {
  const encoder = new TextEncoder()
  const resources = new Map<string, Uint8Array>()
  for (const file of files) {
    resources.set(file.path, encoder.encode(file.text))
  }
  return resources
}

function entryPathForSession(session: EditorSession): string {
  return session.manifest.entry ?? SITE_ENTRY_FILE
}

function previewAppIdForSession(session: EditorSession): GeneratedAppId {
  return `gen:icode:preview:${session.appId}` as GeneratedAppId
}

function icodePreviewHeartbeatWindowId(appId: GeneratedAppId): string {
  return `icode-preview:${appId}`
}

export function ICodeApp() {
  const { setAppWindowTitle, closeWindowsForApp, bypassAppCloseGuard } = useOs()
  const {
    installedApps,
    createIcodeManagedApp,
    refreshIcodeManagedApp,
    publishIcodeApp,
    copyInstalledAppToIcode,
    importLegacyIcodeProjects,
    deleteIcodeFormalVersion,
    createIcodeAppVersionFrom,
    uninstallApp,
    getAppDataRevision,
    pendingIcodeAppId,
    clearPendingIcodeApp,
  } = useGeneratedApps()

  const [session, setSession] = useState<EditorSession | undefined>()
  const [draftFiles, setDraftFiles] = useState<IcodeDraftFile[]>([])
  const [activeFilePath, setActiveFilePath] = useState<string | undefined>()
  const [savedFiles, setSavedFiles] = useState<IcodeDraftFile[]>([])
  const [savedManifest, setSavedManifest] = useState<GeneratedAppVersionManifest | undefined>()
  const [editorTab, setEditorTab] = useState<EditorTab>('chat')
  const [visitedEditorTabs, setVisitedEditorTabs] = useState<Partial<Record<EditorTab, true>>>({
    chat: true,
  })
  const [mobilePane, setMobilePane] = useState<MobileEditorPane>('edit')
  const [error, setError] = useState<string | undefined>()
  const [importAlert, setImportAlert] = useState<{ title: string; message: string } | undefined>()
  const [showNewProject, setShowNewProject] = useState(false)
  const [showImportPicker, setShowImportPicker] = useState(false)
  const [copyError, setCopyError] = useState<string | undefined>()
  const [legacyImportResult, setLegacyImportResult] = useState<
    | { imported: number; failures: Array<{ name: string; message: string }> }
    | undefined
  >()
  const [legacyImportWorking, setLegacyImportWorking] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<
    { appId: GeneratedAppId; name: string } | undefined
  >()
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDescription, setNewProjectDescription] = useState('')
  const [previewEpoch, setPreviewEpoch] = useState(0)
  const [processIsolated, setProcessIsolated] = useState(() => isGeneratedAppProcessIsolationActive())
  const [draftAppData, setDraftAppData] = useState<Record<string, string>>({})
  const [dataEditInvalid, setDataEditInvalid] = useState(false)
  const dataDraftEditedRef = useRef(false)
  const [consoleLogs, setConsoleLogs] = useState<ICodeConsoleEntry[]>([])
  const [closePromptOpen, setClosePromptOpen] = useState(false)
  const [closePromptMode, setClosePromptMode] = useState<'close' | 'switch'>('close')
  const [formalVersions, setFormalVersions] = useState<number[]>([])
  const [versionBusy, setVersionBusy] = useState(false)
  const [createFromVersionTarget, setCreateFromVersionTarget] = useState<
    { version: number } | undefined
  >()
  const [newFilePath, setNewFilePath] = useState('')
  const [addingFile, setAddingFile] = useState(false)
  const [typeDiagnostics, setTypeDiagnostics] = useState<IcodeTypeCheckDiagnostic[] | undefined>(undefined)
  const [typeCheckRunning, setTypeCheckRunning] = useState(false)
  // 第十二期：agent 面板绑定的受控终端宿主 API（ref 保稳定引用，state 驱动渲染）
  const [terminalApi, setTerminalApi] = useState<ProdudeTerminalHostApi | null>(null)
  const closeIntentRef = useRef<IcodeNavigationIntent>({ type: 'list' })

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const previewWindowRef = useRef<Window | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const terminalApiRef = useRef<ProdudeTerminalHostApi | null>(null)
  const consoleListRef = useRef<HTMLDivElement>(null)
  const previewBootstrapDataRef = useRef<Record<string, string>>({})
  const previewFrozenLoggedRef = useRef(false)
  const savingRef = useRef(false)
  const sessionRef = useRef<EditorSession | undefined>(undefined)
  sessionRef.current = session
  const { hostRef, narrowLayout } = useIcodeNarrowLayout()
  const {
    registerHeartbeat,
    unregisterHeartbeat,
    resetHeartbeatMonitoring,
    setHeartbeatContentWindow,
    isWindowFrozen,
  } = useGeneratedAppHeartbeat()

  const icodeApps = useMemo(() => installedApps.filter(isIcodeManagedApp), [installedApps])
  const storeApps = useMemo(
    () => installedApps.filter((app) => !isIcodeManagedApp(app)),
    [installedApps],
  )
  // ---- 脏状态 ----

  const filesDirty = session !== undefined && !draftFilesEqual(draftFiles, session.files)
  const metaDirty =
    session !== undefined &&
    savedManifest !== undefined &&
    !manifestMetaEqual(session.manifest, savedManifest)
  const hasDraftToSave = filesDirty || metaDirty
  const dataDirty = Boolean(session && !appDataRecordsEqual(draftAppData, loadGeneratedAppData(session.appId)))
  const currentSavedFiles = session ? savedFiles : []
  const saveDirty = Boolean(
    session &&
      savedManifest !== undefined &&
      (!draftFilesEqual(draftFiles, currentSavedFiles) || metaDirty),
  )
  const publishDirty = hasDraftToSave || filesDirty || saveDirty

  useEffect(() => {
    if (!session) {
      setDraftFiles([])
      return
    }
    setDraftFiles(session.files.map((file) => ({ ...file })))
  }, [session?.appId])

  useEffect(() => {
    dataDraftEditedRef.current = false
    if (!session) {
      setDraftAppData({})
      setDataEditInvalid(false)
      return
    }
    setDraftAppData({ ...loadGeneratedAppData(session.appId) })
  }, [session?.appId])

  const runtimeAppDataRevision = session ? getAppDataRevision(session.appId) : 0
  useEffect(() => {
    if (!session || dataDraftEditedRef.current) {
      return
    }
    setDraftAppData({ ...loadGeneratedAppData(session.appId) })
  }, [session, runtimeAppDataRevision])

  // ---- 打开会话 ----

  const openAppSession = useCallback(
    async (appId: GeneratedAppId): Promise<void> => {
      try {
        const snapshot = await ensureIcodeDraftSnapshot(appId)
        const publishedVersion = (await getIcodeMaxFormalVersion(appId)) ?? 0
        const nextSession: EditorSession = {
          appId,
          manifest: snapshot.manifest,
          files: snapshot.files,
          binaryFiles: snapshot.binaryFiles,
          publishedVersion,
        }
        setSession(nextSession)
        setSavedFiles(snapshot.files.map((file) => ({ ...file })))
        setSavedManifest(snapshot.manifest)
        setDraftFiles(snapshot.files.map((file) => ({ ...file })))
        setActiveFilePath(
          snapshot.files.find((file) => file.path === (snapshot.manifest.entry ?? SITE_ENTRY_FILE))
            ?.path ?? snapshot.files[0]?.path,
        )
        setEditorTab('chat')
        setVisitedEditorTabs({ chat: true })
        setError(undefined)
        setConsoleLogs([])
        setPreviewEpoch((epoch) => epoch + 1)
        void listIcodeFormalVersions(appId).then(setFormalVersions)
      } catch (openError) {
        setError(openError instanceof Error ? openError.message : '打开应用失败')
      }
    },
    [],
  )

  const requestOpenApp = useCallback(
    async (appId: GeneratedAppId): Promise<void> => {
      if (session?.appId === appId) {
        return
      }
      if (!session) {
        await openAppSession(appId)
        return
      }
      if (hasDraftToSave) {
        closeIntentRef.current = { type: 'open', appId }
        setClosePromptMode('switch')
        setClosePromptOpen(true)
        return
      }
      await openAppSession(appId)
    },
    [hasDraftToSave, openAppSession, session],
  )

  useEffect(() => {
    if (!pendingIcodeAppId) {
      return
    }
    const appId = pendingIcodeAppId
    clearPendingIcodeApp()
    void requestOpenApp(appId)
  }, [pendingIcodeAppId, requestOpenApp, clearPendingIcodeApp])

  // ---- 保存 / 发布 ----

  const saveDraftInternal = useCallback(async (next: EditorSession): Promise<boolean> => {
    if (!next) return false
    savingRef.current = true
    try {
      await saveIcodeDraftSnapshot(next.appId, {
        manifest: next.manifest,
        files: draftFiles,
      })
      setSavedFiles(draftFiles.map((file) => ({ ...file })))
      setSavedManifest(next.manifest)
      return true
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存草稿失败，请检查存储空间')
      return false
    } finally {
      savingRef.current = false
    }
  }, [draftFiles])

  const onSaveDraft = useCallback(async () => {
    if (!session) {
      return
    }
    if (!(await saveDraftInternal(session))) {
      return
    }
    setSession({ ...session, files: draftFiles.map((file) => ({ ...file })) })
    setError(undefined)
  }, [draftFiles, saveDraftInternal, session])

  const onPublish = useCallback(async () => {
    if (!session) {
      return
    }
    if (!(await saveDraftInternal(session))) {
      return
    }
    const version = await publishIcodeApp(session.appId)
    if (version === undefined) {
      setError('发布失败，请检查存储空间')
      return
    }
    // 发布后当前 iCode 窗口切到新草稿继续改；桌面改跑新最大号
    await openAppSession(session.appId)
    setError(undefined)
  }, [openAppSession, publishIcodeApp, saveDraftInternal, session])

  // ---- 预览 ----

  const previewAppId = session ? previewAppIdForSession(session) : undefined
  const previewHeartbeatWindowId = session
    ? icodePreviewHeartbeatWindowId(session.appId)
    : undefined
  const runtimeAppId = session?.appId
  const linkedAppDataRevision = session ? getAppDataRevision(session.appId) : 0

  useEffect(() => {
    if (!session) {
      return
    }
    previewBootstrapDataRef.current = { ...loadGeneratedAppData(session.appId) }
    setConsoleLogs([])
    previewFrozenLoggedRef.current = false
    setPreviewEpoch((epoch) => epoch + 1)
  }, [linkedAppDataRevision, session?.appId])

  // 第四期：工程树（有 main.tsx / 清单入口）→ 预览按模块转译，保持多文件形态
  const projectEntryPath = session
    ? detectProjectEntry(
        session.manifest.entry,
        (path) =>
          session.files.some((file) => file.path === path) ||
          session.binaryFiles.some((file) => file.path === path),
      )
    : undefined

  // 五期：旁路类型检查——一轮草稿写入结束或用户明确要求时查一次；失败不挡任何关键路径
  const typeCheckGenerationRef = useRef(0)
  const runTypeCheckForFiles = useCallback(
    async (files: readonly IcodeDraftFile[], entry: string | undefined) => {
      if (!entry) {
        setTypeDiagnostics(undefined)
        return
      }
      const generation = ++typeCheckGenerationRef.current
      setTypeCheckRunning(true)
      try {
        const record: Record<string, string> = {}
        for (const file of files) {
          record[file.path] = file.text
        }
        const diagnostics = await runIcodeTypeCheck({ files: record, entryPath: entry })
        if (generation === typeCheckGenerationRef.current) {
          setTypeDiagnostics(diagnostics)
        }
      } catch (checkError) {
        if (generation === typeCheckGenerationRef.current) {
          console.error('[icode] 类型检查失败', checkError)
          setTypeDiagnostics(undefined)
        }
      } finally {
        if (generation === typeCheckGenerationRef.current) {
          setTypeCheckRunning(false)
        }
      }
    },
    [],
  )

  const [projectPreviewDoc, setProjectPreviewDoc] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!session || !projectEntryPath) {
      setProjectPreviewDoc(undefined)
      return
    }
    let alive = true
    void (async () => {
      const assets = new Map<string, Uint8Array>()
      for (const asset of session.binaryFiles) {
        const bytes = await readVersionFileBytes(session.appId, 'Draft', asset.path)
        if (bytes !== undefined) {
          assets.set(asset.path, bytes)
        }
      }
      const files = new Map(session.files.map((file) => [file.path, file.text] as const))
      const result = await buildProjectPreviewDocument({
        entryPath: projectEntryPath,
        files,
        assets,
      })
      if (!alive) {
        return
      }
      if (result.ok) {
        setProjectPreviewDoc(result.html)
        return
      }
      // 转译/解析失败：预览能看见原因（模型也能读到并自修）
      const message = `工程预览构建失败：\n${result.error}`
      console.error(message)
      setProjectPreviewDoc(
        buildProjectErrorDocument('预览构建失败', `<pre>${result.error.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch] ?? ch)}</pre>`),
      )
    })()
    return () => {
      alive = false
    }
  }, [session, projectEntryPath, previewEpoch])

  const previewEntryPath = session ? entryPathForSession(session) : undefined
  const hasPreviewContent = projectEntryPath
    ? projectPreviewDoc !== undefined
    : Boolean(
        session && previewEntryPath && session.files.some((file) => file.path === previewEntryPath),
      )

  const preparedHtml = useMemo(() => {
    if (!session || !runtimeAppId || !previewAppId || !previewHeartbeatWindowId) {
      return undefined
    }
    let document: string | undefined
    if (projectEntryPath) {
      document = projectPreviewDoc
    } else {
      const entry = entryPathForSession(session)
      document =
        buildSiteDocument({ entryPath: entry, resources: filesToResources(session.files) }) ??
        EMPTY_SITE_DOCUMENT
    }
    if (document === undefined) {
      return undefined
    }
    const runtimeHtml = prepareIcodePreviewHtml(
      document,
      runtimeAppId,
      previewBootstrapDataRef.current,
      previewAppId,
      {
        processIsolated,
        enableFiles: hasAppCapabilityTag(session.manifest.tags ?? [], APP_CAPABILITY_TAG_FILES),
        enableTerminal: hasAppCapabilityTag(
          session.manifest.tags ?? [],
          APP_CAPABILITY_TAG_TERMINAL,
        ),
      },
    )
    return injectGeneratedAppHeartbeatBridge(runtimeHtml, previewAppId, previewHeartbeatWindowId)
  }, [
    previewAppId,
    previewEpoch,
    previewHeartbeatWindowId,
    processIsolated,
    projectEntryPath,
    projectPreviewDoc,
    runtimeAppId,
    session,
    session?.files,
  ])

  const previewRemountKey = previewAppId
    ? `${previewAppId}-${previewEpoch}-${processIsolated ? 'iso' : 'std'}`
    : 'icode-preview'

  const handlePreviewIframeReady = useCallback(() => {
    previewWindowRef.current = iframeRef.current?.contentWindow ?? null
    if (!previewHeartbeatWindowId) {
      return
    }
    setHeartbeatContentWindow(
      previewHeartbeatWindowId,
      iframeRef.current?.contentWindow ?? undefined,
    )
  }, [previewHeartbeatWindowId, setHeartbeatContentWindow])

  const { iframeProps } = useGeneratedHtmlIframe(
    iframeRef,
    session && session.files.length > 0 ? preparedHtml : undefined,
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
    setConsoleLogs((current) =>
      appendConsoleEntry(current, {
        type: ICODE_CONSOLE_MESSAGE_TYPE,
        appId: previewAppId,
        level: 'warn',
        text: '预览应用未响应，可能是代码中存在死循环',
        timestamp: osNowMs(),
      }),
    )
  }, [previewAppId, previewFrozen])

  useEffect(() => {
    if (!session) {
      setAppWindowTitle('icode', 'iCode')
      return
    }
    setAppWindowTitle('icode', `${session.manifest.name} — iCode`)
  }, [session, setAppWindowTitle])

  useEffect(() => {
    if (!runtimeAppId) {
      return
    }
    return installGeneratedAppAiHandler({
      appId: runtimeAppId,
      appName: session?.manifest.name,
      debug: true,
      getContentWindow: () =>
        iframeRef.current?.contentWindow ?? previewWindowRef.current ?? undefined,
    })
  }, [runtimeAppId, session?.manifest.name])

  useEffect(() => {
    if (!runtimeAppId || !session) {
      return
    }
    const tags = session.manifest.tags ?? []
    if (!hasAppCapabilityTag(tags, APP_CAPABILITY_TAG_FILES)) {
      return
    }
    return installGeneratedAppFilesHandler({
      appId: runtimeAppId,
      getContentWindow: () =>
        iframeRef.current?.contentWindow ?? previewWindowRef.current ?? undefined,
      isAllowed: () => hasAppCapabilityTag(tags, APP_CAPABILITY_TAG_FILES),
    })
  }, [runtimeAppId, session])

  useEffect(() => {
    if (!runtimeAppId || !session) {
      return
    }
    const tags = session.manifest.tags ?? []
    if (!hasAppCapabilityTag(tags, APP_CAPABILITY_TAG_TERMINAL)) {
      return
    }
    return installGeneratedAppTerminalHandler({
      appId: runtimeAppId,
      getContentWindow: () =>
        iframeRef.current?.contentWindow ?? previewWindowRef.current ?? undefined,
      isAllowed: () => hasAppCapabilityTag(tags, APP_CAPABILITY_TAG_TERMINAL),
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
        if (event.data.appId !== previewAppId || event.source !== previewWindow) {
          return
        }
        if (event.data.level === 'error') {
          logRuntimeErrorToHostConsole(session?.manifest.name ?? previewAppId, event.data.text)
        }
        setConsoleLogs((current) => appendConsoleEntry(current, event.data))
        return
      }

      if (isGeneratedAppRuntimeErrorMessage(event.data)) {
        if (event.data.appId !== previewAppId || event.source !== previewWindow) {
          return
        }
        logRuntimeErrorToHostConsole(session?.manifest.name ?? previewAppId, event.data.text)
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
      // 预览与桌面共用同一注册表命名空间；iframe 内写入实时进数据页
      setDraftAppData((current) =>
        dataDraftEditedRef.current ? current : { ...event.data.data },
      )
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [previewAppId, runtimeAppId, session?.manifest.name])

  // ---- 草稿树变更监听（agent 写操作后刷新预览；不做定时轮询） ----

  useEffect(() => {
    if (!session) {
      return
    }
    const draftRoot = appVersionDirPath(session.appId, 'Draft')
    let timer: number | undefined
    const schedule = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer)
      }
      timer = window.setTimeout(() => {
        timer = undefined
        void (async () => {
          const current = sessionRef.current
          if (!current || savingRef.current) {
            return
          }
          try {
            const snapshot = await ensureIcodeDraftSnapshot(current.appId)
            const changed =
              !draftFilesEqual(snapshot.files, current.files) ||
              !manifestMetaEqual(snapshot.manifest, current.manifest)
            if (!changed) {
              return
            }
            // 草稿树有外部写入（agent / 文件管理器）：同步进会话并刷新预览。
            // 用户在编辑器里的未保存修改会被覆盖——发起 agent 轮前已自动保存，窗口期有限。
            setSession((prev) =>
              prev
                ? {
                    ...prev,
                    manifest: snapshot.manifest,
                    files: snapshot.files,
                    binaryFiles: snapshot.binaryFiles,
                  }
                : prev,
            )
            setDraftFiles(snapshot.files.map((file) => ({ ...file })))
            setActiveFilePath((prev) =>
              prev && snapshot.files.some((file) => file.path === prev)
                ? prev
                : snapshot.files[0]?.path,
            )
            setPreviewEpoch((epoch) => epoch + 1)
            // 一轮外部写入结束：旁路类型检查查一次（诊断给源码页与下一轮 agent 上下文）
            if (snapshot.files.some((file) => file.path === 'main.tsx')) {
              void runTypeCheckForFiles(snapshot.files, snapshot.manifest.entry ?? 'main.tsx')
            }
          } catch {
            // 读取失败忽略，等待下一次变更
          }
        })()
      }, 600)
    }
    return subscribeFilesWatch(draftRoot, schedule)
  }, [runTypeCheckForFiles, session?.appId])

  // ---- 编辑器页签行为 ----

  useEffect(() => {
    setVisitedEditorTabs((current) =>
      current[editorTab] ? current : { ...current, [editorTab]: true },
    )
  }, [editorTab])

  useEffect(() => {
    setVisitedEditorTabs({ chat: true })
    setEditorTab('chat')
    setTypeDiagnostics(undefined)
  }, [session?.appId])

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
    const container = consoleListRef.current
    if (!container || editorTab !== 'console') {
      return
    }
    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [consoleLogs, editorTab])

  // ---- 关闭守卫 ----

  const resetEditorUi = useCallback(() => {
    setSession(undefined)
    setDraftFiles([])
    setSavedFiles([])
    setSavedManifest(undefined)
    setActiveFilePath(undefined)
    setDraftAppData({})
    setDataEditInvalid(false)
    dataDraftEditedRef.current = false
    setError(undefined)
    setFormalVersions([])
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
      await openAppSession(intent.appId)
      return
    }

    resetEditorUi()
    if (intent.type === 'window') {
      bypassAppCloseGuard('icode')
      closeWindowsForApp('icode')
    }
  }, [bypassAppCloseGuard, closeWindowsForApp, openAppSession, resetEditorUi])

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

  const confirmCloseSaveDraft = useCallback(async (): Promise<void> => {
    if (session) {
      await saveDraftInternal(session)
    }
    await completePendingNavigation()
  }, [completePendingNavigation, saveDraftInternal, session])

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
        onClick: () => void completePendingNavigation(),
      },
      {
        key: 'continue',
        label: '继续编辑',
        tone: 'secondary' as const,
        onClick: dismissNavigateAwayPrompt,
      },
    ],
    [closePromptMode, completePendingNavigation, confirmCloseSaveDraft, dismissNavigateAwayPrompt],
  )

  // ---- 第十二期：agent 面板宿主回调（能力授予 / 发起轮前落盘工作副本） ----

  const grantedCapabilities = useMemo(
    () => (session ? toIcodeCapabilityTags(session.manifest.tags ?? []) : []),
    [session],
  )

  /** 面板横幅「授予能力」同意后：写清单标签并刷预览；「保存」随草稿清单持久化 */
  const onGrantCapability = useCallback((tag: IcodeCapabilityTag) => {
    setSession((current) => {
      if (!current) {
        return current
      }
      const tags = filterAppCapabilityTags(current.manifest.tags ?? [])
      const nextTags = tags.includes(tag as AppCapabilityTag)
        ? tags
        : [...tags, tag as AppCapabilityTag]
      return { ...current, manifest: { ...current.manifest, tags: nextTags } }
    })
    setPreviewEpoch((epoch) => epoch + 1)
  }, [])

  /** 一轮开始前把源码页工作副本落盘，agent 才能读到最新内容 */
  const onBeforeAgentTurn = useCallback(async () => {
    const active = sessionRef.current
    if (!active || !draftFiles.length || savingRef.current) {
      return
    }
    savingRef.current = true
    try {
      await saveIcodeDraftSnapshot(active.appId, {
        manifest: active.manifest,
        files: draftFiles,
      })
    } finally {
      savingRef.current = false
    }
    setSavedFiles(draftFiles.map((file) => ({ ...file })))
    setSavedManifest(active.manifest)
    setSession({ ...active, files: draftFiles.map((file) => ({ ...file })) })
  }, [draftFiles])

  // 五期补强：旁路类型诊断折叠成面板 problems 入参
  const monacoProblems = useMemo<MonacoProblem[]>(
    () =>
      (typeDiagnostics ?? []).map((diagnostic) => ({
        id: `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}`,
        path: diagnostic.file,
        resourceLabel: diagnostic.file,
        message: diagnostic.message,
        severity: diagnostic.category,
        source: 'ts',
        code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
        startLineNumber: diagnostic.line,
        startColumn: diagnostic.column,
        endLineNumber: diagnostic.line,
        endColumn: diagnostic.column + 1,
      })),
    [typeDiagnostics],
  )


  // ---- 源码页：草稿树文件编辑 ----

  const activeFile = draftFiles.find((file) => file.path === activeFilePath)

  const onActiveFileChange = useCallback((text: string) => {
    setDraftFiles((current) =>
      current.map((file) => (file.path === activeFilePath ? { ...file, text } : file)),
    )
  }, [activeFilePath])

  const onRunDraft = useCallback(() => {
    if (!session || !draftFiles.length) {
      return
    }
    setSession({ ...session, files: draftFiles.map((file) => ({ ...file })) })
    setPreviewEpoch((epoch) => epoch + 1)
  }, [draftFiles, session])

  const onAddFile = useCallback(() => {
    const raw = newFilePath.trim().replace(/^\/+/, '')
    if (!raw) {
      return
    }
    if (draftFiles.some((file) => file.path === raw)) {
      setError('同名文件已存在')
      return
    }
    setDraftFiles((current) => [...current, { path: raw, text: '' }].sort((a, b) => a.path.localeCompare(b.path)))
    setActiveFilePath(raw)
    setNewFilePath('')
    setAddingFile(false)
    setError(undefined)
  }, [draftFiles, newFilePath])

  const onDeleteFile = useCallback(
    (path: string) => {
      setDraftFiles((current) => current.filter((file) => file.path !== path))
      setActiveFilePath((current) => (current === path ? draftFiles[0]?.path : current))
    },
    [draftFiles],
  )

  // ---- 配置页 ----

  const updateSessionManifest = useCallback(
    (patch: Partial<Pick<GeneratedAppVersionManifest, 'name' | 'description' | 'category' | 'iconEmoji' | 'themeColor' | 'tags'>>) => {
      if (!session) {
        return
      }
      if (patch.name !== undefined) {
        const conflict = findAppNameConflict(installedApps, patch.name, {
          excludeAppId: session.appId,
        })
        if (conflict) {
          setError(formatAppNameConflictMessage(conflict))
          return
        }
      }
      setSession({ ...session, manifest: { ...session.manifest, ...patch } })
      setError(undefined)
      if (patch.tags !== undefined) {
        setPreviewEpoch((epoch) => epoch + 1)
      }
    },
    [installedApps, session],
  )

  // ---- 数据页 ----

  const onApplyAppData = useCallback(async () => {
    if (!session || !dataDirty || dataEditInvalid) {
      return
    }
    const failures = await saveGeneratedAppDataAsync(session.appId, draftAppData)
    if (failures.length > 0) {
      setError('数据空间已满，部分键未能保存')
      return
    }
    dataDraftEditedRef.current = false
    previewBootstrapDataRef.current = { ...draftAppData }
    setPreviewEpoch((epoch) => epoch + 1)
    setError(undefined)
  }, [dataDirty, dataEditInvalid, draftAppData, session])

  const onDraftAppDataChange = useCallback((value: Record<string, string>) => {
    dataDraftEditedRef.current = true
    setDraftAppData(value)
  }, [])


  // ---- 版本治理（第二期） ----

  const refreshVersions = useCallback(async (appId: GeneratedAppId) => {
    setFormalVersions(await listIcodeFormalVersions(appId))
  }, [])

  const onDeleteFormalVersion = useCallback(
    async (version: number) => {
      if (!session) {
        return
      }
      setVersionBusy(true)
      const ok = await deleteIcodeFormalVersion(session.appId, version)
      setVersionBusy(false)
      if (!ok) {
        setError('删除旧档失败（当前最大号不能删）')
        return
      }
      await refreshVersions(session.appId)
      setError(undefined)
    },
    [deleteIcodeFormalVersion, refreshVersions, session],
  )

  const confirmCreateFromVersion = useCallback(
    async (baseVersion: number) => {
      if (!session) {
        return
      }
      setCreateFromVersionTarget(undefined)
      setVersionBusy(true)
      const version = await createIcodeAppVersionFrom(session.appId, baseVersion)
      setVersionBusy(false)
      if (version === undefined) {
        setError('基于旧档创建新版本失败')
        return
      }
      await openAppSession(session.appId)
      setError(undefined)
    },
    [createIcodeAppVersionFrom, openAppSession, session],
  )

  // ---- 首页动作 ----

  const onCreateProject = useCallback(async () => {
    const trimmedName = newProjectName.trim()
    if (!trimmedName) {
      setError('请输入应用名称')
      return
    }
    const conflict = findAppNameConflict(installedApps, trimmedName)
    if (conflict) {
      setError(formatAppNameConflictMessage(conflict))
      return
    }
    const appId = await createIcodeManagedApp({
      identity: {
        name: trimmedName,
        description: newProjectDescription.trim(),
        category: '内部开发',
        iconEmoji: '🛠️',
        themeColor: '#5856d6',
        tags: [],
      },
    })
    if (!appId) {
      setError('创建失败，请检查存储空间')
      return
    }
    setShowNewProject(false)
    setNewProjectName('')
    setNewProjectDescription('')
    setError(undefined)
    void requestOpenApp(appId)
  }, [createIcodeManagedApp, installedApps, newProjectDescription, newProjectName, requestOpenApp])

  const onCopyFromInstalled = useCallback(
    async (record: GeneratedAppRecord) => {
      setCopyError(undefined)
      try {
        const newAppId = await copyInstalledAppToIcode(record.id)
        setShowImportPicker(false)
        setCopyError(undefined)
        setError(undefined)
        void requestOpenApp(newAppId)
      } catch (copyError) {
        const message = copyError instanceof Error ? copyError.message : '复制失败'
        setCopyError(message)
        // 保留一条控制台记录，方便打开 DevTools 时看完整调用栈
        console.error('[icode] 复制应用失败', copyError)
      }
    },
    [copyInstalledAppToIcode, requestOpenApp],
  )

  const onImportLegacyProjects = useCallback(async () => {
    setLegacyImportWorking(true)
    setLegacyImportResult(undefined)
    try {
      const result = await importLegacyIcodeProjects()
      setLegacyImportResult(result)
    } catch (err) {
      setLegacyImportResult({
        imported: 0,
        failures: [{ name: '导入流程', message: err instanceof Error ? err.message : String(err) }],
      })
      console.error('[icode] 手动导入旧项目失败', err)
    } finally {
      setLegacyImportWorking(false)
    }
  }, [importLegacyIcodeProjects])

  const exportCurrentApp = useCallback(async () => {
    if (!session) {
      return
    }
    try {
      const { exportIcodePackageToZip, downloadIcodePackageZip } = await import('./icode-backup.ts')
      const blob = await exportIcodePackageToZip(session.appId)
      downloadIcodePackageZip(blob, session.manifest.name)
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : '导出失败')
    }
  }, [session])

  const onImportFile = useCallback(
    async (file: File | undefined) => {
      if (!file) {
        return
      }
      try {
        const backup = await import('./icode-backup.ts')
        let bundle
        try {
          bundle = await backup.readPackageBundleFromZipFile(file)
        } catch {
          bundle = backup.legacyBundleToPackageBundle(await backup.readLegacyBundleFromZipFile(file))
        }

        // 目标机已有同一应用或同名应用：做成副本（新身份、新名字）
        const desiredName =
          bundle.draft?.manifest.name ??
          bundle.versions[bundle.versions.length - 1]?.manifest.name ??
          bundle.index.placeholder?.name ??
          '导入的应用'
        const conflict = findAppNameConflict(installedApps, desiredName)
        const renameTo = conflict ? resolveUniqueCopyName(`${desiredName}（副本）`, installedApps) : undefined

        const newAppId = await backup.importIcodePackageFromBundle({ bundle, renameTo })
        if (Object.keys(bundle.appData).length > 0) {
          await saveGeneratedAppDataAsync(newAppId, bundle.appData)
        }
        await refreshIcodeManagedApp(newAppId)
        setImportAlert(undefined)
        void requestOpenApp(newAppId)
      } catch (importError) {
        setImportAlert({
          title: '无法导入程序包',
          message: importError instanceof Error ? importError.message : '导入失败',
        })
      }
    },
    [installedApps, refreshIcodeManagedApp, requestOpenApp],
  )

  // ---- 删除 ----

  const confirmDeleteApp = useCallback(async () => {
    if (!deleteTarget) {
      return
    }
    if (session?.appId === deleteTarget.appId) {
      resetEditorUi()
    }
    uninstallApp(deleteTarget.appId)
    setDeleteTarget(undefined)
    setError(undefined)
  }, [deleteTarget, resetEditorUi, session?.appId, uninstallApp])

  // ---- 菜单栏 ----

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
            onClick: requestCloseEditor,
          },
          { type: 'separator' as const },
          {
            type: 'action' as const,
            label: '导出程序包…',
            onClick: () => void exportCurrentApp(),
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
            label: '从已安装应用复制…',
            onClick: () => setShowImportPicker(true),
          },
          {
            type: 'action' as const,
            label: '导入程序包…',
            onClick: () => importInputRef.current?.click(),
          },
        ]

    return [{ label: '文件', items: fileItems }]
  }, [exportCurrentApp, onPublish, onSaveDraft, requestCloseEditor, session])

  useAppMenuBar('icode', menuBar)

  // ---- 渲染 ----

  const deleteAppModal = (
    <WindowModal
      open={!!deleteTarget}
      title="删除 iCode 应用"
      role="alertdialog"
      themeColor={ICODE_CHROME_ACCENT}
      onClose={() => setDeleteTarget(undefined)}
      actions={[
        {
          key: 'cancel',
          label: '取消',
          tone: 'secondary',
          onClick: () => setDeleteTarget(undefined),
        },
        {
          key: 'delete',
          label: '删除',
          tone: 'danger',
          onClick: () => void confirmDeleteApp(),
        },
      ]}
    >
      {deleteTarget && (
        <p class="window-modal__message">
          确定删除「{deleteTarget.name}」吗？将卸载桌面入口并删除应用包（全部版本、草稿、
          聊天与用户数据）。此操作不可恢复。
        </p>
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
                  在系统内开发、调试 AI 微应用。编辑只改草稿，发布升格为新的正式版后桌面才会更新。
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
                新建应用
              </button>
              <button
                type="button"
                class="icode__button icode__button--secondary"
                onClick={() => setShowImportPicker(true)}
                disabled={storeApps.length === 0}
              >
                从已安装应用复制…
              </button>
              <button
                type="button"
                class="icode__button icode__button--secondary"
                onClick={() => void onImportLegacyProjects()}
                disabled={legacyImportWorking}
              >
                {legacyImportWorking ? '导入中…' : '导入旧版应用…'}
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
              <h2 class="icode__section-title">iCode 应用</h2>
              <div class="icode__list">
                {icodeApps.length === 0 ? (
                  <p class="icode__list--empty">暂无 iCode 应用。点击「新建应用」开始开发。</p>
                ) : (
                  icodeApps.map((app) => (
                    <button
                      key={app.id}
                      type="button"
                      class="icode__row"
                      onClick={() => void requestOpenApp(app.id)}
                    >
                      <span class="icode__row-icon" aria-hidden="true">
                        <GeneratedAppIcon
                          emoji={app.iconEmoji || '📦'}
                          themeColor={app.themeColor}
                          size={36}
                        />
                      </span>
                      <span class="icode__row-main">
                        <span class="icode__row-name">{app.name}</span>
                        {app.description && (
                          <span class="icode__row-desc">{app.description}</span>
                        )}
                        <span class="icode__row-meta">
                          <span class="icode__badge">iCode</span>
                          <span>
                            {app.activeVersion && app.activeVersion > 0
                              ? `正式版 ${app.activeVersion}`
                              : '尚未发布'}
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
                每个应用的源码按版本落在应用包的 Versions 文件夹里；桌面只跑当前最大正式版。
              </p>
            </section>
          </div>
        </div>

        <WindowModal
          open={showImportPicker}
          title="从已安装应用复制"
          wide
          scrollBody
          themeColor={modalTheme}
          onClose={() => {
            setShowImportPicker(false)
            setCopyError(undefined)
          }}
          actions={[
            {
              key: 'cancel',
              label: '取消',
              tone: 'secondary',
              onClick: () => {
                setShowImportPicker(false)
                setCopyError(undefined)
              },
            },
          ]}
        >
          <p class="window-modal__message">
            将复制出独立的新 iCode 应用（只带当前正在跑的那一版内容），原应用不受影响、不带其历史版本与用户数据。
          </p>
          {copyError && <p class="window-modal__error">{copyError}</p>}
          <div class="icode__list">
            {storeApps.map((app) => (
              <button
                key={app.id}
                type="button"
                class="icode__row"
                onClick={() => void onCopyFromInstalled(app)}
              >
                <span class="icode__row-icon" aria-hidden="true">
                  <GeneratedAppIcon emoji={app.iconEmoji} themeColor={app.themeColor} size={36} />
                </span>
                <span class="icode__row-main">
                  <span class="icode__row-name">{app.name}</span>
                  {app.description && <span class="icode__row-desc">{app.description}</span>}
                  <span class="icode__row-meta">
                    <span class="icode__badge icode__badge--formal">商店</span>
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
          open={legacyImportResult !== undefined}
          title="导入旧版 iCode 项目"
          scrollBody
          themeColor={modalTheme}
          onClose={() => setLegacyImportResult(undefined)}
          actions={[
            {
              key: 'close',
              label: '关闭',
              tone: 'secondary',
              onClick: () => setLegacyImportResult(undefined),
            },
          ]}
        >
          {legacyImportResult && (
            <>
              {legacyImportResult.failures.length > 0 ? (
                <>
                  <p class="window-modal__message">
                    成功导入 {legacyImportResult.imported} 个旧项目，以下项目导入失败
                    （请把错误信息反馈给开发者）：
                  </p>
                  <ul class="icode__legacy-failures">
                    {legacyImportResult.failures.map((failure) => (
                      <li key={failure.name} class="icode__legacy-failure">
                        <span class="icode__legacy-failure-name">
                          <span class="icode__legacy-failure-badge">失败</span>
                          {failure.name}
                        </span>
                        <p class="icode__legacy-failure-message">{failure.message}</p>
                      </li>
                    ))}
                  </ul>
                </>
              ) : legacyImportResult.imported > 0 ? (
                <p class="window-modal__message">
                  成功导入 {legacyImportResult.imported} 个旧项目。导入后的应用会出现在「iCode 应用」列表里。
                </p>
              ) : (
                <p class="window-modal__message">没有发现旧版 iCode 内部项目，或已全部导入过。</p>
              )}
            </>
          )}
        </WindowModal>

        <WindowModal
          open={showNewProject}
          title="新建应用"
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
            <label for="icode-new-name">应用名称</label>
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

        {deleteAppModal}

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
  const tags = session.manifest.tags ?? []
  const currentMaxVersion = formalVersions.length > 0 ? formalVersions[formalVersions.length - 1] : undefined

  return (
    <div
      ref={hostRef}
      class="icode"
      style={{ '--app-accent': session.manifest.themeColor }}
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

      {/* 三期：agent 的受控终端（iCode 开发面基础设施；不进版本树） */}
      <ProdudeTerminalHost
        workspaceFolder={appVersionDirPath(session.appId, 'Draft')}
        onApiChange={(api) => {
          terminalApiRef.current = api
          setTerminalApi(api)
        }}
      />

      <div class="icode__editor">
        <nav class="icode__nav">
          <IosNavBackButton class="icode__nav-back" label="应用" onClick={requestCloseEditor} />
          <p class="icode__nav-hint">
            {hasDraftToSave
              ? '草稿有未保存修改'
              : session.publishedVersion > 0
                ? `正式版 ${session.publishedVersion} · 草稿已同步`
                : '尚未发布'}
          </p>
          <div class="icode__nav-actions">
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
              disabled={!publishDirty && session.publishedVersion > 0}
              onClick={() => void onPublish()}
            >
              发布
            </button>
            {filesDirty && (
              <button
                type="button"
                class="icode__button icode__button--run icode__nav-run"
                disabled={draftFiles.length === 0}
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
            <div class={`icode__preview-screen${previewFrozen ? ' icode__preview-screen--unresponsive' : ''}`}>
              {!hasPreviewContent && (
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
              <iframe
                ref={iframeRef}
                class={`icode__frame${session.files.length > 0 ? '' : ' icode__frame--hidden'}`}
                title={`${session.manifest.name} 预览`}
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
                  { id: 'source', label: '源码', dirty: filesDirty },
                  { id: 'config', label: '配置', dirty: metaDirty },
                  { id: 'versions', label: '版本' },
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
                {/* 第十二期：对话外壳换成 vscode AI 面板（引擎仍走受控终端 agent 循环） */}
                <IcodeAiChatPanel
                  key={session.appId}
                  appId={session.appId}
                  appName={session.manifest.name}
                  draftRoot={appVersionDirPath(session.appId, 'Draft')}
                  draftFiles={draftFiles}
                  binaryPaths={session.binaryFiles.map((file) => file.path)}
                  grantedCapabilities={grantedCapabilities}
                  onGrantCapability={onGrantCapability}
                  problems={monacoProblems}
                  terminalApi={terminalApi}
                  onBeforeAgentTurn={() => void onBeforeAgentTurn()}
                />
              </div>

              <div class="icode__tab-pane" hidden={editorTab !== 'source'}>
                <div class="icode__panel-toolbar icode__panel-toolbar--source">
                  <span>{draftFiles.length} 个文件</span>
                  {filesDirty && (
                    <span class="icode__run-hint">源码已修改，点击「运行」更新左侧预览</span>
                  )}
                  {projectEntryPath && (
                    <button
                      type="button"
                      class="icode__panel-action"
                      disabled={typeCheckRunning}
                      onClick={() =>
                        void runTypeCheckForFiles(draftFiles, projectEntryPath)
                      }
                    >
                      {typeCheckRunning
                        ? '检查中…'
                        : `类型检查${typeDiagnostics && typeDiagnostics.length > 0 ? `（${typeDiagnostics.length}）` : ''}`}
                    </button>
                  )}
                  <button
                    type="button"
                    class="icode__panel-action"
                    onClick={() => setAddingFile(true)}
                  >
                    新建文件
                  </button>
                  <button
                    type="button"
                    class="icode__button icode__button--run icode__run-button"
                    disabled={!filesDirty || draftFiles.length === 0}
                    onClick={onRunDraft}
                  >
                    运行
                  </button>
                </div>
                {addingFile && (
                  <div class="icode__file-add">
                    <input
                      type="text"
                      value={newFilePath}
                      placeholder="文件路径，例如 js/app.js"
                      onInput={(event) =>
                        setNewFilePath((event.currentTarget as HTMLInputElement).value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          onAddFile()
                        }
                      }}
                    />
                    <button
                      type="button"
                      class="icode__button icode__button--primary"
                      onClick={onAddFile}
                    >
                      添加
                    </button>
                    <button
                      type="button"
                      class="icode__button icode__button--secondary"
                      onClick={() => {
                        setAddingFile(false)
                        setNewFilePath('')
                      }}
                    >
                      取消
                    </button>
                  </div>
                )}
                {projectEntryPath && typeDiagnostics !== undefined && (
                  <div class="icode__type-diagnostics">
                    {typeDiagnostics.length === 0 ? (
                      <p class="icode__type-diagnostics-ok">类型检查通过，无诊断。</p>
                    ) : (
                      typeDiagnostics.slice(0, 50).map((diagnostic, index) => (
                        <button
                          key={index}
                          type="button"
                          class={`icode__type-diagnostic icode__type-diagnostic--${diagnostic.category}`}
                          onClick={() => setActiveFilePath(diagnostic.file)}
                          title={diagnostic.message}
                        >
                          <span class="icode__type-diagnostic-pos">
                            {diagnostic.file}:{diagnostic.line}:{diagnostic.column}
                          </span>
                          <span class="icode__type-diagnostic-message">
                            {diagnostic.message}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
                <div class="icode__source-split">
                  <div class="icode__file-list" role="listbox" aria-label="草稿文件">
                    {draftFiles.map((file) => (
                      <button
                        key={file.path}
                        type="button"
                        role="option"
                        aria-selected={file.path === activeFilePath}
                        class={`icode__file-row${file.path === activeFilePath ? ' icode__file-row--active' : ''}`}
                        onClick={() => setActiveFilePath(file.path)}
                      >
                        <span class="icode__file-row-name" title={file.path}>
                          {file.path}
                        </span>
                        {file.path === entryPathForSession(session) && (
                          <span class="icode__file-row-badge">入口</span>
                        )}
                        <span
                          class="icode__file-row-delete"
                          role="button"
                          aria-label={`删除 ${file.path}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            onDeleteFile(file.path)
                          }}
                        >
                          ×
                        </span>
                      </button>
                    ))}
                    {session.binaryFiles.map((file) => (
                      <div key={file.path} class="icode__file-row icode__file-row--binary">
                        <span class="icode__file-row-name" title={file.path}>
                          {file.path}
                        </span>
                        <span class="icode__file-row-badge">资源</span>
                      </div>
                    ))}
                  </div>
                  <div class="icode__file-editor">
                    {(editorTab === 'source' || visitedEditorTabs.source) &&
                      (activeFile ? (
                        <IcodeMonacoEditor
                          key={activeFile.path}
                          value={activeFile.text}
                          onChange={onActiveFileChange}
                          active={editorTab === 'source'}
                        />
                      ) : (
                        <p class="icode__list--empty">选择或新建一个文件开始编辑。</p>
                      ))}
                  </div>
                </div>
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
                          value={session.manifest.name}
                          onInput={(event) =>
                            updateSessionManifest({
                              name: (event.currentTarget as HTMLInputElement).value,
                            })
                          }
                        />
                        <p class="icode__config-note">
                          名称、图标与颜色随草稿保存；发布升格后桌面才会更新。
                        </p>
                      </div>
                      <div class="icode__config-item">
                        <label for="icode-config-desc">应用描述</label>
                        <textarea
                          id="icode-config-desc"
                          value={session.manifest.description}
                          onInput={(event) =>
                            updateSessionManifest({
                              description: (event.currentTarget as HTMLTextAreaElement).value,
                            })
                          }
                        />
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
                              emoji={session.manifest.iconEmoji || '📦'}
                              themeColor={session.manifest.themeColor}
                              size={52}
                            />
                          </span>
                          <div class="icode__config-appearance-copy">
                            <span class="icode__config-item-label">图标</span>
                            {editorTab === 'config' || visitedEditorTabs.config ? (
                              <EmojiPickerPopover
                                value={session.manifest.iconEmoji || '📦'}
                                triggerLabel="选择表情"
                                onChange={(emoji) => updateSessionManifest({ iconEmoji: emoji })}
                              />
                            ) : (
                              <span class="icode__config-note">
                                {session.manifest.iconEmoji || '📦'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div class="icode__config-item">
                        <span class="icode__config-item-label">主题色</span>
                        <div class="icode__config-colors" role="radiogroup" aria-label="主题色">
                          {ICODE_THEME_COLOR_PRESETS.map((color) => {
                            const selected =
                              session.manifest.themeColor.toLowerCase() === color
                            return (
                              <button
                                key={color}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                aria-label={color}
                                class={`icode__config-color${selected ? ' icode__config-color--selected' : ''}`}
                                style={{ backgroundColor: color }}
                                onClick={() => updateSessionManifest({ themeColor: color })}
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
                      授予能力后，AI 在生成程序时可以直接使用；模型也可在需要时经工具发起请求。
                    </p>
                    <div class="icode__config-inset">
                      {(
                        [
                          [APP_CAPABILITY_TAG_3D, '3D 能力', '允许 AI 使用 3D 引擎'],
                          [
                            APP_CAPABILITY_TAG_AI,
                            '运行时 AI 能力',
                            'AI 编写的 App 可在运行时调用 AI 能力',
                          ],
                          [
                            APP_CAPABILITY_TAG_FILES,
                            '文件访问能力',
                            'AI 编写的 App 可通过 InstantOS.files 读写系统文件',
                          ],
                          [
                            APP_CAPABILITY_TAG_TERMINAL,
                            '终端能力',
                            'AI 编写的 App 可通过 InstantOS.terminal 使用系统终端会话',
                          ],
                        ] as const
                      ).map(([tag, title, note]) => (
                        <div class="icode__config-toggle-row" key={tag}>
                          <div class="icode__config-toggle-copy">
                            <strong>{title}</strong>
                            <span>{note}</span>
                          </div>
                          <IosSwitch
                            label={`启用${title}`}
                            checked={hasAppCapabilityTag(tags, tag)}
                            onChange={(enabled) => {
                              const baseTags = filterAppCapabilityTags(tags)
                              const nextTags = enabled
                                ? [...baseTags.filter((item) => item !== tag), tag]
                                : baseTags.filter((item) => item !== tag)
                              updateSessionManifest({ tags: nextTags })
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </section>

                  <section class="icode__config-section icode__config-section--danger">
                    <h4 class="icode__config-heading">删除应用</h4>
                    <div class="icode__config-inset icode__config-inset--danger">
                      <p class="icode__config-danger-copy">
                        永久删除此 iCode 应用：卸载桌面入口并删除应用包（全部版本、草稿、聊天与用户数据）。
                      </p>
                      <div class="icode__config-item icode__config-item--action">
                        <button
                          type="button"
                          class="icode__button icode__button--danger icode__button--block"
                          onClick={() =>
                            setDeleteTarget({
                              appId: session.appId,
                              name: session.manifest.name,
                            })
                          }
                        >
                          删除此应用…
                        </button>
                      </div>
                    </div>
                  </section>
                </div>
              </div>

              <div class="icode__tab-pane" hidden={editorTab !== 'versions'}>
                <div class="icode__panel-toolbar">
                  <span>
                    正式版 {formalVersions.length} 个
                    {currentMaxVersion !== undefined ? ` · 当前最大号 ${currentMaxVersion}` : ' · 尚无正式版'}
                  </span>
                  <button
                    type="button"
                    class="icode__panel-action"
                    disabled={versionBusy}
                    onClick={() => void refreshVersions(session.appId)}
                  >
                    刷新
                  </button>
                </div>
                <div class="icode__versions-list">
                  {formalVersions.length === 0 ? (
                    <p class="icode__list--empty">
                      尚无正式版。发布草稿后会在这里出现第 1 号。
                    </p>
                  ) : (
                    [...formalVersions].reverse().map((version) => {
                      const isMax = version === currentMaxVersion
                      return (
                        <div
                          key={version}
                          class={`icode__version-row${isMax ? ' icode__version-row--current' : ''}`}
                        >
                          <span class="icode__version-number">v{version}</span>
                          <span class="icode__version-meta">
                            {isMax ? '当前最大号 · 桌面正在跑' : '历史档'}
                          </span>
                          <span class="icode__version-actions">
                            <button
                              type="button"
                              class="icode__panel-action"
                              disabled={versionBusy}
                              onClick={() => setCreateFromVersionTarget({ version })}
                            >
                              基于此版创建新版本
                            </button>
                            {!isMax && (
                              <button
                                type="button"
                                class="icode__panel-action icode__panel-action--danger"
                                disabled={versionBusy}
                                onClick={() => void onDeleteFormalVersion(version)}
                              >
                                删除
                              </button>
                            )}
                          </span>
                        </div>
                      )
                    })
                  )}
                  <p class="icode__config-note">
                    历史是一条线：新正式版永远是当前最大号加一。想回到更早的样子，基于那一档
                    再接一档新版本，而不是删除当前最大号。
                  </p>
                </div>
              </div>

              <div class="icode__tab-pane" hidden={editorTab !== 'data'}>
                <div class="icode__panel-toolbar icode__panel-toolbar--source">
                  <span>{Object.keys(draftAppData).length} 个键</span>
                  {dataEditInvalid && <span class="icode__run-hint">当前键的值格式无效</span>}
                  {!dataEditInvalid && dataDirty && (
                    <span class="icode__run-hint">数据已修改，点击「应用」保存并更新预览</span>
                  )}
                  <button
                    type="button"
                    class="icode__button icode__button--run icode__run-button"
                    disabled={!dataDirty || dataEditInvalid}
                    onClick={() => void onApplyAppData()}
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
            class={`icode__mobile-dock-item${mobilePane === 'edit' ? ' icode__mobile-dock-item--active' : ''}${filesDirty || dataDirty ? ' icode__mobile-dock-item--dirty' : ''}`}
            aria-current={mobilePane === 'edit' ? 'page' : undefined}
            onClick={() => setMobilePane('edit')}
          >
            编辑
          </button>
        </nav>
      </div>

      {deleteAppModal}

      <WindowModal
        open={closePromptOpen}
        title={closePromptMode === 'switch' ? '切换应用' : '关闭应用'}
        role="alertdialog"
        themeColor={modalTheme}
        onClose={dismissNavigateAwayPrompt}
        actions={closePromptActions}
      >
        <p class="window-modal__message">当前草稿有未保存的修改。</p>
      </WindowModal>

      <WindowModal
        open={!!createFromVersionTarget}
        title="基于旧档创建新版本"
        role="alertdialog"
        themeColor={modalTheme}
        onClose={() => setCreateFromVersionTarget(undefined)}
        actions={[
          {
            key: 'cancel',
            label: '取消',
            tone: 'secondary',
            onClick: () => setCreateFromVersionTarget(undefined),
          },
          {
            key: 'create',
            label: hasDraftToSave ? '丢弃草稿并创建' : '创建',
            tone: 'primary',
            onClick: () =>
              void confirmCreateFromVersion(createFromVersionTarget?.version ?? 1),
          },
        ]}
      >
        {createFromVersionTarget && (
          <p class="window-modal__message">
            将把正式版 {createFromVersionTarget.version} 整棵拷成新的最大号
            （v{(currentMaxVersion ?? 0) + 1}），桌面立刻改跑它；当前草稿会被替换为新版的可写拷贝。
            {hasDraftToSave ? ' 当前草稿有未发布改动，继续将丢弃这些改动。' : ''}
          </p>
        )}
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
