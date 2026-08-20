import { useCallback, useEffect, useRef } from 'preact/hooks'
import { useDevExtApps } from '../../os/dev-ext-apps-context.tsx'
import { useOs } from '../../os/os-context.tsx'
import type { ExtAppId } from '../../os/types.ts'
import { installGeneratedAppAiHandler } from '../generated/install-generated-app-ai-handler.ts'
import { installGeneratedAppFilesHandler } from '../generated/install-generated-app-files-handler.ts'
import { installGeneratedAppTerminalHandler } from '../generated/install-generated-app-terminal-handler.ts'
import './ext-app.css'

type ExtAppProps = {
  appId: ExtAppId
  windowId: string
}

export function ExtApp({ appId, windowId }: ExtAppProps) {
  const { focusWindow, closeWindow } = useOs()
  const { getSessionExtApp } = useDevExtApps()
  const app = getSessionExtApp(appId)
  const iframeRef = useRef<HTMLIFrameElement>(null)

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
      />
    </div>
  )
}
