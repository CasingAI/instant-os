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
import { useSystemOpenDialog } from '../../window/system-open-dialog.tsx'
import {
  DEFAULT_VIRTUAL_JS_SAMPLE_ID,
  formatVirtualJsSampleTitle,
  getVirtualJsSample,
  VIRTUAL_JS_SAMPLE_LIST,
} from './virtual-js-samples.ts'
import {
  readVirtualJsWorkspaceFile,
  saveVirtualJsWorkspaceFile,
  seedVirtualJsDemoProject,
  virtualJsFileBasename,
} from './virtual-js-workspace.ts'
import './virtual-js.css'

const APP_ID = 'virtual-js' as const
/** 工作区文件模式（非内置用例）。 */
const WORKSPACE_FILE_SAMPLE_ID = '__workspace_file__' as const
const SCRIPT_ACCEPT_EXTENSIONS = ['js', 'mjs', 'cjs'] as const
const WORKSPACE_ROOT = '/user'

type OutputKind = 'log' | 'info' | 'warn' | 'error' | 'result' | 'result-error'

type OutputLine = {
  id: string
  kind: OutputKind
  text: string
}

type InstanceUiState = 'boot' | 'ready' | 'busy' | 'stopped' | 'error'

type SuiteCaseResult = {
  title: string
  ok: boolean
  summary: string
  exited: boolean
}

function sleep(ms: number, shouldAbort: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      if (shouldAbort() || Date.now() - started >= ms) {
        resolve()
        return
      }
      window.setTimeout(tick, 50)
    }
    window.setTimeout(tick, Math.min(50, ms))
  })
}

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

