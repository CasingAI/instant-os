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
import {
  DEFAULT_VIRTUAL_JS_SAMPLE_ID,
  getVirtualJsSample,
  VIRTUAL_JS_SAMPLES,
} from './virtual-js-samples.ts'
import './virtual-js.css'

const APP_ID = 'virtual-js' as const

type OutputKind = 'log' | 'info' | 'warn' | 'error' | 'result' | 'result-error'

type OutputLine = {
  id: string
  kind: OutputKind
  text: string
}

type InstanceUiState = 'boot' | 'ready' | 'busy' | 'stopped' | 'error'

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

  // ESM eval 返回模块命名空间时，优先展示 default
  if (typeof value === 'object' && value !== null && 'default' in value) {
    const record = value as { default: unknown }
    if (Object.keys(value).length === 1 || record.default !== undefined) {
      try {
        return formatValue(record.default)
      } catch {
        // fall through
      }
    }
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
      return '实例就绪（可再运行）'
    case 'busy':
      return '执行中…'
    case 'stopped':
      return '已停止（实例已销毁）'
    case 'error':
      return '实例错误'
  }
}

function initialSampleSource(): string {
  return getVirtualJsSample(DEFAULT_VIRTUAL_JS_SAMPLE_ID)?.source ?? ''
}

export function VirtualJsApp() {
  const { closeWindowsForApp, minimizeWindow, windows } = useOs()
  const { showBuiltinAbout } = useAboutApp()
  const instanceRef = useRef<QuickJsInstance | undefined>(undefined)
  const mountedRef = useRef(true)
  const outputSeqRef = useRef(0)
  const [activeSampleId, setActiveSampleId] = useState(DEFAULT_VIRTUAL_JS_SAMPLE_ID)
  const [source, setSource] = useState(initialSampleSource)
  const [outputLines, setOutputLines] = useState<OutputLine[]>([])
  const [uiState, setUiState] = useState<InstanceUiState>('boot')
  const [bootError, setBootError] = useState<string | undefined>(undefined)

  const activeSample = useMemo(
    () => getVirtualJsSample(activeSampleId) ?? VIRTUAL_JS_SAMPLES[0],
    [activeSampleId],
  )

  const appendOutput = useCallback((kind: OutputKind, text: string) => {
    outputSeqRef.current += 1
    const id = `vj-out-${outputSeqRef.current}`
    setOutputLines((prev) => [...prev, { id, kind, text }])
  }, [])

  const seenConsoleIdsRef = useRef(new Set<string>())
  const unsubRef = useRef<(() => void) | undefined>(undefined)

  const syncConsoleFromInstance = useCallback((instance: QuickJsInstance) => {
    const lines = instance.getSnapshot().consoleLines
    const fresh: OutputLine[] = []
    for (const line of lines) {
      if (seenConsoleIdsRef.current.has(line.id)) {
        continue
      }
      seenConsoleIdsRef.current.add(line.id)
      fresh.push(consoleLineToOutput(line))
    }
    if (fresh.length > 0) {
      setOutputLines((prev) => [...prev, ...fresh])
    }
  }, [])

  const bindInstance = useCallback(
    (instance: QuickJsInstance) => {
      if (!mountedRef.current) {
        instance.destroy()
        return
      }
      unsubRef.current?.()
      instanceRef.current?.destroy()
      instanceRef.current = instance
      seenConsoleIdsRef.current = new Set()
      unsubRef.current = instance.subscribe(() => {
        if (!mountedRef.current || instanceRef.current !== instance) {
          return
        }
        syncConsoleFromInstance(instance)
        const snap = instance.getSnapshot()
        if (snap.destroyed) {
          // 主动停止走 handleStop；此处多为异常销毁
          instanceRef.current = undefined
          setUiState('error')
          return
        }
        // busy 仅同步切片；有挂起 timer 时仍为 ready，可再往同一实例塞代码
        setUiState(snap.busy ? 'busy' : 'ready')
      })
      setUiState('ready')
      setBootError(undefined)
    },
    [syncConsoleFromInstance],
  )

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
      unsubRef.current?.()
      unsubRef.current = undefined
      instanceRef.current?.destroy()
      instanceRef.current = undefined
    }
  }, [createInstance])

  const loadSample = useCallback(
    async (sampleId: string) => {
      const sample = getVirtualJsSample(sampleId)
      if (sample === undefined) {
        return
      }

      const switching = sample.id !== activeSampleId
      setActiveSampleId(sample.id)
      setSource(sample.source)

      if (!switching) {
        return
      }

      if (uiState === 'busy') {
        instanceRef.current?.abort()
      }
      setOutputLines([])
      appendOutput('info', `已切换「${sample.title}」· 实例已重建`)
      await createInstance()
    },
    [activeSampleId, appendOutput, createInstance, uiState],
  )

  const destroyInstanceWithExitCode = useCallback(
    (exitCode: number, reason: 'stop' | 'process.exit') => {
      const instance = instanceRef.current
      if (instance !== undefined) {
        syncConsoleFromInstance(instance)
        unsubRef.current?.()
        unsubRef.current = undefined
        instanceRef.current = undefined
        if (!instance.getSnapshot().destroyed) {
          instance.destroy()
        }
      }
      const label =
        reason === 'process.exit' ? 'process.exit' : '已停止'
      appendOutput('result', `${label}并销毁实例 · exitCode=${exitCode}`)
      setUiState('stopped')
    },
    [appendOutput, syncConsoleFromInstance],
  )

  const handleRun = useCallback(async () => {
    const instance = instanceRef.current
    if (!instance || instance.getSnapshot().destroyed || uiState === 'busy') {
      return
    }

    setUiState('busy')
    try {
      const snap = instance.getSnapshot()
      appendOutput(
        'info',
        `── run · cwd=${snap.cwd} exitCode=${snap.exitCode} · ${activeSample?.title ?? 'custom'} ──`,
      )
      const result = await instance.eval(source)
      // console 已由 subscribe 流式追加；这里只展示 REPL 结果 / exit
      syncConsoleFromInstance(instance)
      if (result.ok) {
        if (result.exited) {
          // Virtual JS：实例=进程，process.exit 即结束进程（销毁实例）
          destroyInstanceWithExitCode(result.exitCode, 'process.exit')
          return
        }
        appendOutput('result', formatValue(result.value))
        if (result.exitCode !== 0) {
          appendOutput('info', `exitCode=${result.exitCode}`)
        }
        setUiState(instance.getSnapshot().destroyed ? 'error' : 'ready')
      } else {
        appendOutput('result-error', result.error)
        setUiState(instance.getSnapshot().destroyed ? 'error' : 'ready')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      appendOutput('result-error', message)
      setUiState(instanceRef.current?.getSnapshot().destroyed ? 'error' : 'ready')
    }
  }, [
    activeSample?.title,
    appendOutput,
    destroyInstanceWithExitCode,
    source,
    syncConsoleFromInstance,
    uiState,
  ])

  const handleClearOutput = useCallback(() => {
    setOutputLines([])
    seenConsoleIdsRef.current = new Set()
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
    // 重建实例不清输出历史（由外层面板保留）
    appendOutput('info', '已重建 QuickJS 实例（全局变量已清空；输出历史保留）')
    await createInstance()
  }, [appendOutput, createInstance, uiState])

  const handleStop = useCallback(() => {
    const instance = instanceRef.current
    if (instance === undefined) {
      return
    }
    const exitCode = instance.getSnapshot().exitCode
    destroyInstanceWithExitCode(exitCode, 'stop')
  }, [destroyInstanceWithExitCode])

  const handleResetSample = useCallback(() => {
    if (activeSample === undefined) {
      return
    }
    setSource(activeSample.source)
  }, [activeSample])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleRun()
      }
    },
    [handleRun],
  )

  const canRun = uiState === 'ready'
  const canStop = uiState === 'ready' || uiState === 'busy'
  const canRecreate = uiState !== 'busy' && uiState !== 'boot'

  const menuBar = useMemo((): MenuDefinition[] => {
    const appWindow = windows.find((window) => window.appId === APP_ID && !window.minimized)

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
            label: '停止（销毁实例）',
            disabled: !canStop,
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
            label: '重置当前用例',
            onClick: handleResetSample,
          },
          {
            type: 'action',
            label: '重建实例',
            disabled: !canRecreate,
            onClick: () => void handleRecreateInstance(),
          },
        ],
      },
    ]
  }, [
    canRecreate,
    canRun,
    canStop,
    closeWindowsForApp,
    handleClearOutput,
    handleRecreateInstance,
    handleResetSample,
    handleRun,
    handleStop,
    minimizeWindow,
    showBuiltinAbout,
    windows,
  ])

  useAppMenuBar(APP_ID, menuBar)

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
          disabled={!canStop}
          onClick={handleStop}
          title="销毁当前 QuickJS 实例（不自动重建）"
        >
          停止
        </button>
        <button type="button" class="virtual-js-app__button" onClick={handleClearOutput}>
          清空输出
        </button>
        <button type="button" class="virtual-js-app__button" onClick={handleResetSample}>
          重置用例
        </button>
        <button
          type="button"
          class="virtual-js-app__button"
          disabled={!canRecreate}
          onClick={() => void handleRecreateInstance()}
        >
          重建实例
        </button>
      </div>

      <div class="virtual-js-app__body">
        <aside class="virtual-js-app__samples" aria-label="内置测试用例">
          <div class="virtual-js-app__samples-head">测试用例</div>
          <ul class="virtual-js-app__sample-list">
            {VIRTUAL_JS_SAMPLES.map((sample) => {
              const selected = sample.id === activeSampleId
              return (
                <li key={sample.id}>
                  <button
                    type="button"
                    class={
                      selected
                        ? 'virtual-js-app__sample virtual-js-app__sample--active'
                        : 'virtual-js-app__sample'
                    }
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => void loadSample(sample.id)}
                  >
                    <span class="virtual-js-app__sample-title">{sample.title}</span>
                    <span class="virtual-js-app__sample-blurb">{sample.blurb}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>

        <div class="virtual-js-app__main">
          <div class="virtual-js-app__editor-meta">
            <span class="virtual-js-app__editor-title">{activeSample?.title ?? '脚本'}</span>
            <span class="virtual-js-app__editor-blurb">{activeSample?.blurb}</span>
          </div>
          <div class="virtual-js-app__editor">
            <textarea
              class="virtual-js-app__textarea"
              value={source}
              spellCheck={false}
              onInput={(event) => setSource((event.target as HTMLTextAreaElement).value)}
              onKeyDown={handleKeyDown}
              aria-label="QuickJS 源代码"
            />
          </div>

          <div class="virtual-js-app__output" role="log" aria-live="polite">
            {outputLines.length === 0 ? (
              <p class="virtual-js-app__output-empty">
                「运行」往同一进程塞代码。「停止」或脚本里 process.exit
                都会销毁实例并显示 exitCode。之后需「重建实例」或切换用例。
              </p>
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
      </div>
    </div>
  )
}
