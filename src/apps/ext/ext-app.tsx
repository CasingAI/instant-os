import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { useDevExtApps } from '../../os/dev-ext-apps-context.tsx'
import {
  buildExtAppBootstrapMessage,
  buildExtAppEmojiUpdateMessage,
  extAppWebViewOwnerId,
  isExtAppBootstrapRequestMessage,
} from '../../os/ext-app-bootstrap.ts'
import { useGeneratedAppHeartbeat } from '../../os/generated-app-heartbeat-context.tsx'
import {
  GENERATED_APP_STORAGE_ERROR_MESSAGE_TYPE,
  isGeneratedAppStorageMessage,
  loadGeneratedAppData,
  saveGeneratedAppDataAsync,
} from '../../os/generated-app-data-storage.ts'
import { getRegistryUsedBytesSync, getRegistryWriteLimitBytes, hydrateAppRegistry } from '../../os/app-registry.ts'
import { DATA_CAPACITY_BYTES } from '../../os/device-data-storage.ts'
import { useOs } from '../../os/os-context.tsx'
import type { ExtAppId } from '../../os/types.ts'
import { APP_CAPABILITY_TAG_WEBVIEW } from '../appstore/app-capability-tags.ts'
import { GeneratedAppErrorDialog } from '../generated/generated-app-error-dialog.tsx'
import type { GeneratedAppRuntimeErrorEntry } from '../generated/generated-app-runtime-error-types.ts'
import {
  appendRuntimeErrorEntry,
  isGeneratedAppRuntimeErrorMessage,
  logRuntimeErrorToHostConsole,
} from '../generated/generated-app-runtime-errors.ts'
import { installGeneratedAppAiHandler } from '../generated/install-generated-app-ai-handler.ts'
import { installGeneratedAppFilesHandler } from '../generated/install-generated-app-files-handler.ts'
import { installGeneratedAppTerminalHandler } from '../generated/install-generated-app-terminal-handler.ts'
import { installGeneratedAppWebViewHandler } from '../generated/install-generated-app-webview-handler.ts'
import './ext-app.css'

type ExtAppProps = {
  appId: ExtAppId
  windowId: string
}

