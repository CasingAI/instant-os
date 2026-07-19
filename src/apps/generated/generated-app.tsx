import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import {
  EXPERIMENTAL_SETTINGS_CHANGED_EVENT,
} from '../../os/experimental-settings-storage.ts'
import {
  isGeneratedAppProcessIsolationActive,
  SANDBOXED_CORS_PROBE_COMPLETED_EVENT,
} from '../../os/resolve-generated-app-process-isolation.ts'
import {
  isGeneratedAppStorageMessage,
  loadGeneratedAppData,
  saveGeneratedAppData,
} from '../../os/generated-app-data-storage.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import type { GeneratedAppId } from '../../os/types.ts'
import { useGeneratedApps } from '../../os/generated-apps-context.tsx'
import { useGeneratedAppHeartbeat } from '../../os/generated-app-heartbeat-context.tsx'
import { GeneratedAppErrorDialog } from './generated-app-error-dialog.tsx'
import type { GeneratedAppRuntimeErrorEntry } from './generated-app-runtime-error-types.ts'
import {
  appendRuntimeErrorEntry,
  isGeneratedAppRuntimeErrorMessage,
  logRuntimeErrorToHostConsole,
} from './generated-app-runtime-errors.ts'
import { installGeneratedAppAiHandler } from './install-generated-app-ai-handler.ts'
import { installGeneratedAppFilesHandler } from './install-generated-app-files-handler.ts'
import { injectGeneratedAppHeartbeatBridge } from './inject-generated-app-heartbeat-bridge.ts'
import { prepareGeneratedAppRuntimeHtml } from './prepare-generated-app-runtime-html.ts'
import { useGeneratedHtmlIframe } from './use-generated-html-iframe.ts'
import { APP_CAPABILITY_TAG_FILES, hasAppCapabilityTag } from '../appstore/app-capability-tags.ts'
import './generated-app.css'

type GeneratedAppProps = {
  appId: GeneratedAppId
  windowId: string
}

