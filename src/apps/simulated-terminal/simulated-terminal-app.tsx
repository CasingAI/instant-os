/**
 * @deprecated 模拟终端已弃用：这是一个基于 LLM 调文件工具的自然语言壳层演示，
 * 非原生 JS 运行时。已被真终端（terminal app，QuickJS 直接执行 JS）取代。
 * 保留仅为过渡，新功能不要加在这里。
 *
 * 真终端入口：src/apps/terminal/terminal-app.tsx
 * 模拟终端的运行时（terminal-panel / terminal-session / terminal-agent / terminal-fs-tools 等）
 * 也一并弃用，见 src/terminal/ 下各文件的 @deprecated 标注。
 * 共享基础设施（特权对话框、配色、路径解析、类型定义等）不受影响。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { TerminalPanel } from '../../terminal/terminal-panel.tsx'
import type { TerminalHandle } from '../../terminal/terminal-types.ts'
import {
  subscribeTerminalPendingActions,
  takeTerminalPendingAction,
} from '../../terminal/terminal-pending-actions.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import './simulated-terminal-app.css'

// @deprecated 模拟终端已弃用，此 APP_ID 为遗留标识符，后续移除
const APP_ID = 'simulated-terminal' as const

function menuCheckPrefix(active: boolean): string {
  return active ? '✓ ' : ''
}

/**
 * @deprecated 模拟终端已弃用：基于 LLM 调文件工具的自然语言壳层演示，非原生 JS 运行时。
 * 已被真终端（terminal app，QuickJS 直接执行 JS）取代。保留仅为过渡，新功能不要加在这里。
 * 运行时链：TerminalPanel → TerminalSession → askTerminalAgent → createTerminalFsTools。
 * 相关文件一并弃用，见 src/terminal/ 下各文件的 @deprecated 标注。
 */
export function SimulatedTerminalApp() {
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
    return [
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
    handleClear,
    handleStop,
    thinkingEnabled,
  ])

  useAppMenuBar(APP_ID, menuBar)

  return (
    <div class="simulated-terminal-app">
      <TerminalPanel
        usageActor={APP_ID}
        thinkingEnabled={thinkingEnabled}
        handleRef={handleRef}
        onBusyChange={setBusy}
      />
    </div>
  )
}
