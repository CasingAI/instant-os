import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  createQuickJsInstance,
  type QuickJsConsoleLine,
  type QuickJsInstance,
} from '../../quickjs/quickjs-public.ts'
import { useAboutApp } from '../../os/about-app-context.tsx'
import { aboutAppMenuPrefix } from '../../os/about-app-menu.ts'
import { useAppMenuBar } from '../../os/menu-bar-context.tsx'
import type { MenuDefinition } from '../../os/menu-bar-types.ts'
import { useOs } from '../../os/os-context.tsx'
import './virtual-js.css'

const APP_ID = 'virtual-js' as const

const DEFAULT_SOURCE = `// Virtual JS — 系统 QuickJS 实例演示
// 同一窗口内多次运行会保留全局变量与 process 状态；关闭窗口后实例销毁。

process.stdout.write("cwd=" + process.cwd() + " HOME=" + process.env.HOME)
process.argv
// 需要结束本轮时可调用 process.exit(code)；不会销毁实例
`

type OutputKind = 'log' | 'info' | 'warn' | 'error' | 'result' | 'result-error'

type OutputLine = {
  id: string
  kind: OutputKind
  text: string
}

type InstanceUiState = 'boot' | 'ready' | 'busy' | 'error'

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }

  if (
    value === undefined ||
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value)
  }

  try {
    return JSON.stringify(value, undefined, 2)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

function consoleLineToOutput(line: QuickJsConsoleLine): OutputLine {
  return {
    id: line.id,
    kind: line.level,
    text: line.text,
  }
}

function statusLabel(state: InstanceUiState): string {
  switch (state) {
    case 'boot':
      return '正在创建实例…'
    case 'ready':
      return '实例就绪'
    case 'busy':
      return '运行中…'
    case 'error':
      return '实例错误'
  }
}

export function VirtualJsApp() {
  const { closeWindowsForApp, minimizeWindow, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const instanceRef = useRef<QuickJsInstance | undefined>(undefined)
  const mountedRef = useRef(true)
  const outputSeqRef = useRef(0)
  const [source, setSource] = useState(DEFAULT_SOURCE)
  const [outputLines, setOutputLines] = useState<OutputLine[]>([])
  const [uiState, setUiState] = useState<InstanceUiState>('boot')
  const [bootError, setBootError] = useState<string | undefined>(undefined)

  const appendOutput = useCallback((kind: OutputKind, text: string) => {
    outputSeqRef.current += 1
    const id = `vj-out-${outputSeqRef.current}`
    setOutputLines((prev) => [...prev, { id, kind, text }])
  }, [])

  const bindInstance = useCallback((instance: QuickJsInstance) => {
    if (!mountedRef.current) {
      instance.destroy()
      return
    }
    instanceRef.current?.destroy()
    instanceRef.current = instance
    setUiState('ready')
    setBootError(undefined)
  }, [])

  const createInstance = useCallback(async () => {
    setUiState('boot')
    setBootError(undefined)
    try {
      const instance = await createQuickJsInstance()
      bindInstance(instance)
    } catch (error) {
      if (!mountedRef.current) return
      instanceRef.current = undefined
      const message = error instanceof Error ? error.message : String(error)
      setBootError(message)
      setUiState('error')
    }
  }, [bindInstance])

  useEffect(() => {
    mountedRef.current = true
    void createInstance()

    return () => {
      mountedRef.current = false
      instanceRef.current?.destroy()
      instanceRef.current = undefined
    }
  }, [createInstance])

  const handleRun = useCallback(async () => {
    const instance = instanceRef.current
    if (!instance || instance.getSnapshot().destroyed || uiState === 'busy') {
      return
    }

    setUiState('busy')
    try {
      const result = await instance.eval(source)
      for (const line of result.consoleLines) {
        setOutputLines((prev) => [...prev, consoleLineToOutput(line)])
      }
      if (result.ok) {
        if (result.exited) {
          appendOutput('result', `process.exit → ${result.exitCode}`)
        } else {
          appendOutput('result', formatValue(result.value))
          if (result.exitCode !== 0) {
            appendOutput('info', `exitCode=${result.exitCode}`)
          }
        }
      } else {
        appendOutput('result-error', result.error)
      }
      setUiState(instance.getSnapshot().destroyed ? 'error' : 'ready')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      appendOutput('result-error', message)
      setUiState(instanceRef.current?.getSnapshot().destroyed ? 'error' : 'ready')
    }
  }, [appendOutput, source, uiState])

  const handleClearOutput = useCallback(() => {
    setOutputLines([])
    try {
      instanceRef.current?.clearConsole()
    } catch {
      // 实例已销毁时忽略
    }
  }, [])

  const handleRecreateInstance = useCallback(async () => {
    if (uiState === 'busy') {
      instanceRef.current?.abort()
    }
    setOutputLines([])
    appendOutput('info', '已重建 QuickJS 实例（全局变量已清空）')
    await createInstance()
  }, [appendOutput, createInstance, uiState])

  const handleStop = useCallback(() => {
    instanceRef.current?.abort()
  }, [])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleRun()
      }
    },
    [handleRun],
  )

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === APP_ID && !window.minimized)
    const canRun = uiState === 'ready'

    return [
      {
        label: 'Virtual JS',
        items: [
          ...aboutAppMenuPrefix('关于 Virtual JS', () => showBuiltinAbout(APP_ID)),
          {
            type: 'action',
            label: '隐藏 Virtual JS',
            shortcut: '⌘H',
            onClick: () => appWindow && minimizeWindow(appWindow.id),
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '退出 Virtual JS',
            shortcut: '⌘Q',
            onClick: () => closeWindowsForApp(APP_ID),
          },
        ],
      },
      {
        label: '运行',
        items: [
          {
            type: 'action',
            label: '运行',
            shortcut: '⌘↩',
            disabled: !canRun,
            onClick: () => void handleRun(),
          },
          {
            type: 'action',
            label: '停止',
            disabled: uiState !== 'busy',
            onClick: handleStop,
          },
          { type: 'separator' },
          {
            type: 'action',
            label: '清空输出',
            onClick: handleClearOutput,
          },
          {
            type: 'action',
            label: '重建实例',
            disabled: uiState === 'busy' || uiState === 'boot',
            onClick: () => void handleRecreateInstance(),
          },
        ],
      },
    ]
  }, [
    closeWindowsForApp,
    handleClearOutput,
    handleRecreateInstance,
    handleRun,
    handleStop,
    minimizeWindow,
    showBuiltinAbout,
    uiState,
    windows,
  ])

  useAppMenuBar(APP_ID, menuBar)

  const canRun = uiState === 'ready'

  return (
    <div class="virtual-js-app">
      <div class="virtual-js-app__toolbar">
        <span class="virtual-js-app__status" data-state={uiState}>
          {bootError ? `错误：${bootError}` : statusLabel(uiState)}
        </span>
        <button
          type="button"
          class="virtual-js-app__button virtual-js-app__button--primary"
          disabled={!canRun}
          onClick={() => void handleRun()}
        >
          运行
        </button>
        <button
          type="button"
          class="virtual-js-app__button"
          disabled={uiState !== 'busy'}
          onClick={handleStop}
        >
          停止
        </button>
        <button type="button" class="virtual-js-app__button" onClick={handleClearOutput}>
          清空输出
        </button>
        <button
          type="button"
          class="virtual-js-app__button"
          disabled={uiState === 'busy' || uiState === 'boot'}
          onClick={() => void handleRecreateInstance()}
        >
          重建实例
        </button>
      </div>

      <div class="virtual-js-app__editor">
        <textarea
          class="virtual-js-app__textarea"
          value={source}
          spellcheck={false}
          onInput={(event) => setSource((event.target as HTMLTextAreaElement).value)}
          onKeyDown={handleKeyDown}
          aria-label="QuickJS 源代码"
        />
      </div>

      <div class="virtual-js-app__output" role="log" aria-live="polite">
        {outputLines.length === 0 ? (
          <p class="virtual-js-app__output-empty">输出会出现在这里。按 ⌘↩ 运行。</p>
        ) : (
          outputLines.map((line) => (
            <p key={line.id} class={`virtual-js-app__line virtual-js-app__line--${line.kind}`}>
              <span class="virtual-js-app__line-prefix">
                {line.kind === 'result' || line.kind === 'result-error' ? '← ' : '› '}
              </span>
              {line.text}
            </p>
          ))
        )}
      </div>
    </div>
  )
}
