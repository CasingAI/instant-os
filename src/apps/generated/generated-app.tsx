import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
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
import { GeneratedAppErrorDialog } from './generated-app-error-dialog.tsx'
import type { GeneratedAppRuntimeErrorEntry } from './generated-app-runtime-error-types.ts'
import {
  appendRuntimeErrorEntry,
  isGeneratedAppRuntimeErrorMessage,
  logRuntimeErrorToHostConsole,
} from './generated-app-runtime-errors.ts'
import { installGeneratedAppAiHandler } from './install-generated-app-ai-handler.ts'
import { prepareGeneratedAppRuntimeHtml } from './prepare-generated-app-runtime-html.ts'
import { useGeneratedHtmlIframe } from './use-generated-html-iframe.ts'
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

  const remountKey = `${appId}-${dataRevision}-${emojiFontEpoch}`

  const preparedHtml = useMemo(() => {
    if (!app) {
      return undefined
    }

    const initialData = loadGeneratedAppData(appId)
    return prepareGeneratedAppRuntimeHtml(app.html, appId, initialData)
  }, [app, appId, dataRevision, emojiFontEpoch])

  const { iframeProps } = useGeneratedHtmlIframe(iframeRef, preparedHtml, remountKey)

  useEffect(() => {
    setRuntimeErrors([])
    setRuntimeErrorAlertOpen(false)
    setRuntimeErrorDetailsOpen(false)
  }, [remountKey])

  const handleRuntimeError = useCallback(
    (message: Parameters<typeof appendRuntimeErrorEntry>[1]) => {
      logRuntimeErrorToHostConsole(app?.name ?? appId, message.text)
      setRuntimeErrors((current) => appendRuntimeErrorEntry(current, message))

      if (runtimeErrorDetailsOpen || runtimeErrorAlertOpen) {
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
        onExit={() => closeWindowsForApp(appId)}
        onOpenDetails={() => {
          setRuntimeErrorAlertOpen(false)
          setRuntimeErrorDetailsOpen(true)
        }}
        onCloseDetails={() => setRuntimeErrorDetailsOpen(false)}
      />
    </div>
  )
}
