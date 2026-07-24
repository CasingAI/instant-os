import { useCallback, useMemo, useRef } from 'preact/hooks'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import { TerminalReplPanel, type TerminalReplHandle } from './terminal-repl-panel.tsx'
import './terminal-repl-shell.css'

const APP_ID = 'terminal' as const
const WORKSPACE_ROOT = '/user'

/** 系统终端：原生 QuickJS / Node 兼容运行时，可操作虚拟文件系统与宿主能力。 */
export function TerminalApp() {
  const { closeWindowsForApp, minimizeWindow, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const handleRef = useRef<TerminalReplHandle | null>(null)
  const busyRef = useRef(false)

  const welcomeLines = useMemo(
    () => [
      '终端 · 系统原生 JavaScript 运行时（QuickJS + Node 兼容层）',
      `工作区 ${WORKSPACE_ROOT} · 回车执行 · ⌘K 清屏 · .reset 重建实例`,
    ],
    [],
  )

  const clearScreen = useCallback(() => {
    handleRef.current?.clear()
  }, [])

  const resetInstance = useCallback(() => {
    void handleRef.current?.runCode('.reset')
  }, [])

  const handleAbort = useCallback(() => {
    handleRef.current?.abort()
  }, [])

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === APP_ID && !window.minimized)

    return [
      {
        label: '终端',
        items: [
          ...aboutAppMenuPrefix('关于终端', () => showBuiltinAbout(APP_ID)),
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
            onClick: clearScreen,
          },
          {
            type: 'action',
            label: '重建实例',
            onClick: resetInstance,
          },
          {
            type: 'action',
            label: '停止',
            disabled: !busyRef.current,
            onClick: handleAbort,
          },
        ],
      },
    ]
  }, [
    clearScreen,
    closeWindowsForApp,
    handleAbort,
    minimizeWindow,
    resetInstance,
    showBuiltinAbout,
    windows,
  ])

  useAppMenuBar(APP_ID, menuBar)

  return (
    <div class="terminal-repl-app">
      <TerminalReplPanel
        workspaceRoot={WORKSPACE_ROOT}
        handleRef={handleRef}
        welcomeLines={welcomeLines}
      />
    </div>
  )
}
