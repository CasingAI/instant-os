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
import { injectScene3dBridge } from '../../assets/3d/inject-scene3d-bridge.ts'
import { ensureIframeBlankDocument, writeHtmlToIframe } from '../../assets/3d/write-html-to-iframe.ts'
import { injectIframeEmojiFonts } from '../../fonts/inject-iframe-emoji-fonts.ts'
import { generatedAppNeeds3d } from './generated-app-tags.ts'
import { injectGeneratedAppStorageBridge } from './inject-generated-app-storage-bridge.ts'
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

  const needs3d = app
    ? generatedAppNeeds3d(app.html, {
        name: app.name,
        description: app.description,
        category: app.category,
        tags: app.tags,
      })
    : false

  const preparedHtml = useMemo(() => {
    if (!app) {
      return undefined
    }

    const initialData = loadGeneratedAppData(appId)
    let html = injectGeneratedAppStorageBridge(app.html, appId, initialData)
    html = injectIframeEmojiFonts(html)
    if (needs3d) {
      html = injectScene3dBridge(html)
    }
    return html
  }, [app, appId, dataRevision, emojiFontEpoch, needs3d])

  const writePreparedHtmlToIframe = useCallback(() => {
    if (!needs3d || !preparedHtml) {
      return
    }

    writeHtmlToIframe(iframeRef.current, preparedHtml)
  }, [needs3d, preparedHtml])

  useEffect(() => {
    if (!needs3d) {
      return
    }

    ensureIframeBlankDocument(iframeRef.current)
    writePreparedHtmlToIframe()
  }, [needs3d, writePreparedHtmlToIframe, appId, dataRevision])

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
  }, [appId])

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
        key={needs3d ? `${appId}-${dataRevision}-3d` : `${appId}-${dataRevision}`}
        ref={iframeRef}
        class="generated-app__frame"
        title={app.name}
        sandbox={needs3d ? 'allow-scripts allow-same-origin' : 'allow-scripts'}
        src={needs3d ? 'about:blank' : undefined}
        srcDoc={needs3d ? undefined : preparedHtml}
        onLoad={needs3d ? writePreparedHtmlToIframe : undefined}
        onFocus={() => focusWindow(windowId)}
      />
    </div>
  )
}
