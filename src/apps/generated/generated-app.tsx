import { useEffect, useMemo, useRef } from 'preact/hooks'
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
import { injectGeneratedAppStorageBridge } from './inject-generated-app-storage-bridge.ts'
import './generated-app.css'

type GeneratedAppProps = {
  appId: GeneratedAppId
  windowId: string
}

export function GeneratedApp({ appId, windowId }: GeneratedAppProps) {
  const { focusWindow, closeWindowsForApp, minimizeWindow, windows } = useOs()
  const { getInstalledApp, getAppDataRevision } = useGeneratedApps()
  const { showAbout } = useAboutApp()
  const app = getInstalledApp(appId)
  const dataRevision = getAppDataRevision(appId)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const srcDoc = useMemo(() => {
    if (!app) {
      return undefined
    }

    const initialData = loadGeneratedAppData(appId)
    return injectGeneratedAppStorageBridge(app.html, appId, initialData)
  }, [app, appId])

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
        <p>应用内容尚未生成</p>
      </div>
    )
  }

  return (
    <div class="generated-app">
      <iframe
        key={`${appId}-${dataRevision}`}
        ref={iframeRef}
        class="generated-app__frame"
        title={app.name}
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        onFocus={() => focusWindow(windowId)}
      />
    </div>
  )
}