export function GeneratedApp({ appId, windowId }: GeneratedAppProps) {
  const { focusWindow, closeWindow, closeWindowsForApp, minimizeWindow, windows } = useOs()
  const { getInstalledApp, getAppDataRevision, getFailedInstall, installListing, dismissFailedInstall } =
    useGeneratedApps()
  const { showAbout } = useAboutApp()
  const app = getInstalledApp(appId)
  const failedInstall = getFailedInstall(appId)
  const dataRevision = getAppDataRevision(appId)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [emojiFontEpoch, setEmojiFontEpoch] = useState(0)
  const [runtimeErrors, setRuntimeErrors] = useState<GeneratedAppRuntimeErrorEntry[]>([])
  const [runtimeErrorAlertOpen, setRuntimeErrorAlertOpen] = useState(false)
  const [runtimeErrorDetailsOpen, setRuntimeErrorDetailsOpen] = useState(false)
  const suppressRuntimeErrorAlertRef = useRef(false)
  const [processIsolated, setProcessIsolated] = useState(() => isGeneratedAppProcessIsolationActive())
  const {
    registerHeartbeat,
    unregisterHeartbeat,
    resetHeartbeatMonitoring,
    setHeartbeatContentWindow,
  } = useGeneratedAppHeartbeat()

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
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      setEmojiFontEpoch((epoch) => epoch + 1)
    })

    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-emoji-font-mode', 'data-emoji-font-bundled', 'data-emoji-offset'],
    })

    return () => observer.disconnect()
  }, [])

  const remountKey = `${appId}-${dataRevision}-${emojiFontEpoch}-${processIsolated ? 'iso' : 'std'}`

  const preparedHtml = useMemo(() => {
    if (!app) {
      return undefined
    }

    const initialData = loadGeneratedAppData(appId)
    const runtimeHtml = prepareGeneratedAppRuntimeHtml(app.html, appId, initialData, {
      processIsolated,
      enableFiles: hasAppCapabilityTag(app.tags, APP_CAPABILITY_TAG_FILES),
    })
    return injectGeneratedAppHeartbeatBridge(runtimeHtml, appId, windowId)
  }, [app, appId, dataRevision, emojiFontEpoch, processIsolated, windowId])

  const handleIframeReady = useCallback(() => {
    setHeartbeatContentWindow(windowId, iframeRef.current?.contentWindow ?? undefined)
  }, [setHeartbeatContentWindow, windowId])

  const { iframeProps } = useGeneratedHtmlIframe(iframeRef, preparedHtml, remountKey, {
    processIsolated,
    onReady: handleIframeReady,
  })

  useEffect(() => {
    registerHeartbeat(windowId, appId)
    return () => unregisterHeartbeat(windowId)
  }, [appId, registerHeartbeat, unregisterHeartbeat, windowId])

  useEffect(() => {
    resetHeartbeatMonitoring(windowId)
  }, [remountKey, resetHeartbeatMonitoring, windowId])

  useEffect(() => {
    setRuntimeErrors([])
    setRuntimeErrorAlertOpen(false)
    setRuntimeErrorDetailsOpen(false)
  }, [remountKey])

  const handleRuntimeError = useCallback(
    (message: Parameters<typeof appendRuntimeErrorEntry>[1]) => {
      logRuntimeErrorToHostConsole(app?.name ?? appId, message.text)
      setRuntimeErrors((current) => appendRuntimeErrorEntry(current, message))

      if (suppressRuntimeErrorAlertRef.current || runtimeErrorDetailsOpen || runtimeErrorAlertOpen) {
        return
      }

      setRuntimeErrorAlertOpen(true)
    },
    [app?.name, appId, runtimeErrorAlertOpen, runtimeErrorDetailsOpen],
  )

  const menuBar = useMemo((): MenuDefinition[] => {
    if (!app) {
      return []
    }

    const appWindow = windows.find((window) => window.appId === appId && !window.minimized)

    return [
      {
        label: app.name,
        items: [
          ...aboutAppMenuPrefix(`关于 ${app.name}`, () =>
            showAbout({
              title: app.name,
              version: app.category,
              iconEmoji: app.iconEmoji,
              themeColor: app.themeColor,
              paragraphs: [app.description],
            }),
          ),
          {
            type: 'action',
            label: `隐藏 ${app.name}`,
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: `退出 ${app.name}`,
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(appId),
          },
        ],
      },
    ]
  }, [app, appId, closeWindowsForApp, minimizeWindow, showAbout, windows])

  useAppMenuBar(appId, menuBar)

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) {
        return
      }

      if (isGeneratedAppRuntimeErrorMessage(event.data)) {
        if (event.data.appId !== appId) {
          return
        }

        handleRuntimeError(event.data)
        return
      }

      if (!isGeneratedAppStorageMessage(event.data)) {
        return
      }

      if (event.data.appId !== appId) {
        return
      }

      saveGeneratedAppData(appId, event.data.data)
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [appId, handleRuntimeError])

  useEffect(() => {
    return installGeneratedAppAiHandler({
      appId,
      appName: app?.name,
      getContentWindow: () => iframeRef.current?.contentWindow ?? undefined,
    })
  }, [app?.name, appId])

  useEffect(() => {
    if (!app) return
    if (!hasAppCapabilityTag(app.tags, APP_CAPABILITY_TAG_FILES)) return

    return installGeneratedAppFilesHandler({
      appId,
      getContentWindow: () => iframeRef.current?.contentWindow ?? undefined,
      isAllowed: () => hasAppCapabilityTag(app.tags, APP_CAPABILITY_TAG_FILES),
    })
  }, [app, appId])

  if (!app) {
    return (
      <div class="generated-app generated-app--empty">
        <div class="generated-app__empty-card">
          <p class="generated-app__empty-title">
            {failedInstall
              ? failedInstall.isUpdate
                ? '应用更新失败'
                : '应用生成失败'
              : '应用不可用'}
          </p>
          <p class="generated-app__empty-message">
            {failedInstall?.error ?? '该应用尚未安装或已被移除。'}
          </p>
          <div class="generated-app__empty-actions">
            {failedInstall && (
              <button
                type="button"
                class="generated-app__empty-action generated-app__empty-action--primary"
                onClick={() => {
                  dismissFailedInstall(appId)
                  void installListing(failedInstall.listing)
                }}
              >
                重试
              </button>
            )}
            <button
              type="button"
              class="generated-app__empty-action"
              onClick={() => closeWindow(windowId)}
            >
              关闭窗口
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div class="generated-app">
      <iframe
        key={remountKey}
        ref={iframeRef}
        class="generated-app__frame"
        title={app.name}
        {...iframeProps}
        onFocus={() => focusWindow(windowId)}
      />
      <GeneratedAppErrorDialog
        appName={app.name}
        themeColor={app.themeColor}
        errors={runtimeErrors}
        alertOpen={runtimeErrorAlertOpen}
        detailsOpen={runtimeErrorDetailsOpen}
        onIgnore={() => {
          setRuntimeErrorAlertOpen(false)
        }}
        onSuppressAlerts={() => {
          suppressRuntimeErrorAlertRef.current = true
          setRuntimeErrorAlertOpen(false)
        }}
        onOpenDetails={() => {
          setRuntimeErrorAlertOpen(false)
          setRuntimeErrorDetailsOpen(true)
        }}
        onCloseDetails={() => setRuntimeErrorDetailsOpen(false)}
      />
    </div>
  )
}