function statusLabel(state: InstanceUiState, testingAll: boolean): string {
  if (testingAll) {
    return '测试全部进行中…'
  }
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
  const { showSystemOpenDialog, dialog: openDialog } = useSystemOpenDialog()
  const instanceRef = useRef<QuickJsInstance | undefined>(undefined)
  const mountedRef = useRef(true)
  const outputSeqRef = useRef(0)
  const testAllAbortRef = useRef(false)
  const activeSampleButtonRef = useRef<HTMLButtonElement | null>(null)
  const [activeSampleId, setActiveSampleId] = useState(DEFAULT_VIRTUAL_JS_SAMPLE_ID)
  const [source, setSource] = useState(initialSampleSource)
  /** 工作区入口绝对路径；有值时 Run 走 filename，相对 import 相对该文件。 */
  const [entryPath, setEntryPath] = useState<string | undefined>(undefined)
  const [fileDirty, setFileDirty] = useState(false)
  const [outputLines, setOutputLines] = useState<OutputLine[]>([])
  const [uiState, setUiState] = useState<InstanceUiState>('boot')
  const [bootError, setBootError] = useState<string | undefined>(undefined)
  const [testingAll, setTestingAll] = useState(false)

  const fileMode = entryPath !== undefined

  const activeSample = useMemo(() => {
    if (activeSampleId === WORKSPACE_FILE_SAMPLE_ID) {
      return undefined
    }
    const fromList = VIRTUAL_JS_SAMPLE_LIST.find((sample) => sample.id === activeSampleId)
    if (fromList !== undefined) {
      return fromList
    }
    return VIRTUAL_JS_SAMPLE_LIST[0]
  }, [activeSampleId])

  const activeSampleLabel = useMemo(() => {
    if (entryPath !== undefined) {
      const name = virtualJsFileBasename(entryPath)
      return fileDirty ? `${name} · 未保存` : name
    }
    return activeSample !== undefined ? formatVirtualJsSampleTitle(activeSample) : '脚本'
  }, [activeSample, entryPath, fileDirty])

  const editorBlurb = useMemo(() => {
    if (entryPath !== undefined) {
      return `入口 ${entryPath} · 相对 import 相对该文件`
    }
    return activeSample?.blurb
  }, [activeSample?.blurb, entryPath])

  useEffect(() => {
    activeSampleButtonRef.current?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    })
  }, [activeSampleId])

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
      const instance = await createQuickJsInstance({
        // Virtual JS 默认可读写用户卷，便于内置 fs 样例与打开工作区文件
        workspaceRoot: WORKSPACE_ROOT,
      })
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
      testAllAbortRef.current = true
      unsubRef.current?.()
      unsubRef.current = undefined
      instanceRef.current?.destroy()
      instanceRef.current = undefined
    }
  }, [createInstance])

  const loadSample = useCallback(
    async (sampleId: string) => {
      if (testingAll) {
        return
      }

      const sample = VIRTUAL_JS_SAMPLE_LIST.find((item) => item.id === sampleId)
      if (sample === undefined) {
        return
      }

      const switching = sample.id !== activeSampleId || entryPath !== undefined
      setActiveSampleId(sample.id)
      setSource(sample.source)
      setEntryPath(undefined)
      setFileDirty(false)

      if (!switching) {
        return
      }

      if (uiState === 'busy') {
        instanceRef.current?.abort()
      }
      setOutputLines([])
      appendOutput('info', `已切换「${formatVirtualJsSampleTitle(sample)}」· 实例已重建`)
      await createInstance()
    },
    [activeSampleId, appendOutput, createInstance, entryPath, testingAll, uiState],
  )

  const openWorkspaceEntry = useCallback(
    async (path: string, options?: { info?: string }) => {
      const text = await readVirtualJsWorkspaceFile(path)
      if (!mountedRef.current) {
        return
      }
      setActiveSampleId(WORKSPACE_FILE_SAMPLE_ID)
      setEntryPath(path)
      setSource(text)
      setFileDirty(false)
      if (uiState === 'busy') {
        instanceRef.current?.abort()
      }
      setOutputLines([])
      appendOutput(
        'info',
        options?.info ?? `已打开工作区入口 ${path} · 运行时相对 import 相对该文件`,
      )
      await createInstance()
    },
    [appendOutput, createInstance, uiState],
  )

  const handleOpenFile = useCallback(async () => {
    if (testingAll || uiState === 'busy' || uiState === 'boot') {
      return
    }
    const path = await showSystemOpenDialog({
      title: '打开脚本入口',
      acceptExtensions: SCRIPT_ACCEPT_EXTENSIONS,
    })
    if (path === undefined || !mountedRef.current) {
      return
    }
    try {
      await openWorkspaceEntry(path)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      appendOutput('result-error', `打开失败：${message}`)
    }
  }, [appendOutput, openWorkspaceEntry, showSystemOpenDialog, testingAll, uiState])

  const handleOpenDemoEntry = useCallback(async () => {
    if (testingAll || uiState === 'busy' || uiState === 'boot') {
      return
    }
    try {
      const path = await seedVirtualJsDemoProject()
      if (!mountedRef.current) {
        return
      }
      await openWorkspaceEntry(path, {
        info: `已写入演示项目并打开 ${path}（含 ./lib.js 相对 import）`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      appendOutput('result-error', `演示入口失败：${message}`)
    }
  }, [appendOutput, openWorkspaceEntry, testingAll, uiState])

  const handleReloadFile = useCallback(async () => {
    if (testingAll || entryPath === undefined) {
      return
    }
    try {
      const text = await readVirtualJsWorkspaceFile(entryPath)
      if (!mountedRef.current) {
        return
      }
      setSource(text)
      setFileDirty(false)
      appendOutput('info', `已从磁盘重新加载 ${entryPath}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      appendOutput('result-error', `重新加载失败：${message}`)
    }
  }, [appendOutput, entryPath, testingAll])

  const handleSaveFile = useCallback(async () => {
    if (testingAll || entryPath === undefined) {
      return
    }
    try {
      await saveVirtualJsWorkspaceFile(entryPath, source)
      if (!mountedRef.current) {
        return
      }
      setFileDirty(false)
      appendOutput('info', `已保存 ${entryPath}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      appendOutput('result-error', `保存失败：${message}`)
    }
  }, [appendOutput, entryPath, source, testingAll])

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

  const evalSource = useCallback(
    async (
      code: string,
      title: string,
      evalOptions?: { filename?: string },
    ): Promise<SuiteCaseResult> => {
      let instance = instanceRef.current
      if (instance === undefined || instance.getSnapshot().destroyed) {
        await createInstance()
        instance = instanceRef.current
      }
      if (instance === undefined || instance.getSnapshot().destroyed) {
        const summary = '实例不可用'
        appendOutput('result-error', summary)
        return { title, ok: false, summary, exited: false }
      }

      setUiState('busy')
      try {
        const snap = instance.getSnapshot()
        const entryHint =
          evalOptions?.filename !== undefined ? ` entry=${evalOptions.filename}` : ''
        appendOutput(
          'info',
          `── run · cwd=${snap.cwd} exitCode=${snap.exitCode}${entryHint} · ${title} ──`,
        )
        const result = await instance.eval(code, {
          filename: evalOptions?.filename,
        })
        // console 已由 subscribe 流式追加；这里只展示 REPL 结果 / exit
        syncConsoleFromInstance(instance)
        if (result.ok) {
          if (result.exited) {
            // Virtual JS：实例=进程，process.exit 即结束进程（销毁实例）
            destroyInstanceWithExitCode(result.exitCode, 'process.exit')
            return {
              title,
              ok: true,
              summary: `process.exit(${result.exitCode})`,
              exited: true,
            }
          }
          const formatted = formatValue(result.value)
          appendOutput('result', formatted)
          if (result.exitCode !== 0) {
            appendOutput('info', `exitCode=${result.exitCode}`)
          }
          setUiState(instance.getSnapshot().destroyed ? 'error' : 'ready')
          return {
            title,
            ok: true,
            summary:
              result.exitCode === 0
                ? formatted
                : `${formatted} · exitCode=${result.exitCode}`,
            exited: false,
          }
        }

        appendOutput('result-error', result.error)
        setUiState(instance.getSnapshot().destroyed ? 'error' : 'ready')
        return { title, ok: false, summary: result.error, exited: false }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        appendOutput('result-error', message)
        setUiState(instanceRef.current?.getSnapshot().destroyed ? 'error' : 'ready')
        return { title, ok: false, summary: message, exited: false }
      }
    },
    [appendOutput, createInstance, destroyInstanceWithExitCode, syncConsoleFromInstance],
  )

  const handleRun = useCallback(async () => {
    if (testingAll || uiState === 'busy') {
      return
    }
    await evalSource(
      source,
      activeSampleLabel,
      entryPath !== undefined ? { filename: entryPath } : undefined,
    )
  }, [activeSampleLabel, entryPath, evalSource, source, testingAll, uiState])

  const handleStopTestAll = useCallback(() => {
    testAllAbortRef.current = true
  }, [])

  const handleTestAll = useCallback(async () => {
    if (testingAll) {
      handleStopTestAll()
      return
    }

    testAllAbortRef.current = false
    setTestingAll(true)
    setOutputLines([])
    seenConsoleIdsRef.current = new Set()
    try {
      instanceRef.current?.clearConsole()
    } catch {
      // 实例已销毁时忽略
    }

    const total = VIRTUAL_JS_SAMPLE_LIST.length
    appendOutput(
      'info',
      `══ 测试全部开始 · 共 ${total} 个用例 · 同步 exit 后立刻切换 ══`,
    )

    const suiteResults: SuiteCaseResult[] = []

    for (let index = 0; index < total; index += 1) {
      if (testAllAbortRef.current || !mountedRef.current) {
        appendOutput('warn', '══ 测试全部已中止 ══')
        break
      }

      const sample = VIRTUAL_JS_SAMPLE_LIST[index]!
      const labeled = formatVirtualJsSampleTitle(sample)
      setActiveSampleId(sample.id)
      setSource(sample.source)
      setEntryPath(undefined)
      setFileDirty(false)

      if (instanceRef.current?.getSnapshot().busy) {
        instanceRef.current.abort()
      }

      appendOutput('info', `── [${index + 1}/${total}] ${labeled} ──`)
      await createInstance()

      if (testAllAbortRef.current || !mountedRef.current) {
        appendOutput('warn', '══ 测试全部已中止 ══')
        break
      }

      const caseResult = await evalSource(sample.source, labeled)
      suiteResults.push(caseResult)

      // 定时器 / 异步收尾：eval 可能先返回，等 suiteSettleMs 让回调跑完
      const settleMs = sample.suiteSettleMs ?? 0
      if (settleMs > 0 && !caseResult.exited && index < total - 1) {
        await sleep(settleMs, () => testAllAbortRef.current || !mountedRef.current)
      }
    }

    if (mountedRef.current && suiteResults.length > 0) {
      const passed = suiteResults.filter((item) => item.ok).length
      appendOutput(
        'info',
        `══ 测试全部汇总 · ${passed}/${suiteResults.length} 通过 ══`,
      )
      for (const item of suiteResults) {
        appendOutput(
          item.ok ? 'result' : 'result-error',
          `${item.ok ? '✓' : '✗'} ${item.title} → ${item.summary}`,
        )
      }
    }

    if (mountedRef.current) {
      setTestingAll(false)
      testAllAbortRef.current = false
    }
  }, [appendOutput, createInstance, evalSource, handleStopTestAll, testingAll])

  const handleClearOutput = useCallback(() => {
    if (testingAll) {
      return
    }
    setOutputLines([])
    seenConsoleIdsRef.current = new Set()
    try {
      instanceRef.current?.clearConsole()
    } catch {
      // 实例已销毁时忽略
    }
  }, [testingAll])

  const handleRecreateInstance = useCallback(async () => {
    if (testingAll) {
      return
    }
    if (uiState === 'busy') {
      instanceRef.current?.abort()
    }
    // 重建实例不清输出历史（由外层面板保留）
    appendOutput('info', '已重建 QuickJS 实例（全局变量已清空；输出历史保留）')
    await createInstance()
  }, [appendOutput, createInstance, testingAll, uiState])

  const handleStop = useCallback(() => {
    if (testingAll) {
      handleStopTestAll()
    }
    const instance = instanceRef.current
    if (instance === undefined) {
      return
    }
    const exitCode = instance.getSnapshot().exitCode
    destroyInstanceWithExitCode(exitCode, 'stop')
  }, [destroyInstanceWithExitCode, handleStopTestAll, testingAll])

  const handleResetSample = useCallback(() => {
    if (fileMode) {
      void handleReloadFile()
      return
    }
    if (activeSample === undefined) {
      return
    }
    setSource(activeSample.source)
    setFileDirty(false)
  }, [activeSample, fileMode, handleReloadFile])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleRun()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && fileMode) {
        event.preventDefault()
        void handleSaveFile()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void handleOpenFile()
      }
    },
    [fileMode, handleOpenFile, handleRun, handleSaveFile],
  )

  const canRun = uiState === 'ready' && !testingAll
  const canStop = uiState === 'ready' || uiState === 'busy' || testingAll
  const canRecreate = uiState !== 'busy' && uiState !== 'boot' && !testingAll
  const canStartTestAll = uiState !== 'boot' && uiState !== 'busy'
  const canFileActions = !testingAll && uiState !== 'boot' && uiState !== 'busy'
  const canSaveFile = canFileActions && fileMode

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
        label: '文件',
        items: [
          {
            type: 'action',
            label: '打开…',
            shortcut: '⌘O',
            disabled: !canFileActions,
            onClick: () => void handleOpenFile(),
          },
          {
            type: 'action',
            label: '打开演示入口',
            disabled: !canFileActions,
            onClick: () => void handleOpenDemoEntry(),
          },
          {
            type: 'action',
            label: '保存',
            shortcut: '⌘S',
            disabled: !canSaveFile,
            onClick: () => void handleSaveFile(),
          },
          {
            type: 'action',
            label: '从磁盘重新加载',
            disabled: !canSaveFile,
            onClick: () => void handleReloadFile(),
          },
        ],
      },
      {
        label: '运行',
        items: [
          {
            type: 'action',
            label: fileMode ? '运行入口文件' : '运行',
            shortcut: '⌘↩',
            disabled: !canRun,
            onClick: () => void handleRun(),
          },
          {
            type: 'action',
            label: testingAll ? '停止测试全部' : '测试全部',
            disabled: testingAll ? false : !canStartTestAll,
            onClick: () => void handleTestAll(),
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
            disabled: testingAll,
            onClick: handleClearOutput,
          },
          {
            type: 'action',
            label: fileMode ? '重新加载文件' : '重置当前用例',
            disabled: testingAll,
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
    canFileActions,
    canRecreate,
    canRun,
    canSaveFile,
    canStartTestAll,
    canStop,
    closeWindowsForApp,
    fileMode,
    handleClearOutput,
    handleOpenDemoEntry,
    handleOpenFile,
    handleRecreateInstance,
    handleReloadFile,
    handleResetSample,
    handleRun,
    handleSaveFile,
    handleStop,
    handleTestAll,
    minimizeWindow,
    showBuiltinAbout,
    testingAll,
    windows,
  ])

  useAppMenuBar(APP_ID, menuBar)

  return (
    <div class="virtual-js-app">
      {openDialog}
      <div class="virtual-js-app__toolbar">
        <span class="virtual-js-app__status" data-state={testingAll ? 'busy' : uiState}>
          {bootError ? `错误：${bootError}` : statusLabel(uiState, testingAll)}
        </span>
        <button
          type="button"
          class="virtual-js-app__button"
          disabled={!canFileActions}
          onClick={() => void handleOpenFile()}
          title="打开 VFS 中的 .js / .mjs / .cjs 作为入口"
        >
          打开
        </button>
        <button
          type="button"
          class="virtual-js-app__button"
          disabled={!canFileActions}
          onClick={() => void handleOpenDemoEntry()}
          title="写入 /user/virtual-js-demo 并打开 main.js"
        >
          演示入口
        </button>
        <button
          type="button"
          class="virtual-js-app__button"
          disabled={!canSaveFile}
          onClick={() => void handleSaveFile()}
        >
          保存
        </button>
        <button
          type="button"
          class="virtual-js-app__button virtual-js-app__button--primary"
          disabled={!canRun}
          onClick={() => void handleRun()}
        >
          {fileMode ? '运行入口' : '运行'}
        </button>
        <button
          type="button"
          class={
            testingAll
              ? 'virtual-js-app__button virtual-js-app__button--primary'
              : 'virtual-js-app__button'
          }
          disabled={testingAll ? false : !canStartTestAll}
          onClick={() => void handleTestAll()}
          title="依次运行全部用例；同步脚本 process.exit 后立刻切换，定时器用例等收尾"
        >
          {testingAll ? '停止测试' : '测试全部'}
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
        <button
          type="button"
          class="virtual-js-app__button"
          disabled={testingAll}
          onClick={handleClearOutput}
        >
          清空输出
        </button>
        <button
          type="button"
          class="virtual-js-app__button"
          disabled={testingAll}
          onClick={handleResetSample}
        >
          {fileMode ? '重新加载' : '重置用例'}
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
            {VIRTUAL_JS_SAMPLE_LIST.map((sample) => {
              const selected = !fileMode && sample.id === activeSampleId
              return (
                <li key={sample.id}>
                  <button
                    type="button"
                    ref={selected ? activeSampleButtonRef : undefined}
                    class={
                      selected
                        ? 'virtual-js-app__sample virtual-js-app__sample--active'
                        : 'virtual-js-app__sample'
                    }
                    aria-current={selected ? 'true' : undefined}
                    disabled={testingAll}
                    onClick={() => void loadSample(sample.id)}
                  >
                    <span class="virtual-js-app__sample-title">
                      <span class="virtual-js-app__sample-seq">#{sample.seq}</span>
                      {sample.title}
                    </span>
                    <span class="virtual-js-app__sample-blurb">{sample.blurb}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>

        <div class="virtual-js-app__main">
          <div class="virtual-js-app__editor-meta">
            <span class="virtual-js-app__editor-title">{activeSampleLabel}</span>
            <span class="virtual-js-app__editor-blurb">{editorBlurb}</span>
          </div>
          <div class="virtual-js-app__editor">
            <textarea
              class="virtual-js-app__textarea"
              value={source}
              spellCheck={false}
              readOnly={testingAll}
              onInput={(event) => {
                setSource((event.target as HTMLTextAreaElement).value)
                if (fileMode) {
                  setFileDirty(true)
                }
              }}
              onKeyDown={handleKeyDown}
              aria-label="QuickJS 源代码"
            />
          </div>

          <div class="virtual-js-app__output" role="log" aria-live="polite">
            {outputLines.length === 0 ? (
              <p class="virtual-js-app__output-empty">
                「打开 / 演示入口」从工作区跑多文件脚本；「运行」粘贴求值或按入口 filename 解析相对
                import。「测试全部」依次跑内置用例。「停止」或 process.exit 销毁实例。
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