export function ExtApp({ appId, windowId }: ExtAppProps) {
  const { focusWindow, closeWindow, openApp, restoreWindow, windows } = useOs()
  const { getSessionExtApp } = useDevExtApps()
  const app = getSessionExtApp(appId)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const windowsRef = useRef(windows)
  windowsRef.current = windows
  const bootstrapReadyRef = useRef(false)
  const [registryHydrated, setRegistryHydrated] = useState(false)
  const [storageLimitBytes, setStorageLimitBytes] = useState<number | undefined>(undefined)
  const [runtimeErrors, setRuntimeErrors] = useState<GeneratedAppRuntimeErrorEntry[]>([])
  const [runtimeErrorAlertOpen, setRuntimeErrorAlertOpen] = useState(false)
  const [runtimeErrorDetailsOpen, setRuntimeErrorDetailsOpen] = useState(false)
  const suppressRuntimeErrorAlertRef = useRef(false)
  const {
    registerHeartbeat,
    unregisterHeartbeat,
    setHeartbeatContentWindow,
  } = useGeneratedAppHeartbeat()

  const postToIframe = useCallback((message: unknown) => {
    try {
      iframeRef.current?.contentWindow?.postMessage(message, '*')
    } catch {
      // iframe 已卸载
    }
  }, [])

  const sendBootstrap = useCallback(() => {
    if (!registryHydrated || storageLimitBytes === undefined) {
      return
    }
    const contentWindow = iframeRef.current?.contentWindow
    if (!contentWindow) {
      return
    }
    try {
      contentWindow.postMessage(
        buildExtAppBootstrapMessage({
          appId,
          windowId,
          storage: {
            data: loadGeneratedAppData(appId),
            usedBytes: getRegistryUsedBytesSync(appId),
            limitBytes: storageLimitBytes,
          },
        }),
        '*',
      )
      bootstrapReadyRef.current = true
    } catch {
      // iframe 已卸载
    }
  }, [appId, registryHydrated, storageLimitBytes, windowId])

  useEffect(() => {
    let alive = true
    bootstrapReadyRef.current = false
    setRegistryHydrated(false)
    setStorageLimitBytes(undefined)
    hydrateAppRegistry(appId)
      .then(() => {
        if (alive) {
          setRegistryHydrated(true)
        }
      })
      .catch(() => {
        if (alive) {
          setRegistryHydrated(true)
        }
      })
    return () => {
      alive = false
    }
  }, [appId])

  useEffect(() => {
    if (!registryHydrated) {
      return
    }
    let alive = true
    void getRegistryWriteLimitBytes(appId)
      .then((limit) => {
        if (alive) {
          setStorageLimitBytes(limit)
        }
      })
      .catch(() => {
        if (alive) {
          setStorageLimitBytes(DATA_CAPACITY_BYTES)
        }
      })
    return () => {
      alive = false
    }
  }, [appId, registryHydrated])

  useEffect(() => {
    sendBootstrap()
  }, [sendBootstrap])

  useEffect(() => {
    if (!app) {
      return
    }
    registerHeartbeat(windowId, appId)
    return () => unregisterHeartbeat(windowId)
  }, [app, appId, registerHeartbeat, unregisterHeartbeat, windowId])

  const handleIframeLoad = useCallback(() => {
    setHeartbeatContentWindow(windowId, iframeRef.current?.contentWindow ?? undefined)
    sendBootstrap()
  }, [sendBootstrap, setHeartbeatContentWindow, windowId])

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      postToIframe(buildExtAppEmojiUpdateMessage(appId))
    })
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-emoji-font-mode', 'data-emoji-font-bundled', 'data-emoji-offset'],
    })
    return () => observer.disconnect()
  }, [appId, postToIframe])

  const handleRuntimeError = useCallback(
    (message: Parameters<typeof appendRuntimeErrorEntry>[1]) => {
      logRuntimeErrorToHostConsole(app?.manifest.name ?? appId, message.text)
      setRuntimeErrors((current) => appendRuntimeErrorEntry(current, message))

      if (suppressRuntimeErrorAlertRef.current || runtimeErrorDetailsOpen || runtimeErrorAlertOpen) {
        return
      }

      setRuntimeErrorAlertOpen(true)
    },
    [app?.manifest.name, appId, runtimeErrorAlertOpen, runtimeErrorDetailsOpen],
  )

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) {
        return
      }

      if (isExtAppBootstrapRequestMessage(event.data) && event.data.appId === appId) {
        sendBootstrap()
        return
      }

      if (isGeneratedAppRuntimeErrorMessage(event.data)) {
        if (event.data.appId !== appId) {
          return
        }
        handleRuntimeError(event.data)
        return
      }

      if (!isGeneratedAppStorageMessage(event.data) || event.data.appId !== appId) {
        return
      }

      if (!bootstrapReadyRef.current) {
        return
      }

      void saveGeneratedAppDataAsync(appId, event.data.data).then((failures) => {
        if (failures.length === 0) {
          return
        }
        const quotaFailed = failures.some(
          (failure) => failure.error.name === 'RegistryQuotaExceededError',
        )
        const previousSnapshot: Record<string, string | undefined> = {}
        for (const failure of failures) {
          previousSnapshot[failure.key] = failure.previous
        }
        postToIframe({
          type: GENERATED_APP_STORAGE_ERROR_MESSAGE_TYPE,
          appId,
          error: quotaFailed ? 'quota-exceeded' : 'unknown',
          failedKeys: failures.map((failure) => failure.key),
          previousSnapshot,
        })
      })
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [appId, handleRuntimeError, postToIframe, sendBootstrap])

  useEffect(() => {
    if (!app?.manifest.tags.includes('ai')) {
      return
    }

    return installGeneratedAppAiHandler({
      appId,
      appName: app.manifest.name,
      getContentWindow: () => iframeRef.current?.contentWindow ?? undefined,
    })
  }, [app?.manifest.name, app?.manifest.tags, appId])

  useEffect(() => {
    if (!app?.manifest.tags.includes('files')) {
      return
    }

    return installGeneratedAppFilesHandler({
      appId,
      getContentWindow: () => iframeRef.current?.contentWindow ?? undefined,
      isAllowed: () => app.manifest.tags.includes('files'),
    })
  }, [app, appId])

  useEffect(() => {
    if (!app?.manifest.tags.includes('terminal')) {
      return
    }

    return installGeneratedAppTerminalHandler({
      appId,
      getContentWindow: () => iframeRef.current?.contentWindow ?? undefined,
      isAllowed: () => app.manifest.tags.includes('terminal'),
    })
  }, [app, appId])

  useEffect(() => {
    if (!app?.manifest.tags.includes(APP_CAPABILITY_TAG_WEBVIEW)) {
      return
    }

    return installGeneratedAppWebViewHandler({
      appId,
      getContentWindow: () => iframeRef.current?.contentWindow ?? undefined,
      isAllowed: () => app.manifest.tags.includes(APP_CAPABILITY_TAG_WEBVIEW),
      host: {
        ownerId: extAppWebViewOwnerId(windowId),
        openApp: (webviewAppId, options) => openApp(webviewAppId, options),
        getWindows: () => windowsRef.current,
        focusWindow,
        restoreWindow,
        closeWindow,
        openDevToolsApp: (documentId) => {
          openApp('page-devtools', { documentId })
        },
      },
    })
  }, [app, appId, closeWindow, focusWindow, openApp, restoreWindow, windowId])

  const handleFocus = useCallback(() => {
    focusWindow(windowId)
  }, [focusWindow, windowId])

  if (!app) {
    return (
      <div class="ext-app ext-app--empty">
        <div class="ext-app__empty-card">
          <p class="ext-app__empty-title">外链应用不可用</p>
          <p class="ext-app__empty-message">
            该调试应用已从桌面移除，或本次会话已结束。可在「系统设置 → 开发者选项」重新添加。
          </p>
          <button type="button" class="ext-app__empty-action" onClick={() => closeWindow(windowId)}>
            关闭窗口
          </button>
        </div>
      </div>
    )
  }

  return (
    <div class="ext-app">
      <iframe
        ref={iframeRef}
        class="ext-app__frame"
        title={app.manifest.name}
        src={app.entryUrl}
        sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"
        allow="clipboard-read; clipboard-write"
        onFocus={handleFocus}
        onLoad={handleIframeLoad}
      />
      <GeneratedAppErrorDialog
        appName={app.manifest.name}
        themeColor={app.manifest.themeColor}
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
