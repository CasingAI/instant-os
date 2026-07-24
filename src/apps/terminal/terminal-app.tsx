import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { TerminalPanel } from '../../terminal/terminal-panel.tsx'
import type { TerminalHandle } from '../../terminal/terminal-types.ts'
import {
  subscribeTerminalPendingActions,
  takeTerminalPendingAction,
} from '../../terminal/terminal-pending-actions.ts'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import './terminal-app.css'

const APP_ID = 'terminal' as const

function menuCheckPrefix(active: boolean): string {
  return active ? '✓ ' : ''
}

export function TerminalApp() {
  const { closeWindowsForApp, minimizeWindow, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const handleRef = useRef<TerminalHandle | null>(null)
  const [thinkingEnabled, setThinkingEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const drainingPendingRef = useRef(false)

  const drainPendingActions = useCallback(async () => {
    if (drainingPendingRef.current) return
    drainingPendingRef.current = true
    try {
      while (true) {
        const handle = handleRef.current
        if (!handle) break
        const action = takeTerminalPendingAction()
        if (!action) break
        handle.write(`[特权] 来源 ${action.source}：${action.summary || action.kind}`)
        await handle.runPrivilege(action)
      }
    } finally {
      drainingPendingRef.current = false
    }
  }, [])

  useEffect(() => {
    const tryDrain = () => {
      void drainPendingActions()
    }
    tryDrain()
    const timer = window.setInterval(tryDrain, 250)
    const unsubscribe = subscribeTerminalPendingActions(tryDrain)
    return () => {
      window.clearInterval(timer)
      unsubscribe()
    }
  }, [drainPendingActions])

  const handleClear = useCallback(() => {
    handleRef.current?.clear()
  }, [])

  const handleStop = useCallback(() => {
    handleRef.current?.abort()
  }, [])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === APP_ID && !window.minimized)

    return [
      {
        label: '终端',
        items: [
          ...aboutAppMenuPrefix('关于终端（弃用）', () => showBuiltinAbout(APP_ID)),
          {
            type: 'action',
            label: '隐藏终端',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出终端',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
      {
        label: '编辑',
        items: [
          {
            type: 'action',
            label: '清屏',
            shortcut: '⌘K',
            onClick: handleClear,
          },
          {
            type: 'action',
            label: '停止',
            disabled: !busy,
            onClick: handleStop,
          },
        ],
      },
      {
        label: '视图',
        items: [
          {
            type: 'action',
            label: `${menuCheckPrefix(thinkingEnabled)}深度思考`,
            onClick: () => setThinkingEnabled((value) => !value),
          },
        ],
      },
    ]
  }, [
    busy,
    closeWindowsForApp,
    handleClear,
    handleStop,
    minimizeWindow,
    showBuiltinAbout,
    thinkingEnabled,
    windows,
  ])

  useAppMenuBar(APP_ID, menuBar)

  return (
    <div class="terminal-app">
      <TerminalPanel
        usageActor={APP_ID}
        thinkingEnabled={thinkingEnabled}
        handleRef={handleRef}
        onBusyChange={setBusy}
      />
    </div>
  )
}
